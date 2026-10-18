import { createError, getHeader, readBody, setResponseStatus } from 'h3'
import { fetchStaticaAssessment, orderAccessTokenHash, orderRequestHash, validateOrderRequest } from '../../utils/article-orders.js'
import { getTrustedClientIp, normalizeIpAddress } from '../../utils/client-ip.js'
import { getHumanActor } from '../../utils/auth.js'
import { getDatabase } from '../../utils/database.js'
import { enforceRateLimit } from '../../utils/rate-limit.js'
import { loadAgentProvider } from '../../utils/agent-provider.js'

const DAY_START_UTC_SQL = "date_trunc('day', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'"
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/

export default defineEventHandler(async (event) => {
  enforceSameOrigin(event)
  await enforceRateLimit(event, { action: 'article-order-create', limit: 12 })

  const checked = validateOrderRequest(await readBody(event))
  if (!checked.ok) throw createError({ statusCode: 400, statusMessage: 'Please check the article-order details.' })

  const ip = getTrustedClientIp(event.node.req.headers, event.node.req.socket?.remoteAddress)
  const normalizedIp = normalizeIpAddress(ip)
  if (!normalizedIp) throw createError({ statusCode: 503, statusMessage: 'Free order eligibility could not be checked. Please try again later.' })

  const idempotencyKey = getHeader(event, 'idempotency-key') || ''
  const accessToken = getHeader(event, 'x-article-order-access-token') || ''
  if (!TOKEN_PATTERN.test(idempotencyKey) || !TOKEN_PATTERN.test(accessToken)) {
    throw createError({ statusCode: 400, statusMessage: 'Please reload the page and retry the article order.' })
  }
  const requestKeyHash = orderRequestHash('', idempotencyKey)
  const accessTokenHash = orderAccessTokenHash(accessToken)
  const database = getDatabase()
  const existing = await findExisting(database, requestKeyHash, normalizedIp)
  if (existing) {
    assertSameRequest(existing, checked.value)
    if (existing.access_token_hash !== accessTokenHash) throw requestConflict()
    return respondWithStoredOrder(event, existing, true, accessToken)
  }

  const actor = await getHumanActor(event)
  const wantsAgent = checked.value.launchAgent === true
  const createOnly = checked.value.createOnly === true
  if (wantsAgent && !actor) throw createError({ statusCode: 401, statusMessage: 'Sign in to launch Neron Agent.' })
  if (wantsAgent && !await loadAgentProvider(getDatabase(), useRuntimeConfig())) {
    throw createError({ statusCode: 503, statusMessage: 'Neron Agent is not available right now; no WPG was charged.' })
  }
  const assessment = wantsAgent
    ? { isClean: false, response: { skipped: 'paid-agent' } }
    : createOnly
      ? { isClean: false, response: { skipped: 'create-only' } }
      : await fetchStaticaAssessment(normalizedIp)
  const client = await database.connect()
  let outcome
  let order
  let duplicate = false
  let paidAgent = false
  try {
    await client.query('BEGIN')
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [normalizedIp])

    const previous = await client.query(
      `SELECT assessment.outcome, assessment.query_text, assessment.locale,
              assessment.search_context,
              orders.id AS order_id, orders.access_token_hash, orders.status,
              orders.created_at AS order_created_at, orders.updated_at,
              orders.started_at, orders.finished_at, orders.result_topic_id, orders.error_code,
              orders.provider_cost,
              orders.execution_state, task.id AS writing_task_id,
              task.status AS writing_task_status, task.claimed_by, task.claim_actor_label,
              task.claim_expires_at
         FROM article_order_assessments assessment
         LEFT JOIN article_order_submissions orders ON orders.assessment_id = assessment.id
         LEFT JOIN article_writing_tasks task ON task.order_id = orders.id
        WHERE assessment.request_key_hash = $1 AND assessment.client_ip = $2::inet
        LIMIT 1
        FOR UPDATE OF assessment`,
      [requestKeyHash, normalizedIp],
    )
    if (previous.rows[0]) {
      const old = previous.rows[0]
      assertSameRequest(old, checked.value)
      outcome = old.outcome
      order = old
      duplicate = true
    } else {
      if (wantsAgent) {
        await client.query('SELECT id FROM actors WHERE id = $1 AND account_status = \'active\' FOR UPDATE', [actor.id])
        const balanceResult = await client.query(
          'SELECT coalesce(sum(amount), 0)::text AS balance FROM actor_token_ledger WHERE actor_id = $1',
          [actor.id],
        )
        const balance = BigInt(balanceResult.rows[0]?.balance || '0')
        if (balance < 1n) throw createError({ statusCode: 402, statusMessage: 'At least 1 WPG is required to run Neron Agent.' })
        paidAgent = true
        outcome = 'agent'
      } else if (createOnly) {
        outcome = 'community'
      } else {
        const todaysCleanOrders = await client.query(
          `SELECT count(*)::int AS count
             FROM article_order_assessments
            WHERE client_ip = $1::inet AND outcome = 'queued' AND created_at >= ${DAY_START_UTC_SQL}`,
          [normalizedIp],
        )
        if (assessment.isClean !== true) outcome = 'rejected_not_clean'
        else if (Number(todaysCleanOrders.rows[0]?.count || 0) >= 1) outcome = 'rejected_daily_limit'
        else outcome = 'queued'
      }

      const audit = await client.query(
        `INSERT INTO article_order_assessments
          (actor_id, request_key_hash, client_ip, statica_response, statica_is_clean, query_text, locale, outcome, search_context)
         VALUES ($1, $2, $3::inet, $4::jsonb, $5, $6, $7, $8, $9::jsonb)
         RETURNING id, created_at`,
        [actor?.id || null, requestKeyHash, normalizedIp, JSON.stringify(assessment.response), assessment.isClean,
          checked.value.query, checked.value.locale, outcome, JSON.stringify(checked.value.context)],
      )

      const freeRun = outcome === 'queued'
      const inserted = await client.query(
        `INSERT INTO article_order_submissions (assessment_id, access_token_hash, execution_state, status, error_code)
         VALUES ($1, $2, $3, 'queued', NULL)
         RETURNING id, status, created_at, updated_at, started_at, finished_at, result_topic_id, error_code, execution_state`,
        [audit.rows[0].id, accessTokenHash, freeRun ? 'pending' : 'community'],
      )
      const writingTask = await client.query(
        `INSERT INTO article_writing_tasks (order_id, status)
         VALUES ($1, $2)
         RETURNING id, status`,
        [inserted.rows[0].id, freeRun ? 'closed' : 'open'],
      )
      if (paidAgent) {
        await client.query(
          `UPDATE article_writing_tasks
              SET status = 'claimed', claimed_by = $2, claim_actor_label = $3,
                  claim_expires_at = now() + interval '2 hours', updated_at = now()
            WHERE id = $1`,
          [writingTask.rows[0].id, actor.id, actor.username],
        )
      }
      order = {
        ...inserted.rows[0], order_id: inserted.rows[0].id,
        order_created_at: inserted.rows[0].created_at, query_text: checked.value.query,
        locale: checked.value.locale, access_token_hash: accessTokenHash,
        writing_task_id: writingTask.rows[0].id, writing_task_status: paidAgent ? 'claimed' : writingTask.rows[0].status,
      }
    }
    await client.query('COMMIT')
  } catch (error) {
    await client.query('ROLLBACK')
    if (error?.code === '23505') throw requestConflict()
    throw error
  } finally {
    client.release()
  }

  if (duplicate) {
    if (!order?.order_id || order.access_token_hash !== accessTokenHash) throw requestConflict()
    const current = await findExisting(database, requestKeyHash, normalizedIp)
    return respondWithStoredOrder(event, current || order, true, accessToken)
  }
  setResponseStatus(event, 202)
  const current = await findExisting(database, requestKeyHash, normalizedIp)
  return respondWithStoredOrder(event, current || order, false, accessToken)
})

