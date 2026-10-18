import { createError, getRouterParam, readBody, setResponseStatus } from 'h3'
import { enforceSameOrigin, requireHumanActor } from '../../../../utils/auth.js'
import { getDatabase } from '../../../../utils/database.js'
import { enforceRateLimit } from '../../../../utils/rate-limit.js'
import { readableTopicSql } from '../../../../utils/page-access.js'
import { topicKeyPredicate } from '../../../../utils/page-address.js'
import { SUPPORTED_LOCALES } from '../../../../utils/validation.js'
import { TOPIC_AI_REQUEST_TYPES, buildTopicAiPrompt } from '../../../../utils/topic-ai.js'
import { loadAgentProvider } from '../../../../utils/agent-provider.js'

const AI_ACTION_PRICE = 1
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export default defineEventHandler(async (event) => {
  enforceSameOrigin(event)
  const actor = await requireHumanActor(event)
  await enforceRateLimit(event, { action: 'topic-ai-request', limit: 8 })

  const slug = getRouterParam(event, 'slug')
  if (!slug || !/^[\p{L}\p{N}]+(?:-[\p{L}\p{N}]+)*$/u.test(slug)) {
    throw createError({ statusCode: 404, statusMessage: 'Topic not found.' })
  }

  if (!await loadAgentProvider(getDatabase(), useRuntimeConfig())) {
    throw createError({ statusCode: 503, statusMessage: 'AI assistance is not configured on this node.' })
  }

  const body = await readBody(event)
  const requestType = String(body?.requestType || '')
  const locale = String(body?.locale || 'en')
  const instruction = String(body?.instruction || '').replace(/\0/g, '').trim()
  if (!TOPIC_AI_REQUEST_TYPES.includes(requestType) || requestType === 'supplement' || !SUPPORTED_LOCALES.includes(locale) || instruction.length > 1000) {
    throw createError({ statusCode: 400, statusMessage: 'Choose an AI action and use a short instruction.' })
  }

  const client = await getDatabase().connect()
  let request
  try {
    await client.query('BEGIN')
    const topicResult = await client.query(
      `SELECT t.id, t.kind, coalesce(nullif(t.summary, ''), revision.summary) AS summary,
              current.revision_id, revision.title, revision.body_markdown
         FROM topics t
         JOIN topic_current_revisions current ON current.topic_id = t.id AND current.locale = $2
         JOIN revisions revision ON revision.id = current.revision_id
        WHERE ${topicKeyPredicate('t', '$1')}
          AND ${readableTopicSql('t', '$3')}
        FOR SHARE OF t, current, revision`,
      [slug, locale, actor.id],
    )
    const topic = topicResult.rows[0]
    if (!topic) throw createError({ statusCode: 404, statusMessage: 'Topic not found.' })
    // Every AI action except re-running the free page check costs 1 WPG,
    // refunded automatically when the run does not finish.
    const charged = requestType !== 'classify_page'
    if (charged) {
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1)::bigint)', [`wpg:${actor.id}`])
      const balance = await client.query('SELECT coalesce(sum(amount), 0)::bigint AS balance FROM actor_token_ledger WHERE actor_id = $1', [actor.id])
      if (Number(balance.rows[0].balance) < AI_ACTION_PRICE) {
        throw createError({ statusCode: 402, statusMessage: 'Not enough WPG: an AI action costs 1 WPG.', data: { error: 'insufficient_balance', price: AI_ACTION_PRICE, balance: Number(balance.rows[0].balance) } })
      }
    }

    const repliesResult = await client.query(
      `SELECT reply.id, reply.parent_reply_id, reply.body_markdown AS body,
              CASE WHEN reply.author_hidden THEN 'anonymous' ELSE coalesce(actor.username, 'community') END AS author
         FROM replies reply
         LEFT JOIN actors actor ON actor.id = reply.author_id
        WHERE reply.topic_id = $1 AND reply.status = 'published'
        ORDER BY reply.created_at ASC
        LIMIT 40`,
      [topic.id],
    )
    const prompt = buildTopicAiPrompt({
      requestType,
      locale,
      title: topic.title,
      body: topic.body_markdown,
      summary: topic.summary,
      replies: repliesResult.rows,
      instruction,
    })
    const inserted = await client.query(
      `INSERT INTO topic_ai_requests
         (topic_id, requester_id, request_type, locale, base_revision_id, instruction, prompt)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id, topic_id, request_type, locale, base_revision_id, status, progress_percent, progress_stage,
                 progress_message, provider_cost, result, published_reply_id, published_proposal_id,
                 updated_overview_revision_id, error_code, error_message, created_at, updated_at`,
      [topic.id, actor.id, requestType, locale, topic.revision_id, instruction, prompt],
    )
    request = serializeRequest(inserted.rows[0])
    if (charged) {
      await client.query(
        `INSERT INTO actor_token_ledger (actor_id, amount, reason, source_type, source_id, idempotency_key, description)
         VALUES ($1, $2, 'agent_run_charge', 'agent_run', $3, $4, $5)`,
        [actor.id, -AI_ACTION_PRICE, request.id, `topic-ai-charge:${request.id}`, `1 WPG for the AI action "${requestType}" on a page`],
      )
    }
    await client.query(
      `INSERT INTO actor_audit_log (actor_id, action, target_type, target_id, details)
       VALUES ($1, 'topic_ai_request_created', 'topic_ai_request', $2,
               jsonb_build_object('topic_id', $3::text, 'request_type', $4::text))`,
      [actor.id, request.id, topic.id, requestType],
    )
    await client.query('COMMIT')
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }

  setResponseStatus(event, 202)
  return { request }
})

function serializeRequest(row) {
  return {
    id: row.id,
    topicId: row.topic_id,
    requestType: row.request_type,
    locale: row.locale,
    baseRevisionId: row.base_revision_id,
    status: row.status,
    progressPercent: Number(row.progress_percent || 0),
    progressStage: row.progress_stage || null,
    progressMessage: row.progress_message || null,
    providerCost: row.provider_cost || null,
    result: row.result || null,
    publishedReplyId: row.published_reply_id || null,
    publishedProposalId: row.published_proposal_id || null,
    updatedOverviewRevisionId: row.updated_overview_revision_id || null,
    errorCode: row.error_code || null,
    errorMessage: row.error_message || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}
