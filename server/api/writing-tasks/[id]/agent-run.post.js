import { createError, getRouterParams, readBody, setResponseStatus } from 'h3'
import { getHumanActor, enforceSameOrigin } from '../../../utils/auth.js'
import { getDatabase } from '../../../utils/database.js'
import { enforceRateLimit } from '../../../utils/rate-limit.js'
import { loadAgentProvider } from '../../../utils/agent-provider.js'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const IDEMPOTENCY = /^[a-f0-9]{64}$/i

export default defineEventHandler(async (event) => {
  enforceSameOrigin(event)
  const actor = await getHumanActor(event)
  if (!actor) throw createError({ statusCode: 401, statusMessage: 'Sign in to launch Neron Agent.' })
  await enforceRateLimit(event, { action: 'writing-task-agent-run', limit: 5 })

  const { id } = getRouterParams(event)
  if (!UUID.test(id || '')) throw createError({ statusCode: 404, statusMessage: 'Writing task not found.' })
  const body = await readBody(event)
  if (!body || typeof body !== 'object' || Array.isArray(body)
      || Object.keys(body).some(key => !['idempotencyKey', 'consent'].includes(key))
      || body.consent !== true
      || typeof body.idempotencyKey !== 'string' || !IDEMPOTENCY.test(body.idempotencyKey)) {
    throw createError({ statusCode: 400, statusMessage: 'Refresh and try starting the agent again.' })
  }

  if (!await loadAgentProvider(getDatabase(), useRuntimeConfig())) {
    throw createError({ statusCode: 503, statusMessage: 'Neron Agent is not available right now; no WPG was charged.' })
  }

  const client = await getDatabase().connect()
  let run
  let replay = false
  try {
    await client.query('BEGIN')
    const existing = await client.query(
      `SELECT id, task_id, actor_id, status, created_at, updated_at, finished_at, error_code,
              provider_cost, progress_percent, progress_stage, progress_message
         FROM writing_task_agent_runs WHERE idempotency_key = $1 FOR UPDATE`,
      [body.idempotencyKey],
    )
    if (existing.rows[0]) {
      const previous = existing.rows[0]
      if (previous.task_id !== id || previous.actor_id !== actor.id) {
        throw createError({ statusCode: 409, statusMessage: 'This request key has already been used.' })
      }
      run = previous
      replay = true
    } else {
      const actorLock = await client.query('SELECT id FROM actors WHERE id = $1 AND account_status = \'active\' FOR UPDATE', [actor.id])
      if (!actorLock.rowCount) throw createError({ statusCode: 401, statusMessage: 'Sign in to launch Neron Agent.' })
      const taskResult = await client.query(
        `SELECT id, task_type, status, claimed_by, claim_expires_at, automation_lease_until
           FROM article_writing_tasks WHERE id = $1 FOR UPDATE`,
        [id],
      )
      const task = taskResult.rows[0]
      if (task?.task_type === 'overview') {
        throw createError({ statusCode: 409, statusMessage: 'Overview tasks are reviewed through community proposals, not automatic publication.' })
      }
      if (!task || task.status !== 'claimed' || task.claimed_by !== actor.id
          || !task.claim_expires_at || new Date(task.claim_expires_at) <= new Date()
          || task.automation_lease_until) {
        throw createError({ statusCode: 409, statusMessage: 'Claim this task before launching Neron Agent.' })
      }
      const balanceResult = await client.query(
        'SELECT coalesce(sum(amount), 0)::text AS balance FROM actor_token_ledger WHERE actor_id = $1',
        [actor.id],
      )
      const balance = BigInt(balanceResult.rows[0]?.balance || '0')
      if (balance < 1n) throw createError({ statusCode: 402, statusMessage: 'At least 1 WPG is required to run Neron Agent.' })

      const inserted = await client.query(
        `INSERT INTO writing_task_agent_runs (task_id, actor_id, idempotency_key)
         VALUES ($1, $2, $3)
         RETURNING id, task_id, actor_id, status, created_at, updated_at, finished_at, error_code,
                   provider_cost, progress_percent, progress_stage, progress_message`,
        [id, actor.id, body.idempotencyKey],
      )
      run = inserted.rows[0]
      await client.query(
        `INSERT INTO actor_token_ledger
          (actor_id, amount, reason, source_type, source_id, idempotency_key, description)
         VALUES ($1, -1, 'agent_run_charge', 'agent_run', $2, $3, $4)`,
        [actor.id, run.id, `agent-run-charge:${run.id}`, '1 WPG for explicitly authorized Neron Agent research and immediate public publication'],
      )
      await client.query(
        `UPDATE article_writing_tasks
            SET automation_lease_until = now() + interval '3 hours', updated_at = now()
          WHERE id = $1`,
        [id],
      )
      await client.query(
        `INSERT INTO actor_audit_log (actor_id, action, target_type, target_id, details)
         VALUES ($1, 'writing_task_agent_run_started', 'writing_task_agent_run', $2,
                 jsonb_build_object('task_id', $3::text, 'charge_wpg', 1, 'auto_publish', true, 'user_consent', true))`,
        [actor.id, run.id, id],
      )
    }
    await client.query('COMMIT')
  } catch (error) {
    await client.query('ROLLBACK')
    if (error?.code === '23505') throw createError({ statusCode: 409, statusMessage: 'Another Neron run is already in progress for this task.' })
    throw error
  } finally {
    client.release()
  }

  setResponseStatus(event, replay ? 200 : 202)
  return { run: { id: run.id, task_id: run.task_id, status: run.status, created_at: run.created_at,
    updated_at: run.updated_at, finished_at: run.finished_at, refunded: run.status === 'failed',
    progressPercent: Number(run.progress_percent || 0), progressStage: run.progress_stage || null,
    progressMessage: run.progress_message || null, providerCost: run.provider_cost || null, replay } }
})