async function findExisting(database, requestKeyHash, normalizedIp) {
  const result = await database.query(
    `SELECT assessment.outcome, assessment.query_text, assessment.locale,
            orders.id AS order_id, orders.access_token_hash, orders.status,
            orders.created_at AS order_created_at, orders.updated_at,
            orders.started_at, orders.finished_at, orders.result_topic_id, orders.error_code,
            orders.provider_cost,
            orders.execution_state, task.id AS writing_task_id,
            task.status AS writing_task_status, task.claimed_by, task.claim_actor_label,
            task.claim_expires_at
       FROM article_order_assessments assessment
       LEFT JOIN article_order_submissions orders ON orders.assessment_id = assessment.id
       LEFT JOIN article_writing_tasks task ON task.order_id = orders.id
      WHERE assessment.request_key_hash = $1 AND assessment.client_ip = $2::inet
      LIMIT 1`,
    [requestKeyHash, normalizedIp],
  )
  return result.rows[0] || null
}

function assertSameRequest(prior, request) {
  if (prior.query_text !== request.query || prior.locale !== request.locale) throw requestConflict()
}

function requestConflict() {
  return createError({ statusCode: 409, statusMessage: 'This request key has already been used.' })
}

function respondWithStoredOrder(event, order, duplicate, accessToken) {
  setResponseStatus(event, duplicate ? 200 : 202)
  return {
    order: {
      id: order.order_id,
      query: order.query_text,
      locale: order.locale,
      status: order.status,
      createdAt: order.order_created_at,
      updatedAt: order.updated_at,
      startedAt: order.started_at,
      finishedAt: order.finished_at,
      resultTopicId: order.result_topic_id,
      writingTaskId: order.writing_task_id || null,
      writingTaskStatus: order.writing_task_status || null,
      claimedBy: order.claimed_by || null,
      claimActor: order.claim_actor_label || null,
      claimExpiresAt: order.claim_expires_at || null,
      error: order.error_code ? 'executor_unavailable_task_saved' : null,
      providerCost: order.provider_cost || null,
      accessToken,
    },
    duplicate,
    execution: order.execution_state || 'pending',
  }
}
