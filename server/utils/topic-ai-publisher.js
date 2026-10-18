import { notifyReply } from './notifications.js'
import { notifyEditProposal } from './notifications.js'
import { loadArticleRuleOverrides, reviewArticle, rulesReviewError } from './article-rules.js'
import { recordRevisionDiff } from './revision-history.js'
import { SUPPORTED_LOCALES, validateArticleOverview } from './validation.js'
import { ensureContentTasks } from './content-tasks.js'
import { attachTopicTags } from './tags.js'
import { requirePublishedParent } from './replies.js'
import { readPublicUsefulnessScore, readSuggestedTags } from './topic-ai.js'

export const TOPIC_AI_AGENT_USERNAME = 'neron-agent'
export const TOPIC_AI_AGENT_NAME = 'Neron Agent'
const DEFAULT_MODEL = 'Neron Agent'

export async function classifyTopicPage(client, { request, result, model }) {
  const classifiedKind = String(result?.kind || '').trim().toLowerCase()
  if (!['article', 'question', 'discussion', 'page'].includes(classifiedKind)) {
    throw nonRetryableError('The AI provider returned an invalid page type.')
  }

  const topicResult = await client.query(
    `SELECT t.id, t.node_id, t.kind, t.summary, t.status, current.revision_id,
            revision.locale, revision.title, revision.body_markdown, revision.summary AS revision_summary,
            revision.authorship_mode, revision.model_name, revision.human_contribution, revision.created_at AS revision_created_at,
            revision.author_id AS revision_author_id
       FROM topics t
       JOIN topic_current_revisions current ON current.topic_id = t.id AND current.revision_id = $2
       JOIN revisions revision ON revision.id = current.revision_id
      WHERE t.id = $1
      FOR UPDATE OF t, current, revision`,
    [request.topic_id, request.base_revision_id],
  )
  const topic = topicResult.rows[0]
  if (!topic || topic.status === 'deleted') {
    throw nonRetryableError('The page was changed before its type could be assigned.')
  }
  const isPageShell = topic.kind === 'page'
  const kind = isPageShell ? classifiedKind : topic.kind
  const publicUsefulnessScore = readPublicUsefulnessScore(result?.publicUsefulnessScore)
  const publicUsefulnessReason = String(result?.publicUsefulnessReason || '').trim().slice(0, 500)

  // Search-created pages start with the visitor's UI locale as a hint. The
  // classifier also detects the language of the submitted material. Move the
  // still-unpublished draft to that locale before creating follow-up tasks so
  // the original language, current pointer, and task metadata agree. The old
  // immutable revision stays in history and the new locale-specific revision
  // carries the same draft text; this is a pre-publication classification,
  // not a content edit.
  const requestedLocale = SUPPORTED_LOCALES.includes(String(result?.locale || '').trim().toLowerCase())
    ? String(result.locale).trim().toLowerCase()
    : topic.locale
  let contentLocale = topic.locale
  if (isPageShell && requestedLocale !== topic.locale) {
    const existingLocale = await client.query(
      `SELECT revision_id
         FROM topic_current_revisions
        WHERE topic_id = $1 AND locale = $2
        FOR UPDATE`,
      [topic.id, requestedLocale],
    )
    if (!existingLocale.rows[0]) {
      const moved = await client.query(
        `INSERT INTO revisions (
           topic_id, source_revision_id, author_id, locale, title, body_markdown, summary,
           authorship_mode, model_name, human_contribution
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         RETURNING id, created_at`,
        [topic.id, topic.revision_id, topic.revision_author_id, requestedLocale, topic.title,
          topic.body_markdown, topic.revision_summary, topic.authorship_mode, topic.model_name,
          topic.human_contribution],
      )
      const movedRevision = moved.rows[0]
      await recordRevisionDiff(client, {
        revisionId: movedRevision.id,
        title: topic.title,
        body: topic.body_markdown,
        origin: 'publication',
        introducedBy: topic.revision_author_id,
        confirmedBy: topic.revision_author_id,
        introducedAt: movedRevision.created_at,
        confirmedAt: movedRevision.created_at,
      })
      await client.query(
        'DELETE FROM topic_current_revisions WHERE topic_id = $1 AND locale = $2 AND revision_id = $3',
        [topic.id, topic.locale, topic.revision_id],
      )
      await client.query(
        'INSERT INTO topic_current_revisions (topic_id, locale, revision_id) VALUES ($1, $2, $3)',
        [topic.id, requestedLocale, movedRevision.id],
      )
      await client.query('UPDATE topic_ai_requests SET locale = $2 WHERE id = $1', [request.id, requestedLocale])
      contentLocale = requestedLocale
      topic.locale = requestedLocale
      topic.revision_id = movedRevision.id
    }
  }

  await client.query(
    `UPDATE topics SET kind = $2, public_usefulness_score = $3,
            public_usefulness_reason = NULLIF($4::text, ''), updated_at = now() WHERE id = $1`,
    [topic.id, kind, publicUsefulnessScore, publicUsefulnessReason],
  )
  // A page created from search starts by link; a clean page is opened to
  // everyone, one that breaks the rules stays by link.
  const published = isPageShell && result?.publish === true && topic.status === 'unlisted'
  if (published) await client.query(`UPDATE topics SET status = 'published' WHERE id = $1`, [topic.id])
  // The model's tags fill a page that has none; author-chosen tags stay.
  const existingTags = await client.query('SELECT 1 FROM topic_tags WHERE topic_id = $1 LIMIT 1', [topic.id])
  const tags = existingTags.rows[0]
    ? []
    : await attachTopicTags(client, { nodeId: topic.node_id, topicId: topic.id, tags: readSuggestedTags(result?.tags) })
  await ensureContentTasks(client, { topicId: topic.id, baseRevisionId: topic.revision_id, creatorId: request.requester_id })

  // This is the first automatic quality task created by the classifier. The
  // existing overview workflow already supports human/agent submissions and
  // review, so it is safe to enqueue it in the same transaction as the type.
  if (kind === 'article' && !String(topic.summary || '').trim()) {
    await client.query(
      `INSERT INTO article_writing_tasks (task_type, topic_id, target_revision_id, status)
       VALUES ('overview', $1, $2, 'open')
       ON CONFLICT (target_revision_id) WHERE task_type = 'overview' DO NOTHING`,
      [topic.id, topic.revision_id],
    )
  }

  await client.query(
    `INSERT INTO actor_audit_log (actor_id, action, target_type, target_id, details)
     VALUES ($1, 'topic_page_classified', 'topic', $2,
             jsonb_build_object('request_id', $3::text, 'kind', $4::text,
               'reason', $5::text, 'model', $6::text, 'published', $7::boolean, 'publish_reason', $8::text,
               'locale', $9::text, 'public_usefulness_score', $10::numeric, 'public_usefulness_reason', $11::text))`,
    [request.requester_id, topic.id, request.id, kind, result.reason || '', normalizeModel(model || result?.model), published, result?.publishReason || '', contentLocale, publicUsefulnessScore, publicUsefulnessReason],
  )

  return {
    topicId: topic.id,
    kind,
    locale: contentLocale,
    publicUsefulnessScore,
    publicUsefulnessReason,
    tags,
    access: published ? 'public' : topic.status === 'published' ? 'public' : 'link',
    publishReason: result?.publishReason || null,
    reason: result.reason || null,
    model: normalizeModel(model || result?.model),
  }
}

