import { createHash } from 'node:crypto'
import { createError } from 'h3'
import { lockIntegrationCredential } from './integration-auth.js'
import { resolveExternalIdentity } from './integration-identity.js'
import { validateIntegrationImport, importRevisionDecision, publicImportState } from './integration-import-validation.js'
import { allocateTopicSlug } from './page-address.js'
import { recordRevisionDiff } from './revision-history.js'
import { attachTopicTags } from './tags.js'
import { enforceContentQuota } from './rate-limit.js'
import { loadArticleRuleOverrides, reviewArticle, rulesReviewError } from './article-rules.js'
import { openingTopicStatus, checkPageContent } from './moderation.js'
import { ensureContentTasks } from './content-tasks.js'
import { notifyEditProposal } from './notifications.js'

async function mutex(client, ...parts) {
  await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [JSON.stringify(parts)])
}

async function importServiceActor(client, credential) {
  const username = `import-${createHash('sha256').update(credential.connector).digest('hex').slice(0, 20)}`
  const created = await client.query(
    `INSERT INTO actors (node_id, kind, username, display_name, role, account_status)
     VALUES ($1, 'system', $2, 'External source import', 'member', 'active')
     ON CONFLICT (node_id, username) DO NOTHING`, [credential.node_id, username],
  )
  void created
  const result = await client.query(`SELECT id FROM actors WHERE node_id = $1 AND username = $2 AND kind = 'system' AND role = 'member' AND account_status = 'active'`, [credential.node_id, username])
  if (!result.rows[0]) throw createError({ statusCode: 409, statusMessage: 'The import service account is unavailable.' })
  return result.rows[0]
}

function authorSnapshot(resolved, source) {
  return resolved ? {
    publicId: resolved.actor.public_id ? String(resolved.actor.public_id) : null,
    name: resolved.identity.display_name || resolved.actor.display_name || resolved.identity.username || null,
    profileUrl: resolved.identity.profile_url || null, avatarUrl: resolved.identity.avatar_url || null,
    type: resolved.identity.subject_type,
  } : { name: source.authorName, profileUrl: null, avatarUrl: null, type: 'unknown' }
}

async function attachImportSources(client, topicId, revisionId, sources) {
  for (const source of sources) {
    const result = await client.query(
      `INSERT INTO sources (canonical_url, title, publisher, source_type, published_at)
       VALUES ($1, NULLIF($2::text, ''), NULLIF($3::text, ''), 'external', $4::date)
       ON CONFLICT (canonical_url) DO UPDATE SET title = coalesce(sources.title, EXCLUDED.title),
         publisher = coalesce(sources.publisher, EXCLUDED.publisher), published_at = coalesce(sources.published_at, EXCLUDED.published_at)
       RETURNING id`, [source.url, source.title, source.publisher, source.publishedAt],
    )
    await client.query(`INSERT INTO citations (topic_id, source_id, revision_id, locator, note)
      VALUES ($1, $2, $3, NULLIF($4::text, ''), NULLIF($5::text, ''))`, [topicId, result.rows[0].id, revisionId, source.locator, source.note])
  }
}

async function createImportRevision(client, { topic, authorId, input, previous = null }) {
  const mode = input.formatting.mode === 'preserved' ? 'external_import' : 'ai_generated_unreviewed'
  const revision = await client.query(
    `INSERT INTO revisions (topic_id, parent_revision_id, author_id, locale, title, body_markdown, summary, authorship_mode, model_name)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id, created_at`,
    [topic.id, previous?.current_revision_id || null, authorId, input.content.locale, input.content.title,
      input.content.body, input.content.overview, mode, mode === 'external_import' ? null : input.formatting.model],
  )
  const row = revision.rows[0]
  await recordRevisionDiff(client, { revisionId: row.id, parentRevisionId: previous?.current_revision_id,
    parentTitle: previous?.title || '', parentBody: previous?.body_markdown || '', title: input.content.title, body: input.content.body,
    origin: 'import', introducedBy: authorId, introducedAt: row.created_at, introducedLabel: 'External source import' })
  await client.query(`INSERT INTO topic_current_revisions (topic_id, locale, revision_id) VALUES ($1, $2, $3)
    ON CONFLICT (topic_id, locale) DO UPDATE SET revision_id = EXCLUDED.revision_id`, [topic.id, input.content.locale, row.id])
  await attachImportSources(client, topic.id, row.id, input.sources)
  return row
}

