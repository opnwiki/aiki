import { buildArticlePrompt, executionErrorCode, isTransientNeronError, parseNeronDraft, parseNeronTaskCost } from './article-orders.js'
import { loadAgentProvider } from './agent-provider.js'

const POLL_INTERVAL_MS = 5_000
const MAX_BATCH = 4
const MAX_ATTEMPTS = 3
let tickRunning = false

export function startArticleOrderExecutor(database, config) {
  if (!config.databaseUrl) return () => {}
  const tick = async () => {
    if (tickRunning) return
    tickRunning = true
    try { await processDueOrders(database, config) } catch { /* keep the durable queue available for the next tick */ }
    finally { tickRunning = false }
  }
  void tick()
  const timer = setInterval(() => { void tick() }, POLL_INTERVAL_MS)
  timer.unref?.()
  return () => clearInterval(timer)
}

async function processDueOrders(database, config) {
  const client = await database.connect()
  let jobs
  try {
    await client.query('BEGIN')
    const selected = await client.query(
      `SELECT orders.id, assessment.query_text, assessment.locale, assessment.search_context,
              orders.execution_state, orders.neron_task_id, orders.executor_attempts,
              orders.provider_result, orders.provider_response
         FROM article_order_submissions orders
         JOIN article_order_assessments assessment ON assessment.id = orders.assessment_id
        WHERE orders.execution_state IN ('pending', 'submitted')
          AND coalesce(orders.executor_next_poll_at, now()) <= now()
          AND (orders.executor_lease_until IS NULL OR orders.executor_lease_until < now())
        ORDER BY orders.created_at
        FOR UPDATE OF orders SKIP LOCKED
        LIMIT $1`,
      [MAX_BATCH],
    )
    jobs = selected.rows
    for (const job of jobs) {
      await client.query(
        `UPDATE article_order_submissions
            SET executor_lease_until = now() + interval '90 seconds', updated_at = now()
          WHERE id = $1`,
        [job.id],
      )
    }
    await client.query('COMMIT')
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
  for (const job of jobs) {
    if (job.execution_state === 'pending') await startOrder(database, config, job)
    else await pollOrder(database, config, job)
  }
}

async function startOrder(database, config, job) {
  const attempt = Number(job.executor_attempts || 0) + 1
  try {
    const provider = await loadAgentProvider(database, config)
    if (!provider) {
      await fallbackToCommunity(database, job.id, 'executor_configuration')
      return
    }
    const task = await provider.start({
      prompt: buildArticlePrompt({ query: job.query_text, locale: job.locale, context: job.search_context || [] }),
      requestId: `aiki-article-${job.id}`,
      requestType: 'article',
    })
    await database.query(
      `UPDATE article_order_submissions
          SET status = $2, execution_state = 'submitted', neron_task_id = $3,
              provider_cost = COALESCE($5::jsonb, provider_cost),
              provider_result = COALESCE($6::jsonb, provider_result),
              provider_response = COALESCE($7::jsonb, provider_response),
              executor_attempts = $4, executor_error_code = NULL,
              executor_lease_until = NULL, executor_next_poll_at = now() + interval '5 seconds',
              updated_at = now()
        WHERE id = $1 AND execution_state = 'pending'`,
      [job.id, task.status === 'running' || task.status === 'resuming' ? 'running' : 'queued', task.id, attempt,
        task.providerCost === null ? null : JSON.stringify(task.providerCost),
        task.result === undefined || task.result === null ? null : JSON.stringify(task.result),
        task.providerResponse === undefined || task.providerResponse === null ? null : JSON.stringify(task.providerResponse)],
    )
  } catch (error) {
    await handleExecutorFailure(database, job, error, attempt, error.providerResponse || null)
  }
}

async function pollOrder(database, config, job) {
  let lastProviderResponse = job.provider_response || null
  try {
    let task
    if (job.provider_result !== null && job.provider_result !== undefined) {
      task = { id: job.neron_task_id, status: 'completed', result: job.provider_result, providerResponse: job.provider_response || null, providerCost: null }
    } else {
      const provider = await loadAgentProvider(database, config)
      if (!provider) {
        await fallbackToCommunity(database, job.id, 'executor_configuration')
        return
      }
      task = await provider.get({ taskId: job.neron_task_id })
    }
    lastProviderResponse = task.providerResponse || lastProviderResponse
    if (lastProviderResponse !== null) {
      await database.query(
        `UPDATE article_order_submissions
            SET provider_response = COALESCE($2::jsonb, provider_response), updated_at = now()
          WHERE id = $1 AND execution_state = 'submitted'`,
        [job.id, JSON.stringify(lastProviderResponse)],
      )
    }
    const providerCost = parseNeronTaskCost(task)
    if (task.status === 'queued' || task.status === 'running' || task.status === 'resuming') {
      await database.query(
        `UPDATE article_order_submissions SET status = $2, executor_lease_until = NULL,
                provider_cost = COALESCE($3::jsonb, provider_cost),
                executor_next_poll_at = now() + interval '10 seconds', updated_at = now()
          WHERE id = $1 AND execution_state = 'submitted'`,
        [job.id, task.status === 'queued' ? 'queued' : 'running', providerCost === null ? null : JSON.stringify(providerCost)],
      )
      return
    }
    if (task.status === 'completed') {
      const draft = parseNeronDraft(task.result)
      await saveGeneratedDraft(database, job.id, draft, providerCost)
      return
    }
    const error = new Error('Neron task did not complete')
    error.status = task.status === 'budget_blocked' ? 402 : 500
    error.providerCode = task.status === 'budget_blocked' ? 'KEY_LIMIT' : null
    const errorCode = executionErrorCode(error)
    await database.query(
      `UPDATE article_order_submissions
          SET executor_error_code = $2, provider_cost = COALESCE($3::jsonb, provider_cost), updated_at = now()
        WHERE id = $1 AND execution_state = 'submitted'`,
      [job.id, errorCode, providerCost === null ? null : JSON.stringify(providerCost)],
    )
    await fallbackToCommunity(database, job.id, errorCode, providerCost, lastProviderResponse)
  } catch (error) {
    await handleExecutorFailure(database, job, error, Number(job.executor_attempts || 0) + 1,
      lastProviderResponse || error.providerResponse || null)
  }
}

async function handleExecutorFailure(database, job, error, attempts, providerResponse = null) {
  const code = executionErrorCode(error)
  if (isTransientNeronError(error) && attempts < MAX_ATTEMPTS) {
    const waitSeconds = Math.min(60, 5 * (2 ** attempts))
    await database.query(
      `UPDATE article_order_submissions
          SET executor_attempts = $2, executor_error_code = $3,
              executor_lease_until = NULL, executor_next_poll_at = now() + ($4 * interval '1 second'),
              provider_response = COALESCE($5::jsonb, provider_response), updated_at = now()
          WHERE id = $1 AND execution_state IN ('pending', 'submitted')`,
      [job.id, attempts, code, waitSeconds, providerResponse === null ? null : JSON.stringify(providerResponse)],
    )
    return
  }
  await fallbackToCommunity(database, job.id, code, null, providerResponse)
}

async function fallbackToCommunity(database, orderId, errorCode, providerCost = null, providerResponse = null) {
  const client = await database.connect()
  try {
    await client.query('BEGIN')
    const order = await client.query(
      `SELECT id FROM article_order_submissions WHERE id = $1 AND execution_state IN ('pending', 'submitted') FOR UPDATE`,
      [orderId],
    )
    if (!order.rows[0]) {
      await client.query('ROLLBACK')
      return
    }
    await client.query(
      `INSERT INTO article_writing_tasks (order_id, status)
       VALUES ($1, 'open')
       ON CONFLICT (order_id) DO UPDATE
         SET status = CASE WHEN article_writing_tasks.status = 'closed' THEN 'open' ELSE article_writing_tasks.status END,
             updated_at = now()`,
      [orderId],
    )
    await client.query(
      `UPDATE article_order_submissions
          SET status = 'queued', execution_state = 'community', error_code = 'executor_failed',
              executor_error_code = $2, executor_lease_until = NULL, executor_next_poll_at = NULL,
              provider_cost = COALESCE($3::jsonb, provider_cost),
              provider_response = COALESCE($4::jsonb, provider_response), updated_at = now()
        WHERE id = $1`,
      [orderId, errorCode, providerCost === null ? null : JSON.stringify(providerCost),
        providerResponse === null ? null : JSON.stringify(providerResponse)],
    )
    await client.query('COMMIT')
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
}

async function saveGeneratedDraft(database, orderId, draft, providerCost = null) {
  const client = await database.connect()
  try {
    await client.query('BEGIN')
    const order = await client.query(
      `SELECT orders.id, assessment.locale, writing_task.id AS task_id FROM article_order_submissions orders
         JOIN article_order_assessments assessment ON assessment.id = orders.assessment_id
         JOIN article_writing_tasks writing_task ON writing_task.order_id = orders.id
        WHERE orders.id = $1 AND orders.execution_state = 'submitted'
          AND writing_task.status = 'closed'
        FOR UPDATE OF orders, writing_task`,
      [orderId],
    )
    if (!order.rows[0]) {
      await client.query('ROLLBACK')
      return
    }
    const taskId = order.rows[0].task_id
    const version = await client.query('SELECT coalesce(max(revision_no), 0)::int + 1 AS revision_no FROM article_writing_submissions WHERE task_id = $1', [taskId])
    const insertedSubmission = await client.query(
      `INSERT INTO article_writing_submissions
         (task_id, revision_no, submitted_by, kind, title, body_markdown, sources,
          authorship_mode, model_name, human_contribution)
       VALUES ($1, $2, NULL, $3, $4, $5, $6::jsonb, $7, $8, $9)
       RETURNING id`,
      [taskId, version.rows[0].revision_no, draft.kind, draft.title, draft.body,
        JSON.stringify(draft.sources), draft.authorshipMode, draft.modelName, draft.humanContribution],
    )
    await client.query(
      `UPDATE article_writing_tasks
          SET status = 'submitted', current_submission_id = $2, updated_at = now()
        WHERE id = $1 AND status = 'closed'`,
      [taskId, insertedSubmission.rows[0].id],
    )
    await client.query(
      `UPDATE article_order_submissions
          SET status = 'draft_ready', execution_state = 'draft_ready', error_code = NULL,
              executor_error_code = NULL, executor_lease_until = NULL, executor_next_poll_at = NULL,
              provider_cost = COALESCE($2::jsonb, provider_cost), finished_at = now(), updated_at = now()
        WHERE id = $1`,
      [orderId, providerCost === null ? null : JSON.stringify(providerCost)],
    )
    await client.query('COMMIT')
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
}