export async function publishTopicAiDiscussionReply(client, { request, result, model }) {
  const topicResult = await client.query(
    `SELECT id, coalesce(node_id, (SELECT id FROM nodes WHERE is_home LIMIT 1)) AS node_id, status
       FROM topics
      WHERE id = $1
      FOR UPDATE`,
    [request.topic_id],
  )
  const topic = topicResult.rows[0]
  if (!topic || topic.status === 'deleted') {
    throw nonRetryableError('The page is no longer available for publishing.')
  }

  const agent = await ensureTopicAiAgent(client, topic.node_id, model || result?.modelName || result?.model)
  const body = String(result?.answer || '').trim()
  if (body.length < 3 || body.length > 10_000) {
    throw nonRetryableError('The AI provider returned an answer that cannot be published.')
  }
  const modelLabel = normalizeModel(model || result?.modelName || result?.model)
  // The agent may continue an existing thread; a parent that vanished or is
  // too deep falls back to a new top-level reply instead of losing the answer.
  let parentReplyId = null
  if (result?.parentReplyId) {
    try {
      parentReplyId = await requirePublishedParent(client, topic.id, result.parentReplyId)
    } catch {
      parentReplyId = null
    }
  }
  const inserted = await client.query(
    `INSERT INTO replies
       (topic_id, parent_reply_id, author_id, author_hidden, locale, body_markdown, client_label)
     VALUES ($1, $2, $3, false, $4, $5, $6)
     RETURNING id, topic_id, parent_reply_id, author_id, locale, body_markdown, created_at, updated_at`,
    [topic.id, parentReplyId, agent.id, request.locale, body, modelLabel],
  )
  const reply = inserted.rows[0]

  for (const source of Array.isArray(result?.sources) ? result.sources : []) {
    const sourceResult = await client.query(
      `INSERT INTO sources (canonical_url, title, publisher, source_type, published_at)
       VALUES ($1, NULLIF($2::text, ''), NULLIF($3::text, ''), 'external', $4::date)
       ON CONFLICT (canonical_url) DO UPDATE SET
         title = coalesce(sources.title, EXCLUDED.title),
         publisher = coalesce(sources.publisher, EXCLUDED.publisher),
         published_at = coalesce(sources.published_at, EXCLUDED.published_at)
       RETURNING id`,
      [source.url, source.title, source.publisher, source.publishedAt || null],
    )
    await client.query(
      `INSERT INTO citations (topic_id, source_id, reply_id, locator, note)
       VALUES ($1, $2, $3, NULLIF($4::text, ''), NULLIF($5::text, ''))`,
      [topic.id, sourceResult.rows[0].id, reply.id, source.locator, source.note],
    )
  }

  await client.query('UPDATE topics SET updated_at = now() WHERE id = $1', [topic.id])
  await client.query(
    `INSERT INTO actor_audit_log (actor_id, action, target_type, target_id, details)
     VALUES ($1, 'reply_created', 'reply', $2,
             jsonb_build_object('source', 'topic_ai_request', 'request_id', $3::text))`,
    [agent.id, reply.id, request.id],
  )
  await notifyReply(client, {
    topicId: topic.id,
    replyId: reply.id,
    authorId: agent.id,
    parentReplyId,
  })
  await ensureContentTasks(client, { topicId: topic.id, creatorId: agent.id })

  return {
    id: reply.id,
    author: agent.username,
    displayName: agent.agent_name || agent.username,
    model: modelLabel,
    createdAt: reply.created_at,
  }
}

