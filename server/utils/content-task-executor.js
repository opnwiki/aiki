import { acceptContentTaskSolution } from './content-tasks.js'
import { enqueueFederationReply } from './federation-outbound.js'

const POLL_INTERVAL_MS = 15_000

export function startContentTaskExecutor(database, config) {
  if (!config.databaseUrl) return () => {}
  let tickRunning = false
  const tick = async () => {
    if (tickRunning) return
    tickRunning = true
    try {
      const due = await database.query(
        `SELECT solution.id
           FROM content_task_solutions solution
           JOIN content_tasks task ON task.id = solution.task_id
          WHERE solution.status = 'submitted'
            AND solution.auto_accept_at <= now()
            AND task.auto_publish_allowed = true
            AND task.status IN ('submitted', 'under_review')
          ORDER BY solution.auto_accept_at
          LIMIT 10`,
      )
      if (!due.rows.length) return
      const system = await database.query(`SELECT id FROM actors WHERE kind = 'system' ORDER BY created_at LIMIT 1`)
      const reviewerId = system.rows[0]?.id || null
      for (const row of due.rows) {
        const client = await database.connect()
        try {
          await client.query('BEGIN')
          const result = await acceptContentTaskSolution(client, { solutionId: row.id, reviewerId, automatic: true })
          await client.query('COMMIT')
          if (result.replyId) {
            try {
              await enqueueFederationReply(database, { replyId: result.replyId })
            } catch (error) {
              console.error('[fedify] could not queue automatically accepted task reply', error)
            }
          }
        } catch (error) {
          await client.query('ROLLBACK')
          try {
            await quarantineFailedContentTaskSolution(database, row.id, automaticAcceptanceFailureComment(error))
          } catch (quarantineError) {
            console.error('[content-tasks] failed to quarantine automatic acceptance', quarantineError?.message || quarantineError)
          }
          console.error('[content-tasks] automatic acceptance failed', error?.message || error)
        } finally {
          client.release()
        }
      }
    } finally {
      tickRunning = false
    }
  }
  void tick().catch(() => {})
  const timer = setInterval(() => { void tick().catch(() => {}) }, POLL_INTERVAL_MS)
  timer.unref?.()
  return () => clearInterval(timer)
}

export function automaticAcceptanceFailureComment(error) {
  const message = String(error?.message || error || 'Unknown automatic acceptance error')
    .replace(/\s+/g, ' ').trim().slice(0, 1000)
  return `Automatic acceptance paused: ${message}`
}

async function quarantineFailedContentTaskSolution(database, solutionId, reviewComment) {
  const client = await database.connect()
  try {
    await client.query('BEGIN')
    const solution = await client.query(
      `UPDATE content_task_solutions
          SET auto_accept_at = NULL, review_comment = $2
        WHERE id = $1 AND status = 'submitted'
        RETURNING task_id`,
      [solutionId, reviewComment],
    )
    if (!solution.rows[0]) {
      await client.query('COMMIT')
      return
    }
    const taskId = solution.rows[0].task_id
    await client.query(
      `UPDATE content_tasks
          SET status = 'under_review', auto_publish_allowed = false, updated_at = now()
        WHERE id = $1 AND status IN ('submitted', 'under_review')`,
      [taskId],
    )
    await client.query(
      `INSERT INTO content_task_events (task_id, event_type, details)
       VALUES ($1, 'automatic_acceptance_failed', jsonb_build_object('solution_id', $2::text, 'comment', $3::text))`,
      [taskId, solutionId, reviewComment],
    )
    await client.query('COMMIT')
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
}
