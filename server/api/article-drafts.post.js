import { createError, readBody, setResponseStatus } from 'h3'
import { enforceSameOrigin, requireHumanActor } from '../utils/auth.js'
import { getDatabase } from '../utils/database.js'
import { allocateTopicSlug } from '../utils/page-address.js'
import { withShortPath } from '../utils/page-number.js'
import { preferredLocale, SUPPORTED_LOCALES } from '../utils/validation.js'
import { enforceContentQuota, enforceRateLimit } from '../utils/rate-limit.js'
import { recordRevisionDiff } from '../utils/revision-history.js'
import { buildTopicAiPrompt } from '../utils/topic-ai.js'
import { buildDraftBody, draftTitle } from '../utils/article-drafts.js'

const MAX_QUERY_LENGTH = 8000

export default defineEventHandler(async (event) => {
  enforceSameOrigin(event)
  const actor = await requireHumanActor(event)
  await enforceRateLimit(event, { action: 'article-draft-create', limit: 20, actor })
  await enforceContentQuota(event, actor, 'page')

  const body = await readBody(event)
  const unknownKey = Object.keys(body || {}).find(key => !['query', 'locale', 'requestedKind'].includes(key))
  if (unknownKey) throw createError({ statusCode: 400, statusMessage: `Unknown article draft field: ${unknownKey}` })

  const query = String(body?.query ?? '').replace(/\0/g, '').trim()
  const locale = String(body?.locale || 'en')
  const requestedKind = String(body?.requestedKind || '').trim().toLowerCase()
  if (query.length < 1 || query.length > MAX_QUERY_LENGTH) {
    throw createError({ statusCode: 400, statusMessage: `The article request must be 1–${MAX_QUERY_LENGTH} characters.` })
  }
  if (!SUPPORTED_LOCALES.includes(locale)) {
    throw createError({ statusCode: 400, statusMessage: 'Unsupported language.' })
  }
  if (requestedKind && !['question', 'discussion'].includes(requestedKind)) {
    throw createError({ statusCode: 400, statusMessage: 'Unsupported page intent.' })
  }

  const client = await getDatabase().connect()
  let topic
  try {
    await client.query('BEGIN')
    const slug = await allocateTopicSlug(client)
    const created = await client.query(
      `INSERT INTO topics (node_id, author_id, slug, kind, status, summary, hide_author)
       VALUES ($1, $2, $3, 'page', 'unlisted', NULL, NULL)
       RETURNING id, slug, page_number, kind, status, summary, hide_author, created_at`,
      [actor.node_id, actor.id, slug],
    )
    topic = created.rows[0]

    const revision = await client.query(
      `INSERT INTO revisions (topic_id, author_id, locale, title, body_markdown)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, locale, title, body_markdown, authorship_mode, model_name, human_contribution, created_at`,
      [
        topic.id,
        actor.id,
        preferredLocale(locale),
        draftTitle(query),
        buildDraftBody(query, locale),
      ],
    )
    topic.revision = revision.rows[0]
    await recordRevisionDiff(client, {
      revisionId: topic.revision.id,
      title: topic.revision.title,
      body: topic.revision.body_markdown,
      origin: 'publication',
      introducedBy: actor.id,
      confirmedBy: actor.id,
      introducedAt: topic.revision.created_at,
      confirmedAt: topic.revision.created_at,
    })
    await client.query(
      'INSERT INTO topic_current_revisions (topic_id, locale, revision_id) VALUES ($1, $2, $3)',
      [topic.id, topic.revision.locale, topic.revision.id],
    )
    await client.query('INSERT INTO page_read_counts (topic_id) VALUES ($1)', [topic.id])
    const classificationInstruction = requestedKind
      ? `The search action suggests an initial ${requestedKind} intent. Treat this only as a hint; classify the page from the complete text and choose page when it is a generic subject that needs help filling.`
      : ''
    const prompt = buildTopicAiPrompt({
      requestType: 'classify_page',
      locale: topic.revision.locale,
      title: topic.revision.title,
      body: topic.revision.body_markdown,
      summary: null,
      replies: [],
      sourceText: query,
      instruction: classificationInstruction,
    })
    const classification = await client.query(
      `INSERT INTO topic_ai_requests
         (topic_id, requester_id, request_type, locale, base_revision_id, instruction, prompt)
       VALUES ($1, $2, 'classify_page', $3, $4, $5, $6)
       RETURNING id, status, progress_percent, progress_stage, progress_message, provider_cost,
                 result, error_code, error_message, created_at, updated_at`,
      [topic.id, actor.id, topic.revision.locale, topic.revision.id, classificationInstruction, prompt],
    )
    topic.classification = {
      id: classification.rows[0].id,
      status: classification.rows[0].status,
      progressPercent: Number(classification.rows[0].progress_percent || 0),
      progressStage: classification.rows[0].progress_stage || null,
      progressMessage: classification.rows[0].progress_message || null,
    }
    await client.query(
      `INSERT INTO actor_audit_log (actor_id, action, target_type, target_id, details)
       VALUES ($1, 'page_created_from_search', 'topic', $2,
               jsonb_build_object('source', 'search', 'locale', $3::text, 'classification_request_id', $4::text))`,
      [actor.id, topic.id, topic.revision.locale, topic.classification.id],
    )
    await client.query('COMMIT')
  } catch (error) {
    await client.query('ROLLBACK')
    if (error.statusCode) throw createError({ statusCode: error.statusCode, statusMessage: error.message })
    if (error.code === '23505') throw createError({ statusCode: 409, statusMessage: 'A page with a similar address was just created. Please try again.' })
    throw error
  } finally {
    client.release()
  }

  // Opened to everyone by the classifier once the page passes the content check.
  topic.access = 'link'
  setResponseStatus(event, 201)
  return { topic: withShortPath(topic) }
})