export async function publishTopicAiEditProposal(client, { request, result, model }) {
  const topicResult = await client.query(
    `SELECT t.id, coalesce(t.node_id, (SELECT id FROM nodes WHERE is_home LIMIT 1)) AS node_id,
            t.status, t.kind, current.revision_id, revision.title
       FROM topics t
       JOIN topic_current_revisions current
         ON current.topic_id = t.id AND current.locale = $2
       JOIN revisions revision ON revision.id = current.revision_id
      WHERE t.id = $1 AND current.revision_id = $3
      FOR UPDATE OF t, current, revision`,
    [request.topic_id, request.locale, request.base_revision_id],
  )
  const topic = topicResult.rows[0]
  if (!topic || topic.status === 'deleted') {
    throw nonRetryableError('The page changed or is no longer available for a proposed revision.')
  }
  if (topic.kind !== 'article') {
    throw nonRetryableError('Research proposals are currently available for articles only.')
  }

  const sources = Array.isArray(result?.sources) ? result.sources : []
  if (sources.length < 1 || sources.length > 5) {
    throw nonRetryableError('The researched article proposal must include 1–5 sources.')
  }
  const proposedBody = String(result?.proposedBody || '').trim()
  const rationale = String(result?.rationale || '').trim()
  const rules = reviewArticle(
    { title: topic.title, body: proposedBody },
    await loadArticleRuleOverrides(client),
    { locale: request.locale, scope: 'text' },
  )
  if (!rules.ok) throw rulesReviewError(rules.findings)

  const agent = await ensureTopicAiAgent(client, topic.node_id, model || result?.modelName || result?.model)
  const inserted = await client.query(
    `INSERT INTO edit_proposals
       (topic_id, base_revision_id, author_id, locale, proposed_title, proposed_body_markdown, rationale)
     VALUES ($1, $2, $3, $4, NULL, $5, $6)
     RETURNING id, topic_id, base_revision_id, author_id, locale, created_at`,
    [topic.id, request.base_revision_id, agent.id, request.locale, proposedBody, rationale],
  )
  const proposal = inserted.rows[0]

  for (const [position, source] of sources.entries()) {
    await client.query(
      `INSERT INTO edit_proposal_sources (proposal_id, position, url, title, publisher, locator, note)
       VALUES ($1, $2, $3, NULLIF($4::text, ''), NULLIF($5::text, ''), NULLIF($6::text, ''), NULLIF($7::text, ''))`,
      [proposal.id, position, source.url, source.title, source.publisher, source.locator, source.note],
    )
  }
  await client.query(
    `INSERT INTO actor_audit_log (actor_id, action, target_type, target_id, details)
     VALUES ($1, 'edit_proposal_created', 'edit_proposal', $2,
             jsonb_build_object('source', 'topic_ai_request', 'request_id', $3::text, 'topic_id', $4::text))`,
    [agent.id, proposal.id, request.id, topic.id],
  )
  await notifyEditProposal(client, { topicId: topic.id, proposalId: proposal.id, authorId: agent.id })

  return {
    id: proposal.id,
    author: agent.username,
    displayName: agent.agent_name || agent.username,
    model: normalizeModel(model || result?.modelName || result?.model),
    createdAt: proposal.created_at,
  }
}

