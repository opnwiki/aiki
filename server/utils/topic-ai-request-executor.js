import { executionErrorCode, parseNeronTaskCost } from './article-orders.js'
import { loadAgentProvider } from './agent-provider.js'
import { parseTopicAiResult, topicAiRepairSchema } from './topic-ai.js'
import { classifyTopicPage, publishTopicAiDiscussionReply, publishTopicAiOverview, publishTopicAiRevision } from './topic-ai-publisher.js'
import { notifySearchDiscovery } from './search-discovery.js'
import { enqueueFederationReply } from './federation-outbound.js'

const POLL_INTERVAL_MS = 5000
const MAX_BATCH = 3
const MAX_ATTEMPTS = 5
const MAX_RUN_AGE_MS = 2 * 60 * 60 * 1000

export function startTopicAiRequestExecutor(database, config) {
  if (!config.databaseUrl) return () => {}
  const tick = async () => {
    try {
      await releaseExpiredLeases(database)
      await processDueRequests(database, config)
      await expireOldRequests(database)
    } catch { /* retry from the durable queue */ }
  }
  void tick()
  const timer = setInterval(() => { void tick() }, POLL_INTERVAL_MS)
  timer.unref?.()
  return () => clearInterval(timer)
}

async function releaseExpiredLeases(database) {
  await database.query(
    `UPDATE topic_ai_requests
        SET executor_lease_until = NULL, updated_at = now()
      WHERE status IN ('queued', 'submitted')
        AND executor_lease_until <= now()
        AND (executor_next_poll_at IS NULL OR executor_next_poll_at <= now())`,
  )
}

async function processDueRequests(database, config) {
  const client = await database.connect()
  let requests
  try {
    await client.query('BEGIN')
    const found = await client.query(
      `SELECT id, topic_id, requester_id, request_type, locale, base_revision_id, prompt, status, provider_task_id,
              provider_result, provider_response, executor_attempts, created_at
         FROM topic_ai_requests
        WHERE status IN ('queued', 'submitted')
          AND coalesce(executor_next_poll_at, now()) <= now()
          AND (executor_lease_until IS NULL OR executor_lease_until <= now())
        ORDER BY created_at
        FOR UPDATE SKIP LOCKED
        LIMIT $1`,
      [MAX_BATCH],
    )
    requests = found.rows
    for (const request of requests) {
      await client.query(
        `UPDATE topic_ai_requests
            SET executor_lease_until = now() + interval '5 minutes', updated_at = now()
          WHERE id = $1`,
        [request.id],
      )
    }
    await client.query('COMMIT')
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }

  for (const request of requests) {
    if (request.status === 'queued') await startRequest(database, config, request)
    else await pollRequest(database, config, request)
  }
}

async function startRequest(database, config, request) {
  try {
    const provider = await loadAgentProvider(database, config)
    if (!provider) {
      await failRequest(database, request, 'executor_configuration', 'AI provider is not configured.')
      return
    }
    const task = await provider.start({
      prompt: request.prompt,
      requestId: `aiki-topic-ai-${request.id}`,
      requestType: request.request_type,
    })
    await database.query(
      `UPDATE topic_ai_requests
          SET status = 'submitted', provider_task_id = $2, executor_attempts = executor_attempts + 1,
              provider_cost = COALESCE($3::jsonb, provider_cost),
              provider_result = COALESCE($4::jsonb, provider_result),
              provider_response = COALESCE($5::jsonb, provider_response), progress_percent = 5,
              progress_stage = 'researching', progress_message = NULL,
              executor_lease_until = NULL, executor_next_poll_at = now() + interval '5 seconds',
              updated_at = now()
        WHERE id = $1 AND status = 'queued'`,
      [request.id, task.id, task.providerCost === null ? null : JSON.stringify(task.providerCost),
        task.result === undefined || task.result === null ? null : JSON.stringify(task.result),
        task.providerResponse === undefined || task.providerResponse === null ? null : JSON.stringify(task.providerResponse)],
    )
  } catch (error) {
    const attempts = Number(request.executor_attempts || 0) + 1
    if (Number(error?.status) === 429 && attempts < MAX_ATTEMPTS) {
      await database.query(
        `UPDATE topic_ai_requests
            SET executor_attempts = $2, executor_lease_until = NULL,
                executor_next_poll_at = now() + ($3 * interval '1 second'), error_code = $4,
                provider_response = COALESCE($5::jsonb, provider_response),
                updated_at = now()
          WHERE id = $1 AND status = 'queued'`,
        [request.id, attempts, Math.min(120, 10 * (2 ** attempts)), executionErrorCode(error),
          error.providerResponse ? JSON.stringify(error.providerResponse) : null],
      )
      return
    }
    await failRequest(database, request, executionErrorCode(error), errorMessage(error), null, error.providerResponse)
  }
}

