import { createError, getHeader, getQuery } from 'h3'
import { getHumanActor } from '../../utils/auth.js'
import { getAgentActor } from '../../utils/agent-auth.js'
import { getDatabase } from '../../utils/database.js'
import { readableTopicSql } from '../../utils/page-access.js'
import { canManageContentTask, contentTaskSelectSql, presentContentTask, CONTENT_TASK_STATUSES, CONTENT_TASK_TYPES } from '../../utils/content-tasks.js'

export default defineEventHandler(async (event) => {
  const actor = await optionalTaskActor(event)
  const query = getQuery(event)
  const requestedStatus = String(query.status || 'active')
  const statuses = requestedStatus === 'active'
    ? ['open', 'claimed', 'submitted', 'under_review']
    : requestedStatus === 'all' ? CONTENT_TASK_STATUSES : [requestedStatus]
  if (statuses.some(status => !CONTENT_TASK_STATUSES.includes(status))) {
    throw createError({ statusCode: 400, statusMessage: 'Choose a valid task status.' })
  }
  const taskType = String(query.type || query.taskType || '')
  if (taskType && !CONTENT_TASK_TYPES.includes(taskType)) throw createError({ statusCode: 400, statusMessage: 'Choose a valid task type.' })
  const limitValue = Number.parseInt(String(query.limit || '30'), 10)
  const offsetValue = Number.parseInt(String(query.offset || '0'), 10)
  const limit = Number.isFinite(limitValue) ? Math.min(Math.max(limitValue, 1), 100) : 30
  const offset = Number.isFinite(offsetValue) ? Math.min(Math.max(offsetValue, 0), 10_000) : 0
  const topicId = isUuid(query.topic) ? String(query.topic).toLowerCase() : null
  const reason = typeof query.reason === 'string' ? query.reason.trim().slice(0, 80) : ''
  const actorId = actor?.id || null
  const database = getDatabase()
  const result = await database.query(
    `${contentTaskSelectSql()}
      WHERE task.status = ANY($1::text[])
        AND ($2 = '' OR task.task_type = $2)
        AND ($3 = '' OR task.reason = $3)
        AND ($4::uuid IS NULL OR task.topic_id = $4::uuid)
        AND (task.topic_id IS NULL OR ${readableTopicSql('topic', '$5')})
      ORDER BY CASE WHEN task.status = 'open' THEN 0 WHEN task.status = 'claimed' THEN 1 ELSE 2 END,
               task.last_promoted_at DESC NULLS LAST, task.created_at DESC, task.id DESC
      LIMIT $6 OFFSET $7`,
    [statuses, taskType, reason, topicId, actorId, limit, offset],
  )
  const count = await database.query(
    `SELECT count(*)::int AS total
       FROM content_tasks task
       LEFT JOIN topics topic ON topic.id = task.topic_id
      WHERE task.status = ANY($1::text[])
        AND ($2 = '' OR task.task_type = $2)
        AND ($3 = '' OR task.reason = $3)
        AND ($4::uuid IS NULL OR task.topic_id = $4::uuid)
        AND (task.topic_id IS NULL OR ${readableTopicSql('topic', '$5')})`,
    [statuses, taskType, reason, topicId, actorId],
  )
  return {
    items: result.rows.map(row => ({ ...presentContentTask(row), canManage: canManageContentTask(actor, row) })),
    status: requestedStatus,
    type: taskType || null,
    limit,
    offset,
    total: Number(count.rows[0]?.total || 0),
  }
})

async function optionalTaskActor(event) {
  const authorization = getHeader(event, 'authorization') || ''
  if (authorization) return getAgentActor(event)
  return getHumanActor(event)
}

function isUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || ''))
}