// "Improve the page": the agent's researched body becomes the current
// revision right away, published by the clearly identified agent account.
// The previous revision stays in history; if the page changed while the agent
// worked, nothing is overwritten.
export async function publishTopicAiRevision(client, { request, result, model }) {
  const topicResult = await client.query(
    `SELECT t.id, coalesce(t.node_id, (SELECT id FROM nodes WHERE is_home LIMIT 1)) AS node_id,
            t.status, current.revision_id, revision.title, revision.body_markdown, revision.summary
       FROM topics t
       JOIN topic_current_revisions current
         ON current.topic_id = t.id AND current.locale = $2
       JOIN revisions revision ON revision.id = current.revision_id
      WHERE t.id = $1
      FOR UPDATE OF t, current, revision`,
    [request.topic_id, request.locale],
  )
  const topic = topicResult.rows[0]
  if (!topic || topic.status === 'deleted') throw nonRetryableError('The page is no longer available.')
  if (topic.revision_id !== request.base_revision_id) {
    throw nonRetryableError('The page was edited while the agent worked; nothing was overwritten.')
  }

  const sources = Array.isArray(result?.sources) ? result.sources : []
  if (sources.length < 1 || sources.length > 5) throw nonRetryableError('The improved page must include 1–5 sources.')
  const body = String(result?.proposedBody || '').trim()
  const rules = reviewArticle(
    { title: topic.title, body },
    await loadArticleRuleOverrides(client),
    { locale: request.locale, scope: 'text' },
  )
  if (!rules.ok) throw rulesReviewError(rules.findings)

  const modelName = normalizeModel(model || result?.modelName || result?.model)
  const agent = await ensureTopicAiAgent(client, topic.node_id, modelName)
  const inserted = await client.query(
    `INSERT INTO revisions (topic_id, parent_revision_id, author_id, locale, title, body_markdown, summary, authorship_mode, model_name)
     VALUES ($1, $2, $3, $4, $5, $6, $7, 'ai_generated_unreviewed', $8)
     RETURNING id, created_at`,
    [topic.id, topic.revision_id, agent.id, request.locale, topic.title, body, topic.summary, modelName],
  )
  const revision = inserted.rows[0]
  await recordRevisionDiff(client, {
    revisionId: revision.id,
    parentRevisionId: topic.revision_id,
    parentTitle: topic.title,
    parentBody: topic.body_markdown,
    title: topic.title,
    body,
    origin: 'accepted_edit',
    introducedBy: agent.id,
    confirmedBy: request.requester_id,
    introducedAt: revision.created_at,
    confirmedAt: revision.created_at,
  })
  await client.query(
    'UPDATE topic_current_revisions SET revision_id = $3 WHERE topic_id = $1 AND locale = $2',
    [topic.id, request.locale, revision.id],
  )
  await client.query(
    `INSERT INTO citations (topic_id, source_id, revision_id, locator, note)
     SELECT topic_id, source_id, $2, locator, note FROM citations WHERE revision_id = $1`,
    [topic.revision_id, revision.id],
  )
  for (const source of sources) {
    const saved = await client.query(
      `INSERT INTO sources (canonical_url, title, publisher, source_type)
       VALUES ($1, NULLIF($2::text, ''), NULLIF($3::text, ''), 'external')
       ON CONFLICT (canonical_url) DO UPDATE SET
         title = coalesce(sources.title, EXCLUDED.title), publisher = coalesce(sources.publisher, EXCLUDED.publisher)
       RETURNING id`,
      [source.url, source.title || '', source.publisher || ''],
    )
    await client.query(
      `INSERT INTO citations (topic_id, source_id, revision_id, locator, note)
       SELECT $1, $2, $3, NULLIF($4::text, ''), NULLIF($5::text, '')
        WHERE NOT EXISTS (SELECT 1 FROM citations WHERE revision_id = $3 AND source_id = $2)`,
      [topic.id, saved.rows[0].id, revision.id, source.locator || '', source.note || ''],
    )
  }
  await client.query('UPDATE topics SET updated_at = now() WHERE id = $1', [topic.id])
  await client.query(
    `INSERT INTO actor_audit_log (actor_id, action, target_type, target_id, details)
     VALUES ($1, 'topic_ai_revision_published', 'topic', $2,
             jsonb_build_object('request_id', $3::text, 'revision_id', $4::text, 'model', $5::text))`,
    [agent.id, topic.id, request.id, revision.id, modelName],
  )
  return {
    id: revision.id,
    author: agent.username,
    displayName: agent.agent_name || agent.username,
    model: modelName,
    createdAt: revision.created_at,
  }
}

