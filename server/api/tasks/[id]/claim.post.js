import { createError, readBody } from 'h3'
import { getDatabase } from '../../../utils/database.js'
import { requireWritingTaskActor } from '../../../utils/writing-tasks.js'
import { isContentTaskUuid } from '../../../utils/content-tasks.js'
import { readableTopicSql } from '../../../utils/page-access.js'

export default defineEventHandler(async (event) => {
  const actor = await requireWritingTaskActor(event)
  const id = String(getRouterParam(event, 'id') || '').toLowerCase()
  if (!isContentTaskUuid(id)) throw createError({ statusCode: 404, statusMessage: 'Task not found.' })
  const body = await readBody(event)
  const action = body?.action || 'claim'
  if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some(key => key !== 'action') || !['claim', 'release'].includes(action)) {
    throw createError({ statusCode: 400, statusMessage: 'Choose claim or release.' })
  }
  const label = actor.display_name || actor.agent_name || actor.username
  const database = getDatabase()
  const result = action === 'claim'
    ? await database.query(
        `UPDATE content_tasks task
            SET status = 'claimed', claimed_by = $2, claim_actor_label = $3,
                claim_expires_at = now() + interval '2 hours', updated_at = now()
         WHERE task.id = $1::uuid
           AND (task.topic_id IS NULL OR EXISTS (SELECT 1 FROM topics topic WHERE topic.id = task.topic_id AND ${readableTopicSql('topic', '$2')}))
           AND (task.status = 'open'
             OR (task.status = 'claimed' AND task.claim_expires_at <= now())
             OR (task.status = 'claimed' AND task.claimed_by = $2))
          RETURNING task.id, task.status, task.claimed_by, task.claim_actor_label, task.claim_expires_at, task.updated_at`,
        [id, actor.id, label],
      )
    : await database.query(
        `UPDATE content_tasks task
            SET status = 'open', claimed_by = NULL, claim_actor_label = NULL,
                claim_expires_at = NULL, updated_at = now()
         WHERE task.id = $1::uuid
           AND (task.topic_id IS NULL OR EXISTS (SELECT 1 FROM topics topic WHERE topic.id = task.topic_id AND ${readableTopicSql('topic', '$2')}))
           AND task.status = 'claimed' AND task.claimed_by = $2
          RETURNING task.id, task.status, task.claimed_by, task.claim_actor_label, task.claim_expires_at, task.updated_at`,
        [id, actor.id],
      )
  if (!result.rows[0]) throw createError({ statusCode: 409, statusMessage: 'This task is unavailable or claimed by another contributor.' })
  await database.query(
    `INSERT INTO content_task_events (task_id, actor_id, event_type, details)
     VALUES ($1, $2, $3, '{}'::jsonb)`,
    [id, actor.id, action === 'claim' ? 'claimed' : 'released'],
  )
  return { task: result.rows[0], actor: { id: actor.id, username: actor.username, kind: actor.kind } }
})