async function storeProvenance(client, { importId, topicId, revisionId, author, input }) {
  await client.query(`INSERT INTO content_import_revisions
    (revision_id, import_id, topic_id, locale, source_snapshot, author_snapshot, formatting, media, source_hash)
    VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7::jsonb, $8::jsonb, $9)`,
  [revisionId, importId, topicId, input.content.locale, JSON.stringify(input.source), JSON.stringify(authorSnapshot(author, input.source)),
    JSON.stringify(input.formatting), JSON.stringify(input.media), input.sourceHash])
}

async function proposeSourceUpdate(client, credential, stored, input, sender, serviceActor) {
  const prior = await client.query(`SELECT proposal_id FROM content_import_proposals WHERE import_id = $1 AND source_hash = $2`, [stored.id, input.sourceHash])
  if (prior.rows[0]) return prior.rows[0].proposal_id
  await enforceContentQuota(input.event, sender.actor, 'proposal')
  const proposal = await client.query(`INSERT INTO edit_proposals
    (topic_id, base_revision_id, author_id, locale, proposed_title, proposed_body_markdown, rationale)
    VALUES ($1, $2, $3, $4, $5, $6, 'The external source changed. Preserve the current local revision until this proposal is reviewed.') RETURNING id`,
  [stored.topic_id, stored.current_revision_id, serviceActor.id, stored.locale, input.content.title, input.content.body])
  const proposalId = proposal.rows[0].id
  for (const [index, source] of input.sources.entries()) {
    await client.query(`INSERT INTO edit_proposal_sources (proposal_id, position, url, title, publisher, locator, note)
      VALUES ($1, $2, $3, $4, $5, $6, $7)`, [proposalId, index, source.url, source.title, source.publisher, source.locator, source.note])
  }
  await client.query(`INSERT INTO content_import_proposals (proposal_id, import_id, source_hash, source_snapshot, formatting)
    VALUES ($1, $2, $3, $4::jsonb, $5::jsonb)`, [proposalId, stored.id, input.sourceHash, JSON.stringify(input.source), JSON.stringify(input.formatting)])
  await notifyEditProposal(client, { topicId: stored.topic_id, proposalId, authorId: serviceActor.id })
  await client.query(`INSERT INTO actor_audit_log (actor_id, action, target_type, target_id, details)
    VALUES ($1, 'import_update_proposed', 'edit_proposal', $2, $3::jsonb)`,
  [sender.actor.id, proposalId, JSON.stringify({ importId: stored.id, connector: credential.connector })])
  return proposalId
}

