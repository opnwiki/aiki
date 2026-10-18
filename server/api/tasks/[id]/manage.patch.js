import { createError, readBody } from 'h3'
import { enforceSameOrigin, requireHumanActor } from '../../../utils/auth.js'
import { getDatabase } from '../../../utils/database.js'
import { canManageContentTask, contentTaskSelectSql, isContentTaskUuid } from '../../../utils/content-tasks.js'

export default defineEventHandler(async (event) => {
  enforceSameOrigin(event)
  const actor = await requireHumanActor(event)
  const taskId = String(getRouterParam(event, 'id') || '').toLowerCase()
  if (!isContentTaskUuid(taskId)) throw createError({ statusCode: 404, statusMessage: 'Task not found.' })
  const action = String((await readBody(event))?.action || '')
  if (!['resolve', 'reopen'].includes(action)) throw createError({ statusCode: 400, statusMessage: 'Choose resolve or reopen.' })
  const client = await getDatabase().connect()
  try {
    await client.query('BEGIN')
    const selected = await client.query(`${contentTaskSelectSql()} WHERE task.id = $1::uuid FOR UPDATE OF task`, [taskId])
    const task = selected.rows[0]
    if (!task) throw createError({ statusCode: 404, statusMessage: 'Task not found.' })
    if (!canManageContentTask(actor, task)) throw createError({ statusCode: 403, statusMessage: 'Only the page author or a moderator can manage this task.' })
    if (action === 'resolve') {
      await client.query(
        `UPDATE content_tasks SET status = 'resolved', claimed_by = NULL,
                claim_actor_label = NULL, claim_expires_at = NULL, updated_at = now()
          WHERE id = $1`,
        [taskId],
      )
    } else {
      if (task.status !== 'resolved') throw createError({ statusCode: 409, statusMessage: 'Only a resolved task can be reopened.' })
      let baseRevisionId = task.base_revision_id
      if (task.topic_id) {
        const current = await client.query(
          `SELECT revision_id FROM topic_current_revisions
            WHERE topic_id = $1 AND locale = coalesce($2, $3)
            LIMIT 1`,
          [task.topic_id, task.target_locale, task.source_locale],
        )
        baseRevisionId = current.rows[0]?.revision_id || baseRevisionId
      }
      await client.query(
        `UPDATE content_tasks
            SET status = 'open', base_revision_id = $2, cycle_no = cycle_no + 1,
                auto_publish_allowed = true, claimed_by = NULL, claim_actor_label = NULL,
                claim_expires_at = NULL, updated_at = now()
          WHERE id = $1`,
        [taskId, baseRevisionId],
      )
    }
    await client.query(
      `INSERT INTO content_task_events (task_id, actor_id, event_type, details)
       VALUES ($1, $2, $3, '{}'::jsonb)`,
      [taskId, actor.id, action === 'resolve' ? 'resolved' : 'reopened'],
    )
    await client.query('COMMIT')
    return { taskId, action, status: action === 'resolve' ? 'resolved' : 'open' }
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
})
