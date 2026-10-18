import { createError } from 'h3'
import { enforceSameOrigin, requireHumanActor } from '../../../utils/auth.js'
import { getDatabase } from '../../../utils/database.js'
import { canManageContentTask, contentTaskSelectSql, isContentTaskUuid } from '../../../utils/content-tasks.js'

export default defineEventHandler(async (event) => {
  enforceSameOrigin(event)
  const actor = await requireHumanActor(event)
  const taskId = String(getRouterParam(event, 'id') || '').toLowerCase()
  if (!isContentTaskUuid(taskId)) throw createError({ statusCode: 404, statusMessage: 'Task not found.' })
  const database = getDatabase()
  const selected = await database.query(`${contentTaskSelectSql()} WHERE task.id = $1::uuid`, [taskId])
  const task = selected.rows[0]
  if (!task) throw createError({ statusCode: 404, statusMessage: 'Task not found.' })
  if (!canManageContentTask(actor, task)) throw createError({ statusCode: 403, statusMessage: 'Only the page author or a moderator can promote this task.' })
  const updated = await database.query(
    `UPDATE content_tasks
        SET last_promoted_at = now(), updated_at = now()
      WHERE id = $1
        AND (last_promoted_at IS NULL OR last_promoted_at <= now() - interval '7 days')
      RETURNING id, status, last_promoted_at, updated_at`,
    [taskId],
  )
  if (!updated.rows[0]) throw createError({ statusCode: 409, statusMessage: 'This task can be promoted once every 7 days.' })
  await database.query(
    `INSERT INTO content_task_events (task_id, actor_id, event_type, details)
     VALUES ($1, $2, 'promoted', '{}'::jsonb)`,
    [taskId, actor.id],
  )
  return { task: updated.rows[0] }
})
