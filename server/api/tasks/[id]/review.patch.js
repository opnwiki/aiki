import { createError, readBody } from 'h3'
import { enforceSameOrigin, requireHumanActor } from '../../../utils/auth.js'
import { getDatabase } from '../../../utils/database.js'
import { acceptContentTaskSolution, canManageContentTask, contentTaskSelectSql, isContentTaskUuid, ensureContentTasks } from '../../../utils/content-tasks.js'
import { enqueueFederationReply } from '../../../utils/federation-outbound.js'

export default defineEventHandler(async (event) => {
  enforceSameOrigin(event)
  const actor = await requireHumanActor(event)
  const taskId = String(getRouterParam(event, 'id') || '').toLowerCase()
  if (!isContentTaskUuid(taskId)) throw createError({ statusCode: 404, statusMessage: 'Task not found.' })
  const body = await readBody(event)
  const action = String(body?.action || '')
  const solutionId = String(body?.solutionId || '').toLowerCase()
  const comment = String(body?.comment || '').replace(/\0/g, '').trim()
  if (!['accept', 'reject'].includes(action) || !isContentTaskUuid(solutionId) || (comment && comment.length > 2000)) {
    throw createError({ statusCode: 400, statusMessage: 'Choose accept or reject and provide a valid solution ID.' })
  }

  const client = await getDatabase().connect()
  try {
    await client.query('BEGIN')
    const taskResult = await client.query(
      `${contentTaskSelectSql()}
        WHERE task.id = $1::uuid
        FOR UPDATE OF task`,
      [taskId],
    )
    const task = taskResult.rows[0]
    if (!task) throw createError({ statusCode: 404, statusMessage: 'Task not found.' })
    if (!canManageContentTask(actor, task)) throw createError({ statusCode: 403, statusMessage: 'Only the page author or a moderator can review this task.' })
    const solution = await client.query(
      `SELECT id, task_id, submitted_by, status FROM content_task_solutions
        WHERE id = $1::uuid AND task_id = $2::uuid AND cycle_no = $3 FOR UPDATE`,
      [solutionId, taskId, task.cycle_no],
    )
    if (!solution.rows[0]) throw createError({ statusCode: 404, statusMessage: 'Task solution not found.' })
    if (!['submitted', 'partially_accepted'].includes(solution.rows[0].status)) throw createError({ statusCode: 409, statusMessage: 'This solution has already been reviewed.' })
    if (solution.rows[0].submitted_by === actor.id) throw createError({ statusCode: 403, statusMessage: 'You cannot review your own solution.' })

    if (action === 'accept') {
      const result = await acceptContentTaskSolution(client, { solutionId, reviewerId: actor.id })
      await client.query(
        `UPDATE content_task_solutions SET review_comment = $2 WHERE id = $1`,
        [solutionId, comment || null],
      )
      if (task.topic_id) await ensureContentTasks(client, { topicId: task.topic_id, creatorId: actor.id })
      await client.query('COMMIT')
      if (result.replyId) {
        try {
          await enqueueFederationReply(getDatabase(), { replyId: result.replyId })
        } catch (error) {
          console.error('[fedify] could not queue accepted task reply', error)
        }
      }
      return { action, result }
    }

    await client.query(
      `UPDATE content_task_solutions
          SET status = 'rejected', reviewed_by = $2, reviewed_at = now(), review_comment = $3
        WHERE id = $1`,
      [solutionId, actor.id, comment || null],
    )
    const other = await client.query(
      `SELECT count(*)::int AS count FROM content_task_solutions
        WHERE task_id = $1 AND cycle_no = $2 AND status = 'submitted'`,
      [taskId, task.cycle_no],
    )
    await client.query(
      `UPDATE content_tasks SET status = CASE WHEN $2::int > 0 THEN 'under_review' ELSE 'open' END,
              auto_publish_allowed = false, claimed_by = NULL, claim_actor_label = NULL,
              claim_expires_at = NULL, updated_at = now()
        WHERE id = $1`,
      [taskId, Number(other.rows[0]?.count || 0)],
    )
    await client.query(
      `INSERT INTO content_task_events (task_id, actor_id, event_type, details)
       VALUES ($1, $2, 'solution_rejected', jsonb_build_object('solution_id', $3::text))`,
      [taskId, actor.id, solutionId],
    )
    await client.query('COMMIT')
    return { action, taskId, solutionId, taskStatus: Number(other.rows[0]?.count || 0) > 0 ? 'under_review' : 'open' }
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
})