async function pollRequest(database, config, request) {
  let lastProviderResponse = request.provider_response || null
  try {
    let task
    let provider = null
    if (request.provider_result !== null && request.provider_result !== undefined) {
      task = { id: request.provider_task_id, status: 'completed', result: request.provider_result, providerResponse: request.provider_response || null, providerCost: null }
    } else {
      provider = await loadAgentProvider(database, config)
      if (!provider) {
        await failRequest(database, request, 'executor_configuration', 'AI provider is not configured.')
        return
      }
      task = await provider.get({ taskId: request.provider_task_id })
    }
    lastProviderResponse = task.providerResponse || lastProviderResponse

    if (['queued', 'running', 'resuming'].includes(task.status)) {
      const progress = presentProgress(task)
      const providerCost = parseNeronTaskCost(task)
      await database.query(
        `UPDATE topic_ai_requests
            SET executor_lease_until = NULL, progress_percent = $2, progress_stage = $3,
                progress_message = $4, provider_cost = COALESCE($5::jsonb, provider_cost),
                provider_response = COALESCE($6::jsonb, provider_response),
                executor_next_poll_at = now() + interval '10 seconds', updated_at = now()
          WHERE id = $1 AND status = 'submitted'`,
        [request.id, progress.percent, progress.stage, progress.message,
          providerCost === null ? null : JSON.stringify(providerCost),
          lastProviderResponse === null ? null : JSON.stringify(lastProviderResponse)],
      )
      return
    }
    if (task.status !== 'completed') {
      await failRequest(database, request, task.status === 'budget_blocked' ? 'budget_unavailable' : 'executor_unavailable', errorMessage(task), parseNeronTaskCost(task), lastProviderResponse)
      return
    }

    const result = await parseTopicAiResultWithRepair(task.result, request, provider)
    const providerCost = parseNeronTaskCost(task)
    await completeRequest(database, config, request, result, providerCost, provider?.model || modelFromTask(task), lastProviderResponse)
  } catch (error) {
    const attempts = Number(request.executor_attempts || 0) + 1
    const age = Date.now() - new Date(request.created_at).getTime()
    if (isTransient(error) && attempts < MAX_ATTEMPTS && age < MAX_RUN_AGE_MS) {
      await database.query(
        `UPDATE topic_ai_requests
            SET executor_attempts = $2, executor_lease_until = NULL,
                executor_next_poll_at = now() + interval '30 seconds', error_code = $3,
                error_message = $4, provider_response = COALESCE($5::jsonb, provider_response), updated_at = now()
          WHERE id = $1 AND status = 'submitted'`,
        [request.id, attempts, executionErrorCode(error), errorMessage(error),
          lastProviderResponse || error.providerResponse || null],
      )
      return
    }
    await failRequest(database, request, executionErrorCode(error), errorMessage(error), null,
      lastProviderResponse || error.providerResponse || null)
  }
}

async function parseTopicAiResultWithRepair(value, request, provider) {
  try {
    return parseTopicAiResult(value, request.request_type)
  } catch (error) {
    const schema = topicAiRepairSchema(request.request_type)
    if (error?.status !== 422 || !schema || !provider?.repairJson) throw error
    let repaired
    try {
      repaired = await provider.repairJson({
        value: value?.reply ?? value?.output ?? value,
        schema,
        requestId: `aiki-topic-ai-repair-${request.id}`,
      })
    } catch {
      throw error
    }
    if (repaired === null || repaired === undefined) throw error
    return parseTopicAiResult(repaired, request.request_type)
  }
}

