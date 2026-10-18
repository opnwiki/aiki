import { queryDatabase } from '../../utils/database.js'
import { enforceRateLimit } from '../../utils/rate-limit.js'
import { getHumanActor } from '../../utils/auth.js'

export default defineEventHandler(async (event) => {
  await enforceRateLimit(event, { action: 'writing-task-list', limit: 120 })
  const authActor = await getHumanActor(event)
  const canReview = ['owner', 'admin', 'moderator'].includes(authActor?.role)
  const query = getQuery(event)
  const limitValue = Number.parseInt(String(query.limit || '20'), 10)
  const offsetValue = Number.parseInt(String(query.offset || '0'), 10)
  const limit = Number.isFinite(limitValue) ? Math.min(Math.max(limitValue, 1), 50) : 20
  const offset = Number.isFinite(offsetValue) ? Math.min(Math.max(offsetValue, 0), 10_000) : 0
  const requestedTaskId = typeof query.task === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(query.task) ? query.task : null
  const requestedStatus = typeof query.status === 'string' ? query.status : 'active'
  const statuses = requestedTaskId && requestedStatus === 'active'
    ? ['open', 'claimed', 'submitted', 'accepted', 'closed']
    : requestedStatus === 'all' ? ['open', 'claimed', 'submitted', 'accepted', 'closed']
      : requestedStatus === 'active' ? ['open', 'claimed', 'submitted', 'accepted'] : [requestedStatus]
  if (statuses.some(status => !['open', 'claimed', 'submitted', 'accepted', 'closed'].includes(status))) {
    throw createError({ statusCode: 400, statusMessage: 'Choose a valid writing-task status.' })
  }
  const result = await queryDatabase(
    `SELECT task.id, task.status, task.task_type, task.topic_id, task.target_revision_id,
            task.created_at, task.updated_at,
            coalesce(assessment.query_text, target_revision.title) AS query,
            coalesce(assessment.locale, target_revision.locale) AS locale,
            target_topic.slug AS target_slug,
            target_topic.page_number AS target_page_number,
            target_revision.title AS target_title,
            target_revision.locale AS target_locale,
            submission.id AS submission_id, submission.kind, submission.title,
            submission.body_markdown, submission.sources, submission.authorship_mode,
            submission.model_name, submission.human_contribution, submission.overview,
            submission.created_at AS submitted_at,
            submitter.username AS submitted_by, task.claimed_by,
            task.claim_actor_label, task.claim_expires_at,
            claimant.username AS claimant_username,
            (task.automation_lease_until > now()) AS automation_running,
            latest_run.actor_id AS agent_run_actor_id,
            latest_run.status AS agent_run_status,
            latest_run.error_code AS agent_run_error,
            latest_run.provider_cost AS agent_run_provider_cost,
            latest_run.progress_percent AS agent_run_progress_percent,
            latest_run.progress_stage AS agent_run_progress_stage,
            latest_run.progress_message AS agent_run_progress_message,
            published.slug AS published_slug,
            published.page_number AS published_page_number,
            published_revision.title AS published_title,
            published_revision.body_markdown AS published_body,
            published_revision.locale AS published_locale,
            published_revision.authorship_mode AS published_authorship_mode,
            published_revision.model_name AS published_model_name,
            published_revision.human_contribution AS published_human_contribution,
            coalesce(published_citations.sources, '[]'::jsonb) AS published_sources
       FROM article_writing_tasks task
       LEFT JOIN article_order_submissions orders ON orders.id = task.order_id
       LEFT JOIN article_order_assessments assessment ON assessment.id = orders.assessment_id
       LEFT JOIN topics target_topic ON target_topic.id = task.topic_id
       LEFT JOIN revisions target_revision ON target_revision.id = task.target_revision_id
       LEFT JOIN article_writing_submissions submission ON submission.id = task.current_submission_id
       LEFT JOIN actors submitter ON submitter.id = submission.submitted_by
       LEFT JOIN actors claimant ON claimant.id = task.claimed_by
       LEFT JOIN topics published ON published.id = orders.result_topic_id AND published.status = 'published'
       LEFT JOIN topic_current_revisions published_current ON published_current.topic_id = published.id AND published_current.locale = assessment.locale
       LEFT JOIN revisions published_revision ON published_revision.id = published_current.revision_id
       LEFT JOIN LATERAL (
         SELECT jsonb_agg(jsonb_build_object('url', source.canonical_url, 'title', source.title,
                  'publisher', source.publisher, 'locator', citation.locator, 'note', citation.note)
                  ORDER BY citation.id) AS sources
           FROM citations citation JOIN sources source ON source.id = citation.source_id
          WHERE citation.revision_id = published_revision.id
       ) published_citations ON true
       LEFT JOIN LATERAL (
         SELECT run.actor_id, run.status, run.error_code, run.provider_cost, run.progress_percent,
                run.progress_stage, run.progress_message FROM writing_task_agent_runs run
          WHERE run.task_id = task.id ORDER BY run.created_at DESC LIMIT 1
       ) latest_run ON true
      WHERE task.status = ANY($3::text[])
        AND (task.status <> 'closed' OR task.id = $4::uuid)
        AND ($4::uuid IS NULL OR task.id = $4::uuid)
      ORDER BY CASE WHEN task.id = $4::uuid THEN -1 WHEN task.status = 'submitted' THEN 0 WHEN task.status = 'open' THEN 1 ELSE 2 END,
               task.created_at DESC
      LIMIT $1 OFFSET $2`,
    [limit, offset, statuses, requestedTaskId],
  )
  const count = await queryDatabase(
    `SELECT count(*)::int AS total FROM article_writing_tasks WHERE status = ANY($1::text[]) AND status <> 'closed'`,
    [statuses],
  )
  return {
    items: result.rows.map(row => {
      const ownRun = row.agent_run_actor_id === authActor?.id
      return {
        id: row.id,
        status: row.status,
        taskType: row.task_type || 'writing',
        claimedBy: row.claimed_by,
        automationRunning: Boolean(row.automation_running),
        agentRun: ownRun && row.agent_run_status ? {
          status: row.agent_run_status,
          refunded: row.agent_run_status === 'failed',
          error: row.agent_run_error,
          providerCost: row.agent_run_provider_cost,
          progressPercent: Number(row.agent_run_progress_percent || 0),
          progressStage: row.agent_run_progress_stage || null,
          progressMessage: row.agent_run_progress_message || null,
        } : null,
        publishedPath: ownRun && row.published_page_number ? `/${row.published_page_number}` : null,
        claimActor: row.claim_actor_label || row.claimant_username || null,
        claimExpiresAt: row.claim_expires_at,
        query: row.query,
        locale: row.locale,
        target: row.task_type === 'overview' && row.topic_id ? {
          slug: row.target_slug,
          pageNumber: row.target_page_number,
          title: row.target_title,
          locale: row.target_locale,
          path: row.target_page_number ? `/${row.target_page_number}` : null,
        } : null,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        submission: row.submission_id && (row.status !== 'submitted' || canReview || row.submitted_by === authActor?.username) ? {
          id: row.submission_id,
          kind: row.kind,
          title: row.title,
          body: row.body_markdown,
          overview: row.overview,
          sources: row.sources,
          authorshipMode: row.authorship_mode,
          modelName: row.model_name,
          submittedAt: row.submitted_at,
          submittedBy: row.submitted_by,
        } : null,
        publishedResult: ownRun && row.published_slug ? {
          kind: row.kind,
          title: row.published_title,
          body: row.published_body,
          locale: row.published_locale,
          authorshipMode: row.published_authorship_mode,
          modelName: row.published_model_name,
          humanContribution: row.published_human_contribution,
          sources: row.published_sources,
        } : null,
      }
    }),
    limit,
    offset,
    total: count.rows[0]?.total || 0,
    status: requestedStatus,
  }
})
