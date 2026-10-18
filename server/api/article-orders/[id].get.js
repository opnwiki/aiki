import { createError, getHeader } from 'h3'
import { orderAccessTokenHash } from '../../utils/article-orders.js'
import { queryDatabase } from '../../utils/database.js'
import { enforceRateLimit } from '../../utils/rate-limit.js'

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const ACCESS_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/

export default defineEventHandler(async (event) => {
  await enforceRateLimit(event, { action: 'article-order-status', limit: 120 })
  const { id } = getRouterParams(event)
  const authorization = getHeader(event, 'authorization') || ''
  const token = authorization.startsWith('Bearer ') ? authorization.slice(7) : ''
  if (!UUID_PATTERN.test(id || '') || !ACCESS_TOKEN_PATTERN.test(token)) {
    throw createError({ statusCode: 404, statusMessage: 'Article order not found.' })
  }

  const result = await queryDatabase(
    `SELECT orders.id, assessment.query_text, assessment.locale, orders.status, orders.created_at, orders.updated_at,
            orders.started_at, orders.finished_at, orders.error_code, orders.execution_state,
            orders.provider_cost,
            task.id AS writing_task_id, task.status AS writing_task_status, topics.slug AS result_slug
       FROM article_order_submissions orders
       JOIN article_order_assessments assessment ON assessment.id = orders.assessment_id
       LEFT JOIN article_writing_tasks task ON task.order_id = orders.id
       LEFT JOIN topics ON topics.id = orders.result_topic_id
      WHERE orders.id = $1 AND orders.access_token_hash = $2
      LIMIT 1`,
    [id, orderAccessTokenHash(token)],
  )
  const order = result.rows[0]
  if (!order) throw createError({ statusCode: 404, statusMessage: 'Article order not found.' })

  return {
    order: {
      id: order.id,
      query: order.query_text,
      locale: order.locale,
      status: order.status,
      createdAt: order.created_at,
      updatedAt: order.updated_at,
      startedAt: order.started_at,
      finishedAt: order.finished_at,
      resultPath: order.result_slug ? `/${encodeURIComponent(order.result_slug)}` : null,
      writingTaskId: order.writing_task_id,
      writingTaskStatus: order.writing_task_status,
      statusDescription: order.execution_state === 'community' && order.writing_task_status === 'open' ? 'Available for a community writer' : null,
      error: order.error_code ? 'executor_unavailable_task_saved' : null,
      providerCost: order.provider_cost || null,
    },
    execution: order.execution_state,
  }
})