export async function publishTopicAiOverview(client, { request, result, model }) {
  const topicResult = await client.query(
    `SELECT t.id, coalesce(t.node_id, (SELECT id FROM nodes WHERE is_home LIMIT 1)) AS node_id,
            t.status, current.revision_id, current.locale,
            revision.title, revision.body_markdown, revision.summary,
            revision.authorship_mode, revision.model_name, revision.human_contribution
       FROM topics t
       JOIN topic_current_revisions current
         ON current.topic_id = t.id AND current.locale = $2
       JOIN revisions revision ON revision.id = current.revision_id
      WHERE t.id = $1 AND current.revision_id = $3
      FOR UPDATE OF t, current, revision`,
    [request.topic_id, request.locale, request.base_revision_id],
  )
  const topic = topicResult.rows[0]
  if (!topic || topic.status === 'deleted') {
    throw nonRetryableError('The page changed or is no longer available for an overview update.')
  }

  const checked = validateArticleOverview(result?.overview ?? result?.summary)
  if (!checked.ok || !checked.value || checked.value.length < 20) {
    throw nonRetryableError('The AI provider returned an invalid page overview.')
  }

  const agent = await ensureTopicAiAgent(client, topic.node_id, model || result?.modelName || result?.model)
  const inserted = await client.query(
    `INSERT INTO revisions (
       topic_id, parent_revision_id, author_id, locale, title, body_markdown, summary,
       authorship_mode, model_name, human_contribution
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     RETURNING id, topic_id, parent_revision_id, author_id, locale, created_at`,
    [topic.id, request.base_revision_id, agent.id, topic.locale, topic.title, topic.body_markdown,
      checked.value, topic.authorship_mode || 'legacy_undisclosed', topic.model_name, topic.human_contribution],
  )
  const revision = inserted.rows[0]

  await recordRevisionDiff(client, {
    revisionId: revision.id,
    parentRevisionId: request.base_revision_id,
    parentTitle: topic.title,
    parentBody: topic.body_markdown,
    title: topic.title,
    body: topic.body_markdown,
    origin: 'author_edit',
    introducedBy: agent.id,
    confirmedBy: agent.id,
    introducedAt: revision.created_at,
    confirmedAt: revision.created_at,
  })
  const moved = await client.query(
    `UPDATE topic_current_revisions SET revision_id = $1
      WHERE topic_id = $2 AND locale = $3 AND revision_id = $4`,
    [revision.id, topic.id, topic.locale, request.base_revision_id],
  )
  if (moved.rowCount !== 1) {
    throw nonRetryableError('The page changed while the overview was being updated. Run the request again.')
  }
  await client.query(
    `UPDATE topics SET summary = $2, updated_at = now() WHERE id = $1`,
    [topic.id, checked.value],
  )
  await client.query(
    `INSERT INTO citations (topic_id, source_id, revision_id, locator, note)
     SELECT topic_id, source_id, $2, locator, note
       FROM citations
      WHERE revision_id = $1`,
    [request.base_revision_id, revision.id],
  )
  await client.query(
    `INSERT INTO actor_audit_log (actor_id, action, target_type, target_id, details)
     VALUES ($1, 'topic_ai_overview_updated', 'topic', $2,
             jsonb_build_object('source', 'topic_ai_request', 'request_id', $3::text, 'revision_id', $4::text))`,
    [agent.id, topic.id, request.id, revision.id],
  )

  return {
    revisionId: revision.id,
    author: agent.username,
    displayName: agent.agent_name || agent.username,
    model: normalizeModel(model || result?.modelName || result?.model),
    createdAt: revision.created_at,
  }
}

