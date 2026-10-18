import { createError, readBody, setResponseStatus } from 'h3'
import { getDatabase } from '../../../utils/database.js'
import { requireWritingTaskActor } from '../../../utils/writing-tasks.js'
import { isContentTaskUuid, loadContentTask, validateContentSolution } from '../../../utils/content-tasks.js'
import { readableTopicSql } from '../../../utils/page-access.js'
import { notifyTaskSolution } from '../../../utils/notifications.js'
import { enforceContentQuota } from '../../../utils/rate-limit.js'

export default defineEventHandler(async (event) => {
  const actor = await requireWritingTaskActor(event)
  await enforceContentQuota(event, actor, 'solution')
  const id = String(getRouterParam(event, 'id') || '').toLowerCase()
  if (!isContentTaskUuid(id)) throw createError({ statusCode: 404, statusMessage: 'Task not found.' })
  const client = await getDatabase().connect()
  let solutionId
  try {
    await client.query('BEGIN')
    const locked = await client.query(
      `SELECT task.id, task.task_type, task.status, task.claimed_by, task.claim_expires_at,
              task.cycle_no, task.source_locale, task.target_locale, task.auto_publish_allowed,
              task.topic_id, topic.kind AS topic_kind
         FROM content_tasks task
         LEFT JOIN topics topic ON topic.id = task.topic_id
        WHERE task.id = $1::uuid
          AND (task.topic_id IS NULL OR ${readableTopicSql('topic', '$2')})
        FOR UPDATE OF task`,
      [id, actor.id],
    )
    const task = locked.rows[0]
    if (!task) throw createError({ statusCode: 404, statusMessage: 'Task not found.' })
    if (task.status === 'claimed' && task.claimed_by !== actor.id && new Date(task.claim_expires_at) > new Date()) {
      throw createError({ statusCode: 409, statusMessage: 'Another contributor currently holds this task.' })
    }
    if (task.status === 'claimed' && new Date(task.claim_expires_at) <= new Date()) {
      await client.query(`UPDATE content_tasks SET status = 'open', claimed_by = NULL, claim_actor_label = NULL, claim_expires_at = NULL WHERE id = $1`, [id])
    }
    if (!['open', 'claimed', 'submitted', 'under_review'].includes(task.status)) throw createError({ statusCode: 409, statusMessage: 'This task is already resolved.' })
    const checked = validateContentSolution(task.task_type, await readBody(event))
    if (!checked.ok) throw createError({ statusCode: 400, statusMessage: `Invalid solution: ${checked.error}.` })
    if (task.source_locale && task.task_type !== 'translate' && checked.value.locale !== task.source_locale) {
      throw createError({ statusCode: 400, statusMessage: 'Solution language must match the task language.' })
    }
    if (task.task_type === 'translate' && task.target_locale && checked.value.locale !== task.target_locale) {
      throw createError({ statusCode: 400, statusMessage: 'Translation language must match the requested target locale.' })
    }
    if (task.task_type === 'answer_question' && !['question', 'discussion'].includes(task.topic_kind)) throw createError({ statusCode: 409, statusMessage: 'This reply task no longer targets a question or discussion.' })

    const submitted = await client.query(
      `SELECT count(*)::int AS count FROM content_task_solutions
        WHERE task_id = $1 AND cycle_no = $2 AND status = 'submitted'`,
      [id, task.cycle_no],
    )
    const payload = { ...checked.value, submittedBy: actor.id }
    const inserted = await client.query(
      `INSERT INTO content_task_solutions
         (task_id, cycle_no, submitted_by, payload, sources, model_name, client_label, provider_cost, auto_accept_at)
       VALUES ($1, $2, $3, $4::jsonb, $5::jsonb, $6, $7, $8::jsonb,
               CASE WHEN $9::boolean THEN now() + interval '24 hours' ELSE NULL END)
       RETURNING id`,
      [id, task.cycle_no, actor.id, JSON.stringify(payload), JSON.stringify(checked.value.sources),
        checked.value.modelName, checked.value.client || checked.value.modelName,
        checked.value.providerCost ? JSON.stringify(checked.value.providerCost) : null,
        task.auto_publish_allowed && Number(submitted.rows[0]?.count || 0) === 0],
    )
    solutionId = inserted.rows[0].id
    await client.query(
      `UPDATE content_tasks
          SET status = CASE WHEN $2::int > 0 THEN 'under_review' ELSE 'submitted' END,
              claimed_by = NULL, claim_actor_label = NULL, claim_expires_at = NULL, updated_at = now()
        WHERE id = $1`,
      [id, Number(submitted.rows[0]?.count || 0)],
    )
    await client.query(
      `INSERT INTO content_task_events (task_id, actor_id, event_type, details)
       VALUES ($1, $2, 'solution_submitted', jsonb_build_object('solution_id', $3::text))`,
      [id, actor.id, solutionId],
    )
    await notifyTaskSolution(client, { topicId: task.topic_id, solutionId, authorId: actor.id })
    await client.query('COMMIT')
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
  setResponseStatus(event, 201)
  return { solutionId, task: await loadContentTask(getDatabase(), id) }
})
