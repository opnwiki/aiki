import { executionErrorCode, parseNeronDraft, parseNeronTaskCost } from './article-orders.js'
import { loadAgentProvider } from './agent-provider.js'
import { allocateTopicSlug } from './page-address.js'
import { createTaskRunPrompt, parseTaskAgentSubmission } from './writing-task-agent.js'
import { recordRevisionDiff } from './revision-history.js'
import { fitArticleToRules, loadArticleRuleOverrides } from './article-rules.js'
import { checkPageContent, openingTopicStatus } from './moderation.js'
import { resolveSourcePublishedAt } from './source-publish-date.js'

const POLL_INTERVAL_MS = 5000
const MAX_BATCH = 3
const MAX_ATTEMPTS = 5
const MAX_RUN_AGE_MS = 2 * 60 * 60 * 1000

export function startWritingTaskAgentExecutor(database, config) {
  if (!config.databaseUrl) return () => {}
  const tick = async () => {
    try {
      await releaseExpiredAgentRunLeases(database)
      await processDueAgentRuns(database, config)
      await expireOldAgentRuns(database)
    } catch { /* retry from durable DB queue */ }
  }
  void tick()
  const timer = setInterval(() => { void tick() }, POLL_INTERVAL_MS)
  timer.unref?.()
  return () => clearInterval(timer)
}

async function releaseExpiredAgentRunLeases(database) {
  await database.query(
    `UPDATE writing_task_agent_runs
        SET executor_lease_until = NULL, updated_at = now()
      WHERE status IN ('queued', 'submitted')
        AND executor_lease_until <= now()
        AND (executor_next_poll_at IS NULL OR executor_next_poll_at <= now())`,
  )
  await database.query(
    `UPDATE article_writing_tasks task
        SET automation_lease_until = NULL, updated_at = now()
      WHERE task.status = 'claimed'
        AND task.automation_lease_until <= now()
        AND NOT EXISTS (
          SELECT 1 FROM writing_task_agent_runs run
           WHERE run.task_id = task.id AND run.status IN ('queued', 'submitted')
        )`,
  )
}

