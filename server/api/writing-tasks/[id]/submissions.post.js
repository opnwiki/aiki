import { createError, readBody, setResponseStatus } from 'h3'
import { getDatabase } from '../../../utils/database.js'
import { requireWritingTaskActor, validateOverviewTaskSubmission, validateWritingSubmission } from '../../../utils/writing-tasks.js'
import { enforceContentQuota, enforceRateLimit } from '../../../utils/rate-limit.js'
import { loadArticleRuleOverrides, reviewArticle, rulesConsentError, rulesReviewError } from '../../../utils/article-rules.js'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export default defineEventHandler(async (event) => {
  const actor = await requireWritingTaskActor(event)
  await enforceRateLimit(event, { action: 'writing-task-submit', limit: 20, actor })
  await enforceContentQuota(event, actor, 'solution')
  const { id } = getRouterParams(event)
  if (!UUID.test(id || '')) throw createError({ statusCode: 404, statusMessage: 'Writing task not found.' })
  const body = await readBody(event)
  const taskType = await getDatabase().query('SELECT task_type FROM article_writing_tasks WHERE id = $1', [id])
  if (!taskType.rows[0]) throw createError({ statusCode: 404, statusMessage: 'Writing task not found.' })
  if (taskType.rows[0].task_type === 'overview') return submitOverviewTask({ event, id, actor, body })
  const checked = validateWritingSubmission(body)
  if (!checked.ok) throw createError({ statusCode: 400, statusMessage: 'Please correct the writing submission.' })
  if (checked.value.kind === 'article') {
    if (body.rulesConsent !== true) throw rulesConsentError()
    const rules = reviewArticle({
      title: checked.value.title,
      body: checked.value.body,
      sources: checked.value.sources,
      authorshipMode: checked.value.authorship?.authorshipMode,
      modelName: checked.value.authorship?.modelName,
      humanContribution: checked.value.authorship?.humanContribution,
    }, await loadArticleRuleOverrides(getDatabase()))
    if (!rules.ok) throw rulesReviewError(rules.findings)
  }

  const client = await getDatabase().connect()
  let task
  let submission
  try {
    await client.query('BEGIN')
    const locked = await client.query(
      `SELECT id, status, claimed_by, claim_expires_at, current_submission_id, automation_lease_until
         FROM article_writing_tasks WHERE id = $1 FOR UPDATE`,
      [id],
    )
    task = locked.rows[0]
    if (!task) throw createError({ statusCode: 404, statusMessage: 'Writing task not found.' })
    if (task.status === 'claimed' && new Date(task.claim_expires_at) <= new Date()) {
      throw createError({ statusCode: 409, statusMessage: 'This claim expired. Claim the task again before submitting.' })
    }
    if (task.status === 'claimed' && task.claimed_by !== actor.id) {
      throw createError({ statusCode: 409, statusMessage: 'Another writer currently holds this claim.' })
    }
    if (task.automation_lease_until && new Date(task.automation_lease_until) > new Date()) throw createError({ statusCode: 409, statusMessage: 'A Neron Agent run is in progress for this task.' })
    if (!['open', 'claimed'].includes(task.status)) throw createError({ statusCode: 409, statusMessage: 'This writing task is not open for a new submission.' })
    const order = await client.query(
      `SELECT assessment.locale FROM article_order_submissions orders
         JOIN article_order_assessments assessment ON assessment.id = orders.assessment_id
        WHERE orders.id = (SELECT order_id FROM article_writing_tasks WHERE id = $1)`,
      [id],
    )
    if (!order.rows[0]) throw createError({ statusCode: 404, statusMessage: 'Writing task not found.' })
    if (checked.value.locale !== order.rows[0].locale) throw createError({ statusCode: 400, statusMessage: 'Submission language must match the requested language.' })
    const revision = await client.query(
      `SELECT coalesce(max(revision_no), 0)::int + 1 AS revision_no
         FROM article_writing_submissions WHERE task_id = $1`,
      [id],
    )
    const inserted = await client.query(
      `INSERT INTO article_writing_submissions
         (task_id, revision_no, submitted_by, kind, title, body_markdown, sources, overview,
          authorship_mode, model_name, human_contribution)
       VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9, $10, $11)
       RETURNING id, revision_no, submitted_by, kind, title, body_markdown,
                 sources, overview, authorship_mode, model_name, human_contribution, created_at`,
      [id, revision.rows[0].revision_no, actor.id, checked.value.kind, checked.value.title,
        checked.value.body, JSON.stringify(checked.value.sources), checked.value.overview, checked.value.authorship?.authorshipMode || null,
        checked.value.authorship?.modelName || null, checked.value.authorship?.humanContribution || null],
    )
    submission = inserted.rows[0]
    await client.query(
      `UPDATE article_writing_tasks
          SET status = 'submitted', current_submission_id = $2,
              claimed_by = NULL, claim_actor_label = NULL, claim_expires_at = NULL, updated_at = now()
        WHERE id = $1`,
      [id, submission.id],
    )
    await client.query(
      `UPDATE article_order_submissions
          SET status = 'draft_ready', execution_state = 'draft_ready',
              finished_at = now(), updated_at = now()
        WHERE id = (SELECT order_id FROM article_writing_tasks WHERE id = $1)
          AND execution_state = 'community'`,
      [id],
    )
    await client.query('COMMIT')
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
  setResponseStatus(event, 201)
  return { submission }
})

async function submitOverviewTask({ event, id, actor, body }) {
  const checked = validateOverviewTaskSubmission(body)
  if (!checked.ok) throw createError({ statusCode: 400, statusMessage: 'Please provide an overview and an 8–2000 character rationale.' })

  const client = await getDatabase().connect()
  let submission
  let proposal
  try {
    await client.query('BEGIN')
    const locked = await client.query(
      `SELECT task.id, task.status, task.claimed_by, task.claim_expires_at,
              task.current_submission_id, task.automation_lease_until,
              task.topic_id, task.target_revision_id,
              topic.status AS topic_status, current.revision_id AS current_revision_id,
              revision.locale, revision.title, revision.body_markdown,
              revision.authorship_mode, revision.model_name, revision.human_contribution
         FROM article_writing_tasks task
         JOIN topics topic ON topic.id = task.topic_id
         JOIN topic_current_revisions current ON current.topic_id = topic.id AND current.revision_id = task.target_revision_id
         JOIN revisions revision ON revision.id = current.revision_id
        WHERE task.id = $1 AND task.task_type = 'overview'
        FOR UPDATE OF task, current` ,
      [id],
    )
    const task = locked.rows[0]
    if (!task) throw createError({ statusCode: 404, statusMessage: 'Overview task not found.' })
    if (task.current_revision_id !== task.target_revision_id) throw createError({ statusCode: 409, statusMessage: 'This page changed. Refresh the task list for a new overview task.' })
    if (!['published', 'unlisted'].includes(task.topic_status)) throw createError({ statusCode: 409, statusMessage: 'This page is no longer available for an overview task.' })
    if (task.locale !== checked.value.locale) throw createError({ statusCode: 400, statusMessage: 'The overview language must match the page.' })
    if (task.status === 'claimed' && new Date(task.claim_expires_at) <= new Date()) {
      throw createError({ statusCode: 409, statusMessage: 'This claim expired. Claim the task again before submitting.' })
    }
    if (task.status === 'claimed' && task.claimed_by !== actor.id) {
      throw createError({ statusCode: 409, statusMessage: 'Another agent currently holds this claim.' })
    }
    if (task.automation_lease_until && new Date(task.automation_lease_until) > new Date()) throw createError({ statusCode: 409, statusMessage: 'An agent run is already in progress for this task.' })
    if (!['open', 'claimed'].includes(task.status)) throw createError({ statusCode: 409, statusMessage: 'This overview task is not open for a new submission.' })

    const revision = await client.query(
      `SELECT coalesce(max(revision_no), 0)::int + 1 AS revision_no
         FROM article_writing_submissions WHERE task_id = $1`,
      [id],
    )
    const inserted = await client.query(
      `INSERT INTO article_writing_submissions
         (task_id, revision_no, submitted_by, kind, title, body_markdown, sources, overview,
          authorship_mode, model_name, human_contribution)
       VALUES ($1, $2, $3, 'overview', $4, $5, '[]'::jsonb, $6, NULL, NULL, NULL)
       RETURNING id, revision_no, submitted_by, kind, title, body_markdown, sources, overview, created_at`,
      [id, revision.rows[0].revision_no, actor.id, task.title, task.body_markdown, checked.value.overview],
    )
    submission = inserted.rows[0]
    const createdProposal = await client.query(
      `INSERT INTO edit_proposals
         (topic_id, base_revision_id, author_id, locale, proposed_title,
          proposed_body_markdown, rationale, proposal_type, proposed_summary, source_task_id)
       VALUES ($1, $2, $3, $4, NULL, $5, $6, 'overview', $7, $8)
       RETURNING id, topic_id, base_revision_id, author_id, locale, proposal_type,
                 proposed_summary, rationale, status, created_at`,
      [task.topic_id, task.target_revision_id, actor.id, task.locale, task.body_markdown,
        checked.value.rationale, checked.value.overview, id],
    )
    proposal = createdProposal.rows[0]
    await client.query(
      `UPDATE article_writing_tasks
          SET status = 'submitted', current_submission_id = $2,
              claimed_by = NULL, claim_actor_label = NULL, claim_expires_at = NULL,
              updated_at = now()
        WHERE id = $1`,
      [id, submission.id],
    )
    await client.query(
      `INSERT INTO actor_audit_log (actor_id, action, target_type, target_id, details)
       VALUES ($1, 'overview_task_submitted', 'article_writing_task', $2,
               jsonb_build_object('proposal_id', $3::text, 'topic_id', $4::text))`,
      [actor.id, id, proposal.id, task.topic_id],
    )
    await client.query('COMMIT')
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
  setResponseStatus(event, 201)
  return { submission, proposal, overviewTask: true }
}