async function ensureTopicAiAgent(client, nodeId, model) {
  const existing = await client.query(
    `SELECT id, kind, username, agent_name, agent_model
       FROM actors
      WHERE node_id IS NOT DISTINCT FROM $1
        AND username = $2
      FOR UPDATE`,
    [nodeId, TOPIC_AI_AGENT_USERNAME],
  )
  let actor = existing.rows[0]
  if (actor && actor.kind !== 'agent') {
    throw nonRetryableError('The reserved Neron Agent username is already used by another account.')
  }
  const modelLabel = normalizeModel(model)
  if (!actor) {
    const inserted = await client.query(
      `INSERT INTO actors (node_id, kind, username, agent_name, agent_model, account_status)
       VALUES ($1, 'agent', $2, $3, $4, 'active')
       RETURNING id, kind, username, agent_name, agent_model`,
      [nodeId, TOPIC_AI_AGENT_USERNAME, TOPIC_AI_AGENT_NAME, modelLabel],
    )
    actor = inserted.rows[0]
  } else {
    const updated = await client.query(
      `UPDATE actors
          SET agent_name = $2, agent_model = $3, account_status = 'active'
        WHERE id = $1 AND kind = 'agent'
        RETURNING id, kind, username, agent_name, agent_model`,
      [actor.id, TOPIC_AI_AGENT_NAME, modelLabel],
    )
    actor = updated.rows[0]
  }
  return actor
}

function normalizeModel(value) {
  const model = String(value || '').replace(/[\u0000-\u001f]/g, '').replace(/\s+/g, ' ').trim()
  return (model || DEFAULT_MODEL).slice(0, 80)
}

function nonRetryableError(message) {
  const error = new Error(message)
  error.status = 422
  return error
}