async function processDueAgentRuns(database, config) {
  const client = await database.connect()
  let runs
  try {
    await client.query('BEGIN')
    const found = await client.query(
      `SELECT run.id, run.task_id, run.actor_id, run.status, run.neron_task_id, run.provider_result,
              run.provider_response,
              run.executor_attempts, run.created_at, assessment.query_text,
              assessment.locale, assessment.search_context
         FROM writing_task_agent_runs run
         JOIN article_writing_tasks task ON task.id = run.task_id
         JOIN article_order_submissions orders ON orders.id = task.order_id
         JOIN article_order_assessments assessment ON assessment.id = orders.assessment_id
        WHERE run.status IN ('queued', 'submitted')
          AND coalesce(run.executor_next_poll_at, now()) <= now()
          AND (run.executor_lease_until IS NULL OR run.executor_lease_until <= now())
        ORDER BY run.created_at
        FOR UPDATE OF run SKIP LOCKED
        LIMIT $1`,
      [MAX_BATCH],
    )
    runs = found.rows
    for (const run of runs) {
      await client.query('UPDATE writing_task_agent_runs SET executor_lease_until = now() + interval \'5 minutes\', updated_at = now() WHERE id = $1', [run.id])
    }
    await client.query('COMMIT')
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
  for (const run of runs) {
    if (run.status === 'queued') await startRun(database, config, run)
    else await pollRun(database, config, run)
  }
}

async function startRun(database, config, run) {
  try {
    const provider = await loadAgentProvider(database, config)
    if (!provider) {
      await failRun(database, run, 'executor_configuration')
      return
    }
    const task = await provider.start({
      prompt: createTaskRunPrompt({ query: run.query_text, locale: run.locale, context: run.search_context || [] }),
      requestId: `aiki-task-${run.id}`,
      requestType: 'agent_task',
    })
    await database.query(
      `UPDATE writing_task_agent_runs
          SET status = 'submitted', neron_task_id = $2, executor_attempts = executor_attempts + 1,
              provider_cost = COALESCE($3::jsonb, provider_cost),
              provider_result = COALESCE($4::jsonb, provider_result),
              provider_response = COALESCE($5::jsonb, provider_response),
              progress_percent = 5, progress_stage = 'researching', progress_message = NULL,
              executor_lease_until = NULL, executor_next_poll_at = now() + interval '5 seconds',
              updated_at = now()
        WHERE id = $1 AND status = 'queued'`,
      [run.id, task.id, task.providerCost === null ? null : JSON.stringify(task.providerCost),
        task.result === undefined || task.result === null ? null : JSON.stringify(task.result),
        task.providerResponse === undefined || task.providerResponse === null ? null : JSON.stringify(task.providerResponse)],
    )
  } catch (error) {
    const attempts = Number(run.executor_attempts || 0) + 1
    if (Number(error?.status) === 429 && attempts < MAX_ATTEMPTS) {
      await database.query(
        `UPDATE writing_task_agent_runs SET executor_attempts = $2,
                executor_lease_until = NULL, executor_next_poll_at = now() + ($3 * interval '1 second'),
                error_code = $4, provider_response = COALESCE($5::jsonb, provider_response),
                updated_at = now() WHERE id = $1 AND status = 'queued'`,
        [run.id, attempts, Math.min(120, 10 * (2 ** attempts)), executionErrorCode(error),
          error.providerResponse ? JSON.stringify(error.providerResponse) : null],
      )
      return
    }
    // Any timeout/network error may have been accepted and billed upstream. Never retry
    // POST /tasks without a confirmed id: preserve charge and keep querying the same key.
    if (![400, 401, 402, 403, 404, 409, 422].includes(Number(error?.status))) {
      await database.query(
        `UPDATE writing_task_agent_runs SET executor_attempts = $2,
                executor_lease_until = NULL, executor_next_poll_at = now() + interval '30 seconds',
                error_code = $3, provider_response = COALESCE($4::jsonb, provider_response),
                updated_at = now() WHERE id = $1 AND status = 'queued'`,
        [run.id, attempts, executionErrorCode(error), error.providerResponse ? JSON.stringify(error.providerResponse) : null],
      )
      return
    }
    await failRun(database, run, executionErrorCode(error), null, null, error.providerResponse || null)
  }
}

async function pollRun(database, config, run) {
  let lastProviderResponse = run.provider_response || null
  try {
    let task
    if (run.provider_result !== null && run.provider_result !== undefined) {
      task = { id: run.neron_task_id, status: 'completed', result: run.provider_result, providerResponse: run.provider_response || null, providerCost: null }
    } else {
      const provider = await loadAgentProvider(database, config)
      if (!provider) {
        await failRun(database, run, 'executor_configuration')
        return
      }
      task = await provider.get({ taskId: run.neron_task_id })
    }
    lastProviderResponse = task.providerResponse || lastProviderResponse
    if (lastProviderResponse !== null) {
      await database.query(
        `UPDATE writing_task_agent_runs
            SET provider_response = COALESCE($2::jsonb, provider_response), updated_at = now()
          WHERE id = $1 AND status = 'submitted'`,
        [run.id, JSON.stringify(lastProviderResponse)],
      )
    }
    if (['queued', 'running', 'resuming'].includes(task.status)) {
      const progress = presentProviderProgress(task)
      const providerCost = parseNeronTaskCost(task)
      await database.query(
        `UPDATE writing_task_agent_runs SET executor_lease_until = NULL,
                progress_percent = $2, progress_stage = $3, progress_message = $4,
                provider_cost = COALESCE($5::jsonb, provider_cost),
                provider_response = COALESCE($6::jsonb, provider_response),
                executor_next_poll_at = now() + interval '10 seconds', updated_at = now()
          WHERE id = $1 AND status = 'submitted'`,
        [run.id, progress.percent, progress.stage, progress.message, providerCost === null ? null : JSON.stringify(providerCost),
          lastProviderResponse === null ? null : JSON.stringify(lastProviderResponse)],
      )
      return
    }
    if (task.status !== 'completed') {
      await failRun(database, run, task.status === 'budget_blocked' ? 'budget_unavailable' : 'executor_unavailable', providerErrorMessage(task), parseNeronTaskCost(task), lastProviderResponse)
      return
    }
    const draft = parseTaskAgentSubmission(parseNeronDraft(task.result), run.locale)
    await publishRunResult(database, run, draft, parseNeronTaskCost(task))
  } catch (error) {
    const attempts = Number(run.executor_attempts || 0) + 1
    const age = Date.now() - new Date(run.created_at).getTime()
    if (isTransient(error) && attempts < MAX_ATTEMPTS && age < MAX_RUN_AGE_MS) {
      await database.query(
        `UPDATE writing_task_agent_runs
            SET executor_attempts = $2, executor_lease_until = NULL,
                executor_next_poll_at = now() + interval '30 seconds',
                error_code = $3, provider_response = COALESCE($4::jsonb, provider_response), updated_at = now()
          WHERE id = $1 AND status = 'submitted'`,
        [run.id, attempts, executionErrorCode(error), lastProviderResponse || error.providerResponse || null],
      )
      return
    }
    await failRun(database, run, executionErrorCode(error), null, null, lastProviderResponse || error.providerResponse || null)
  }
}

async function publishRunResult(database, run, draft, providerCost = null) {
  const sources = await Promise.all((draft.sources || []).map(async (source) => ({
    ...source,
    publishedAt: await resolveSourcePublishedAt(source),
  })))
  const client = await database.connect()
  try {
    await client.query('BEGIN')
    const locked = await client.query(
      `SELECT agent_run.id, task.status AS task_status, task.claimed_by,
              task.automation_lease_until, task.current_submission_id, task.order_id,
              actor.node_id
         FROM writing_task_agent_runs agent_run
         JOIN article_writing_tasks task ON task.id = agent_run.task_id
         JOIN actors actor ON actor.id = agent_run.actor_id
        WHERE agent_run.id = $1 AND agent_run.status = 'submitted'
        FOR UPDATE OF agent_run, task`,
      [run.id],
    )
    const current = locked.rows[0]
    if (!current || current.task_status !== 'claimed' || current.current_submission_id !== null
        || current.claimed_by !== run.actor_id || !current.automation_lease_until
        || new Date(current.automation_lease_until) <= new Date()) {
      await client.query('ROLLBACK')
      return false
    }

    let rulesAdjusted = false
    if (draft.kind === 'article') {
      const overrides = await loadArticleRuleOverrides(client)
      const fitted = fitArticleToRules({
        title: draft.title,
        body: draft.body,
        sources: draft.sources,
        authorshipMode: draft.authorship?.authorshipMode,
        modelName: draft.authorship?.modelName,
        humanContribution: draft.authorship?.humanContribution,
      }, overrides)
      if (!fitted.ok || fitted.article.title.trim().length < 8 || fitted.article.body.trim().length < 20) {
        throw new Error('The automatic article does not follow the node publication rules.')
      }
      draft = { ...draft, title: fitted.article.title, body: fitted.article.body }
      rulesAdjusted = fitted.adjusted
    }
    const revision = await client.query('SELECT coalesce(max(revision_no), 0)::int + 1 AS revision_no FROM article_writing_submissions WHERE task_id = $1', [run.task_id])
    const inserted = await client.query(
      `INSERT INTO article_writing_submissions
        (task_id, revision_no, submitted_by, kind, title, body_markdown, sources, overview,
         authorship_mode, model_name, human_contribution)
       VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9, $10, $11)
       RETURNING id`,
      [run.task_id, revision.rows[0].revision_no, run.actor_id, draft.kind, draft.title,
        draft.body, JSON.stringify(draft.sources), draft.overview, draft.authorship?.authorshipMode || null,
        draft.authorship?.modelName || null, draft.authorship?.humanContribution || null],
    )

    const slug = await allocateRequestedSlug(client, draft.slug)
    const status = await openingTopicStatus(client, 'published')
    const topic = await client.query(
      `INSERT INTO topics (node_id, author_id, slug, kind, status, summary)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, slug, kind, created_at`,
      [current.node_id, run.actor_id, slug, draft.kind, status, draft.kind === 'article' ? draft.overview : null],
    )
    const articleKind = draft.kind === 'article'
    const publishedRevision = await client.query(
      `INSERT INTO revisions
        (topic_id, author_id, locale, title, body_markdown, authorship_mode, model_name, human_contribution)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING id, title, body_markdown, created_at`,
      [topic.rows[0].id, run.actor_id, run.locale, draft.title, draft.body,
        articleKind ? draft.authorship.authorshipMode : null,
        articleKind ? draft.authorship.modelName : null,
        articleKind ? draft.authorship.humanContribution : null],
    )
    await client.query(
      'INSERT INTO topic_current_revisions (topic_id, locale, revision_id) VALUES ($1, $2, $3)',
      [topic.rows[0].id, run.locale, publishedRevision.rows[0].id],
    )
    await recordRevisionDiff(client, {
      revisionId: publishedRevision.rows[0].id,
      title: publishedRevision.rows[0].title,
      body: publishedRevision.rows[0].body_markdown,
      origin: 'publication',
      introducedBy: run.actor_id,
      confirmedBy: run.actor_id,
      introducedAt: publishedRevision.rows[0].created_at,
      confirmedAt: publishedRevision.rows[0].created_at,
    })
    await client.query('INSERT INTO page_read_counts (topic_id) VALUES ($1)', [topic.rows[0].id])
    for (const source of sources) await attachCitation(client, { topicId: topic.rows[0].id, revisionId: publishedRevision.rows[0].id, source })

    await client.query(
      `UPDATE article_writing_tasks
          SET status = 'accepted', current_submission_id = $2,
              claimed_by = NULL, claim_actor_label = NULL, claim_expires_at = NULL,
              automation_lease_until = NULL, updated_at = now()
        WHERE id = $1`,
      [run.task_id, inserted.rows[0].id],
    )
    await client.query(
      `UPDATE article_order_submissions
          SET status = 'succeeded', execution_state = 'draft_ready', result_topic_id = $2,
              error_code = NULL, executor_error_code = NULL, finished_at = now(), updated_at = now()
        WHERE id = $1`,
      [current.order_id, topic.rows[0].id],
    )
    await client.query(
      `UPDATE writing_task_agent_runs SET status = 'completed', progress_percent = 100,
              progress_stage = 'published', progress_message = NULL, finished_at = now(),
              executor_lease_until = NULL, executor_next_poll_at = NULL,
              error_code = NULL, provider_cost = COALESCE($2::jsonb, provider_cost), updated_at = now()
        WHERE id = $1 AND status = 'submitted'`,
      [run.id, providerCost === null ? null : JSON.stringify(providerCost)],
    )
    await client.query(
      `INSERT INTO actor_audit_log (actor_id, action, target_type, target_id, details)
       VALUES ($1, 'writing_task_agent_published', 'writing_task_agent_run', $2,
               jsonb_build_object('task_id', $3::text, 'submission_id', $4::text,
                 'topic_id', $5::text, 'wpg_charged', 1, 'automatic_publication', true,
                 'rules_confirmed_by', 'agent', 'rules_adjusted', $6::boolean))`,
      [run.actor_id, run.id, run.task_id, inserted.rows[0].id, topic.rows[0].id, rulesAdjusted],
    )
    await client.query('COMMIT')
    if (status === 'published' || status === 'unlisted') {
      await checkPageContent(database, {
        topicId: topic.rows[0].id,
        trigger: 'publish',
        article: { title: draft.title, body: draft.body },
      })
    }
    return true
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
}

async function allocateRequestedSlug(client, requested) {
  if (!requested) return allocateTopicSlug(client, null)
  try {
    return await allocateTopicSlug(client, requested)
  } catch (error) {
    if (error.statusCode === 400 || error.statusCode === 409) return allocateTopicSlug(client, null)
    throw error
  }
}

async function attachCitation(client, { topicId, revisionId, source }) {
  const sourceResult = await client.query(
    `INSERT INTO sources (canonical_url, title, publisher, source_type, published_at)
     VALUES ($1, NULLIF($2::text, ''), NULLIF($3::text, ''), 'external', $4::date)
     ON CONFLICT (canonical_url) DO UPDATE SET
       title = coalesce(sources.title, EXCLUDED.title),
       publisher = coalesce(sources.publisher, EXCLUDED.publisher),
       published_at = coalesce(sources.published_at, EXCLUDED.published_at)
     RETURNING id`,
    [source.url, source.title || '', source.publisher || '', source.publishedAt || null],
  )
  await client.query(
    `INSERT INTO citations (topic_id, source_id, revision_id, locator, note)
     VALUES ($1, $2, $3, NULLIF($4::text, ''), NULLIF($5::text, ''))`,
    [topicId, sourceResult.rows[0].id, revisionId, source.locator || '', source.note || ''],
  )
}

async function failRun(database, run, errorCode, errorMessage = null, providerCost = null, providerResponse = null) {
  const client = await database.connect()
  try {
    await client.query('BEGIN')
    const changed = await client.query(
      `UPDATE writing_task_agent_runs SET status = 'failed', error_code = $2,
              progress_percent = 100, progress_stage = 'failed', progress_message = $3,
              provider_cost = COALESCE($4::jsonb, provider_cost),
              provider_response = COALESCE($5::jsonb, provider_response),
              finished_at = now(), executor_lease_until = NULL,
              executor_next_poll_at = NULL, updated_at = now()
        WHERE id = $1 AND status IN ('queued', 'submitted') RETURNING id`,
      [run.id, errorCode, errorMessage, providerCost === null ? null : JSON.stringify(providerCost),
        providerResponse === null ? null : JSON.stringify(providerResponse)],
    )
    if (!changed.rows[0]) {
      await client.query('ROLLBACK')
      return
    }
    await client.query(
      `INSERT INTO actor_token_ledger
        (actor_id, amount, reason, source_type, source_id, idempotency_key, description)
       VALUES ($1, 1, 'agent_run_refund', 'agent_run', $2, $3, 'Refund for failed Neron Agent execution')
       ON CONFLICT (idempotency_key) DO NOTHING`,
      [run.actor_id, run.id, `agent-run-refund:${run.id}`],
    )
    await client.query(
      `UPDATE article_writing_tasks
          SET status = 'claimed', claimed_by = $2,
              claim_actor_label = 'Agent retry available',
              claim_expires_at = now() + interval '2 hours',
              automation_lease_until = NULL, updated_at = now()
        WHERE id = $1 AND status = 'claimed' AND current_submission_id IS NULL`,
      [run.task_id, run.actor_id],
    )
    await client.query(
      `INSERT INTO actor_audit_log (actor_id, action, target_type, target_id, details)
       VALUES ($1, 'writing_task_agent_run_refunded', 'writing_task_agent_run', $2,
               jsonb_build_object('task_id', $3::text, 'error_code', $4::text))`,
      [run.actor_id, run.id, run.task_id, errorCode],
    )
    await client.query('COMMIT')
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
}

async function expireOldAgentRuns(database) {
  const result = await database.query(
    `SELECT run.id, run.task_id, run.actor_id FROM writing_task_agent_runs run
      WHERE run.status IN ('queued', 'submitted') AND run.created_at < now() - interval '2 hours'
        AND run.executor_lease_until IS NULL LIMIT 10`,
  )
  for (const run of result.rows) await failRun(database, run, 'executor_timeout')
}

function presentProviderProgress(task = {}) {
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

function providerErrorMessage(task = {}) {
  const nested = task.error && typeof task.error === 'object' ? task.error : {}
  return String(task.error_message || nested.message || task.message || '').replace(/\0/g, '').trim().slice(0, 240) || null
}

function isTransient(error) {
  return ![400, 401, 402, 403, 404, 422].includes(Number(error?.status))
}

export { processDueAgentRuns, publishRunResult, failRun, presentProviderProgress }
