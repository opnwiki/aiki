import { createError, readBody, setResponseStatus } from 'h3'
import { enforceSameOrigin, requireHumanActor } from '../../../utils/auth.js'
import { getDatabase } from '../../../utils/database.js'
import { enforceContentQuota, enforceRateLimit } from '../../../utils/rate-limit.js'
import { notifyEditProposal } from '../../../utils/notifications.js'
import { readableTopicSql } from '../../../utils/page-access.js'
import { validateCitation, validateEditProposal } from '../../../utils/validation.js'
import { loadArticleRuleOverrides, reviewArticle, rulesReviewError } from '../../../utils/article-rules.js'
import { topicKeyPredicate } from '../../../utils/page-address.js'

export default defineEventHandler(async (event) => {
  enforceSameOrigin(event)
  const actor = await requireHumanActor(event)
  await enforceRateLimit(event, { action: 'proposal-create', limit: 10, actor })
  await enforceContentQuota(event, actor, 'proposal')

  const slug = getRouterParam(event, 'slug')
  if (!slug || !/^[\p{L}\p{N}]+(?:-[\p{L}\p{N}]+)*$/u.test(slug)) {
    throw createError({ statusCode: 404, statusMessage: 'Topic not found.' })
  }

  const input = await readBody(event)
  const checked = validateEditProposal(input)
  if (!checked.ok) {
    throw createError({ statusCode: 400, statusMessage: 'Please correct the proposed edit.', data: { errors: checked.errors } })
  }
  const sources = readProposalSources(input)

  const client = await getDatabase().connect()
  let proposal
  try {
    await client.query('BEGIN')
    const topic = await client.query(
      `SELECT t.id, r.title
         FROM topics t
         JOIN topic_current_revisions current ON current.topic_id = t.id
         JOIN revisions r ON r.id = current.revision_id AND r.locale = current.locale
        WHERE ${topicKeyPredicate('t', '$1')} AND t.kind = 'article'
          AND ${readableTopicSql('t', '$4')}
          AND current.locale = $2 AND current.revision_id = $3
        FOR UPDATE OF t, current`,
      [slug, checked.value.locale, checked.value.baseRevisionId, actor.id],
    )
    if (!topic.rows[0]) {
      throw createError({ statusCode: 409, statusMessage: 'The selected revision is no longer current. Reload the page before proposing an edit.' })
    }
    const rules = reviewArticle({
      title: checked.value.proposedTitle || topic.rows[0].title,
      body: checked.value.proposedBody,
    }, await loadArticleRuleOverrides(client), { scope: 'text' })
    if (!rules.ok) throw rulesReviewError(rules.findings)

    const inserted = await client.query(
      `INSERT INTO edit_proposals
         (topic_id, base_revision_id, author_id, locale, proposed_title, proposed_body_markdown, rationale)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id, topic_id, base_revision_id, author_id, locale, proposed_title,
                 proposed_body_markdown, rationale, status, created_at`,
      [topic.rows[0].id, checked.value.baseRevisionId, actor.id, checked.value.locale,
        checked.value.proposedTitle, checked.value.proposedBody, checked.value.rationale],
    )
    proposal = inserted.rows[0]
    await client.query(
      `INSERT INTO actor_audit_log (actor_id, action, target_type, target_id, details)
       VALUES ($1, 'edit_proposal_created', 'edit_proposal', $2, jsonb_build_object('topic_id', $3::text, 'base_revision_id', $4::text))`,
      [actor.id, proposal.id, proposal.topic_id, proposal.base_revision_id],
    )
    for (const [position, source] of sources.entries()) {
      await client.query(
        `INSERT INTO edit_proposal_sources (proposal_id, position, url, title, publisher, locator, note)
         VALUES ($1, $2, $3, NULLIF($4::text, ''), NULLIF($5::text, ''), NULLIF($6::text, ''), NULLIF($7::text, ''))`,
        [proposal.id, position, source.url, source.title, source.publisher, source.locator, source.note],
      )
    }
    await notifyEditProposal(client, { topicId: proposal.topic_id, proposalId: proposal.id, authorId: actor.id })
    await client.query('COMMIT')
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }

  setResponseStatus(event, 201)
  return { proposal, sources: sources.length }
})

function readProposalSources(input) {
  if (input?.sources == null) return []
  if (!Array.isArray(input.sources) || input.sources.length < 1 || input.sources.length > 5) {
    throw createError({ statusCode: 400, statusMessage: 'A proposal can include 1–5 sources.' })
  }
  return input.sources.map((source, index) => {
    const checked = validateCitation(source)
    if (!checked.ok) throw createError({ statusCode: 400, statusMessage: `Please correct source ${index + 1}.`, data: { errors: checked.errors } })
    return checked.value
  })
}