async function completeRequest(database, config, request, result, providerCost, model, providerResponse = null) {
  const client = await database.connect()
  try {
    await client.query('BEGIN')
    const locked = await client.query(
      `SELECT id, status
         FROM topic_ai_requests
        WHERE id = $1
        FOR UPDATE`,
      [request.id],
    )
    if (!locked.rows[0] || locked.rows[0].status !== 'submitted') {
      await client.query('COMMIT')
      return
    }

    let completedResult = result
    let publishedReplyId = null
    let publishedProposalId = null
    let updatedOverviewRevisionId = null
    if (request.request_type === 'classify_page') {
      const classified = await classifyTopicPage(client, { request, result, model })
      completedResult = { ...result, classification: classified }
    } else if (request.request_type === 'discussion_reply') {
      const published = await publishTopicAiDiscussionReply(client, { request, result, model })
      completedResult = { ...result, publishedReply: published }
      publishedReplyId = published.id
    } else if (request.request_type === 'research') {
      const published = await publishTopicAiRevision(client, { request, result, model })
      completedResult = { ...result, publishedRevision: published }
    } else if (request.request_type === 'overview') {
      const updated = await publishTopicAiOverview(client, { request, result, model })
      completedResult = { ...result, updatedOverview: updated }
      updatedOverviewRevisionId = updated.revisionId
    }

    await client.query(
      `UPDATE topic_ai_requests
          SET status = 'completed', result = $2::jsonb, published_reply_id = $3,
              published_proposal_id = $4, updated_overview_revision_id = $5,
              provider_cost = COALESCE($6::jsonb, provider_cost),
              provider_response = COALESCE($7::jsonb, provider_response),
              progress_percent = 100, progress_stage = 'complete', progress_message = NULL,
              error_code = NULL, error_message = NULL, finished_at = now(),
              executor_lease_until = NULL, executor_next_poll_at = NULL, updated_at = now()
        WHERE id = $1 AND status = 'submitted'`,
      [request.id, JSON.stringify(completedResult), publishedReplyId, publishedProposalId, updatedOverviewRevisionId,
        providerCost === null ? null : JSON.stringify(providerCost),
        providerResponse === null ? null : JSON.stringify(providerResponse)],
    )
    await client.query('COMMIT')
    if (publishedReplyId) {
      try {
        await enqueueFederationReply(database, { replyId: publishedReplyId })
      } catch (error) {
        console.error('[fedify] could not queue AI reply', error)
      }
    }
    const published = await database.query(
      `SELECT page_number FROM topics WHERE id = $1 AND status = 'published'`,
      [request.topic_id],
    )
    if (published.rows[0]?.page_number != null) {
      void notifySearchDiscovery({ siteUrl: config.public.siteUrl, paths: [`/${published.rows[0].page_number}`] })
    }
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
}

async function failRequest(database, request, errorCode, message, providerCost = null, providerResponse = null) {
  await database.query(
    `UPDATE topic_ai_requests
        SET status = 'failed', error_code = $2, error_message = $3,
            provider_cost = COALESCE($4::jsonb, provider_cost),
            provider_response = COALESCE($5::jsonb, provider_response), progress_percent = 100,
            progress_stage = 'failed', progress_message = $3, finished_at = now(),
            executor_lease_until = NULL, executor_next_poll_at = NULL, updated_at = now()
      WHERE id = $1 AND status IN ('queued', 'submitted')`,
    [request.id, errorCode, message || null, providerCost === null ? null : JSON.stringify(providerCost),
      providerResponse === null ? null : JSON.stringify(providerResponse)],
  )
  // The requester paid 1 WPG to start the run; a run that did not finish is refunded once.
  await database.query(
    `INSERT INTO actor_token_ledger (actor_id, amount, reason, source_type, source_id, idempotency_key, description)
     SELECT actor_id, 1, 'agent_run_refund', 'agent_run', source_id, 'topic-ai-refund:' || $1::text,
            'Refund: the AI request did not finish'
       FROM actor_token_ledger
      WHERE idempotency_key = 'topic-ai-charge:' || $1::text
     ON CONFLICT (idempotency_key) DO NOTHING`,
    [request.id],
  )
}

async function expireOldRequests(database) {
  const result = await database.query(
    `SELECT id, requester_id FROM topic_ai_requests
      WHERE status IN ('queued', 'submitted') AND created_at < now() - interval '2 hours'
        AND executor_lease_until IS NULL LIMIT 10`,
  )
  for (const request of result.rows) await failRequest(database, request, 'executor_timeout', 'The AI request took too long.')
}

function presentProgress(task = {}) {
  const nested = task.progress && typeof task.progress === 'object' ? task.progress : {}
  const raw = task.progress_percent ?? task.progressPercent ?? task.percent ?? task.completion ?? nested.percent ?? nested.progress
  const parsed = Number(raw)
  const fallback = task.status === 'queued' ? 5 : task.status === 'resuming' ? 60 : task.status === 'running' ? 50 : 0
  const percent = Number.isFinite(parsed) ? Math.min(99, Math.max(0, Math.round(parsed))) : fallback
  const stage = progressText([task.stage, task.phase, nested.stage, nested.phase], task.status === 'queued' ? 'queued' : 'writing', 80)
  const message = String(task.message || nested.message || '').replace(/\0/g, '').trim().slice(0, 240) || null
  return { percent, stage, message }
}

function progressText(values, fallback, max) {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.replace(/\0/g, '').trim().slice(0, max)
    if (!value || typeof value !== 'object' || Array.isArray(value)) continue
    for (const key of ['name', 'label', 'stage', 'phase', 'status']) {
      if (typeof value[key] === 'string' && value[key].trim()) return value[key].replace(/\0/g, '').trim().slice(0, max)
    }
  }
  return fallback
}

function errorMessage(value = {}) {
  const nested = value.error && typeof value.error === 'object' ? value.error : {}
  return String(value.error_message || nested.message || value.message || '').replace(/\0/g, '').trim().slice(0, 240) || null
}

function isTransient(error) {
  return ![400, 401, 402, 403, 404, 422].includes(Number(error?.status))
}

function modelFromTask(task = {}) {
  const result = task.result && typeof task.result === 'object' ? task.result : {}
  return task.model_name || task.modelName || task.model || result.model_name || result.modelName || result.model || null
}