// Every identity, page, current pointer, source snapshot and receipt belongs to
// the same transaction. Receipt/source advisory locks precede quota consumption.
export async function publishIntegrationImport(database, credential, body, { event, siteUrl }) {
  const input = validateIntegrationImport(body, credential)
  input.event = event
  const client = await database.connect()
  let importId, proposalId = null, reused = false, changed = false
  try {
    await client.query('BEGIN')
    await lockIntegrationCredential(client, credential, 'imports:write')
    await mutex(client, 'import-receipt', credential.node_id, credential.connector, input.idempotencyKey)
    const receipt = await client.query(`SELECT import_id, proposal_id, external_source_key FROM content_import_receipts
      WHERE node_id = $1 AND connector = $2 AND idempotency_key = $3`, [credential.node_id, credential.connector, input.idempotencyKey])
    if (receipt.rows[0]) {
      if (receipt.rows[0].external_source_key !== input.externalSourceKey) throw createError({ statusCode: 409, statusMessage: 'That idempotency key belongs to another source.' })
      importId = receipt.rows[0].import_id
      proposalId = receipt.rows[0].proposal_id
      reused = true
    } else {
      await mutex(client, 'import-source', credential.node_id, credential.connector, input.externalSourceKey)
      const found = await client.query(`SELECT i.*, t.kind, t.status, current.revision_id AS current_revision_id,
          r.locale, r.title, r.body_markdown
        FROM content_imports i JOIN topics t ON t.id = i.topic_id
        JOIN revisions imported ON imported.id = i.last_revision_id
        JOIN topic_current_revisions current ON current.topic_id = t.id AND current.locale = imported.locale
        JOIN revisions r ON r.id = current.revision_id
        WHERE i.node_id = $1 AND i.connector = $2 AND i.external_source_key = $3 FOR UPDATE OF i, t, current`,
      [credential.node_id, credential.connector, input.externalSourceKey])
      const stored = found.rows[0]
      const decision = stored ? importRevisionDecision(stored, input) : 'create'
      if (decision === 'reuse' || decision === 'unavailable') {
        await resolveExternalIdentity(client, credential, input.submitter, { verifiedSender: true })
        importId = stored.id
        reused = true
      } else {
        // Resolve in a stable order so two users forwarding each other's posts
        // cannot take opposite identity locks.
        const identities = [{ input: input.submitter, verified: true, key: 'sender' }]
        const sameAuthor = input.author && ['provider', 'subjectType', 'subjectKey'].every(key => input.author[key] === input.submitter[key])
        if (input.author && !sameAuthor) identities.push({ input: input.author, verified: false, key: 'author' })
        identities.sort((a, b) => JSON.stringify([a.input.provider, a.input.subjectType, a.input.subjectKey]).localeCompare(JSON.stringify([b.input.provider, b.input.subjectType, b.input.subjectKey])))
        const resolved = {}
        for (const item of identities) resolved[item.key] = await resolveExternalIdentity(client, credential, item.input, { verifiedSender: item.verified })
        const sender = resolved.sender
        const author = sameAuthor ? sender : resolved.author || null
        if (stored && stored.author_identity_id !== (author?.identity.id || null)) throw createError({ statusCode: 409, statusMessage: 'The original author identity of this source does not match.' })
        const serviceActor = await importServiceActor(client, credential)
        const rules = reviewArticle({ title: input.content.title, body: input.content.body, sources: input.sources,
          authorshipMode: input.formatting.mode === 'preserved' ? 'external_import' : 'ai_generated_unreviewed',
          modelName: input.formatting.mode === 'generated' ? input.formatting.model : null, humanContribution: null,
          importSourceVerified: true }, await loadArticleRuleOverrides(client), { scope: input.content.kind === 'article' ? 'article' : 'text' })
        if (!rules.ok) throw rulesReviewError(rules.findings)
        if (decision === 'proposal') {
          importId = stored.id
          proposalId = await proposeSourceUpdate(client, credential, stored, input, sender, serviceActor)
        } else {
          await enforceContentQuota(event, sender.actor, decision === 'create' ? 'page' : 'revision')
          let topic
          if (decision === 'create') {
            const slug = await allocateTopicSlug(client)
            const status = await openingTopicStatus(client, 'published')
            const created = await client.query(`INSERT INTO topics
              (node_id, author_id, slug, kind, status, summary, hide_author, federation_outbound_mode, public_usefulness_score, public_usefulness_reason)
              VALUES ($1, $2, $3, $4, $5, $6, $9, 'none', $7, $8) RETURNING id, page_number`,
            [credential.node_id, author?.actor.id || serviceActor.id, slug, input.content.kind, status, input.content.overview,
              input.content.publicUsefulnessScore, input.content.publicUsefulnessReason, author?.actor.kind === 'human' ? null : false])
            topic = created.rows[0]
            await client.query('INSERT INTO page_read_counts (topic_id) VALUES ($1)', [topic.id])
          } else {
            topic = { id: stored.topic_id }
          }
          const revision = await createImportRevision(client, { topic, authorId: author?.actor.id || serviceActor.id, input, previous: stored })
          if (decision === 'create') {
            const inserted = await client.query(`INSERT INTO content_imports
              (node_id, connector, external_source_key, topic_id, requested_by_actor_id, author_identity_id, last_revision_id, source_hash)
              VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
            [credential.node_id, credential.connector, input.externalSourceKey, topic.id, sender.actor.id, author?.identity.id || null, revision.id, input.sourceHash])
            importId = inserted.rows[0].id
          } else {
            importId = stored.id
            await client.query(`UPDATE content_imports SET last_revision_id = $2, source_hash = $3, updated_at = now() WHERE id = $1`, [importId, revision.id, input.sourceHash])
            await client.query(`UPDATE topics SET summary = $2, updated_at = now(), public_usefulness_score = $3, public_usefulness_reason = $4 WHERE id = $1`,
              [topic.id, input.content.overview, input.content.publicUsefulnessScore, input.content.publicUsefulnessReason])
            await client.query('DELETE FROM topic_tags WHERE topic_id = $1', [topic.id])
          }
          await storeProvenance(client, { importId, topicId: topic.id, revisionId: revision.id, author, input })
          await attachTopicTags(client, { nodeId: credential.node_id, topicId: topic.id, tags: input.content.tags })
          await ensureContentTasks(client, { topicId: topic.id, baseRevisionId: revision.id, creatorId: sender.actor.id })
          await client.query(`INSERT INTO actor_audit_log (actor_id, action, target_type, target_id, details)
            VALUES ($1, 'integration_page_imported', 'topic', $2, $3::jsonb)`, [sender.actor.id, topic.id, JSON.stringify({ importId, connector: credential.connector, revisionId: revision.id, updated: decision === 'revision' })])
          changed = true
        }
      }
      await client.query(`INSERT INTO content_import_receipts (node_id, connector, idempotency_key, external_source_key, import_id, proposal_id)
        VALUES ($1, $2, $3, $4, $5, $6)`, [credential.node_id, credential.connector, input.idempotencyKey, input.externalSourceKey, importId, proposalId])
    }
    await client.query('COMMIT')
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally { client.release() }
  if (changed) {
    const topic = await database.query('SELECT topic_id FROM content_imports WHERE id = $1', [importId])
    await checkPageContent(database, { topicId: topic.rows[0].topic_id, trigger: 'publish', article: input.content })
  }
  return getIntegrationImport(database, credential, importId, { siteUrl, proposalId, reused })
}

export async function getIntegrationImport(database, credential, importId, { siteUrl, proposalId = null, reused = false } = {}) {
  const result = await database.query(`SELECT i.id, t.page_number, t.status,
      EXISTS (SELECT 1 FROM moderation_checks checks WHERE checks.topic_id = t.id AND checks.status = 'pending') AS moderation_pending
    FROM content_imports i JOIN topics t ON t.id = i.topic_id
    WHERE i.id = $1 AND i.node_id = $2 AND i.connector = $3`, [importId, credential.node_id, credential.connector])
  const row = result.rows[0]
  if (!row) throw createError({ statusCode: 404, statusMessage: 'Import not found.' })
  const state = publicImportState(row.status, proposalId, row.moderation_pending)
  return { version: 1, importId: row.id, state, pageNumber: String(row.page_number),
    url: state === 'published' ? new URL(`/${row.page_number}`, siteUrl).href : null, reused, ...(proposalId ? { proposalId } : {}) }
}

export function presentImportProvenance(row, { hideAuthor = false } = {}) {
  if (!row) return null
  const source = row.source_snapshot || {}
  const author = row.author_snapshot || {}
  const format = row.formatting || {}
  return {
    sourceUrl: source.url || null, sourceTitle: source.title || null, publisher: source.publisher || null,
    publishedAt: source.publishedAt || null, importedAt: row.imported_at, originalLanguage: source.originalLanguage || null,
    authorSignature: hideAuthor ? null : source.authorSignature || null,
    author: hideAuthor ? null : { name: author.name || null, publicId: author.publicId || null, profileUrl: author.profileUrl || null, avatarUrl: author.avatarUrl || null, type: author.type || 'unknown' },
    formatting: { provider: format.provider || null, model: format.model || null, mode: format.mode || null },
    editedLocally: row.revision_id !== row.current_revision_id,
  }
}

export async function loadImportProvenance(database, topicId, revisionId, options = {}) {
  const result = await database.query(`WITH RECURSIVE ancestry AS (
      SELECT id, parent_revision_id, source_revision_id FROM revisions WHERE topic_id = $1 AND id = $2::uuid
      UNION
      SELECT previous.id, previous.parent_revision_id, previous.source_revision_id
        FROM revisions previous JOIN ancestry ON previous.id IN (ancestry.parent_revision_id, ancestry.source_revision_id)
       WHERE previous.topic_id = $1
    )
    SELECT provenance.*, $2::uuid AS current_revision_id FROM content_import_revisions provenance
    JOIN ancestry ON ancestry.id = provenance.revision_id
    ORDER BY (provenance.revision_id = $2::uuid) DESC, provenance.imported_at DESC LIMIT 1`, [topicId, revisionId])
  return presentImportProvenance(result.rows[0], options)
}
