import { createError, readBody } from 'h3'
import { getDatabase } from '../../../utils/database.js'
import { requireTaskReviewer } from '../../../utils/writing-tasks.js'
import { enforceRateLimit } from '../../../utils/rate-limit.js'
import { allocateTopicSlug } from '../../../utils/page-address.js'
import { recordRevisionDiff } from '../../../utils/revision-history.js'
import { loadArticleRuleOverrides, reviewArticle, rulesReviewError } from '../../../utils/article-rules.js'
import { checkPageContent, openingTopicStatus } from '../../../utils/moderation.js'
import { markHumanReviewedAuthorship } from '../../../utils/authorship.js'
import { notifySearchDiscovery } from '../../../utils/search-discovery.js'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export default defineEventHandler(async (event) => {
  enforceSameOrigin(event)
  await enforceRateLimit(event, { action: 'writing-task-review', limit: 30 })
  const { id } = getRouterParams(event)
  if (!UUID.test(id || '')) throw createError({ statusCode: 404, statusMessage: 'Writing task not found.' })
  const body = await readBody(event)
  if (!body || typeof body !== 'object' || Array.isArray(body)
      || Object.keys(body).some(key => !['decision', 'comment'].includes(key))
      || !['accepted', 'rejected'].includes(body.decision)
      || typeof body.comment !== 'string' || body.comment.trim().length < 8 || body.comment.trim().length > 2000) {
    throw createError({ statusCode: 400, statusMessage: 'Provide an accepted/rejected decision and an 8–2000 character review comment.' })
  }
  const database = getDatabase()
  const preview = await database.query(
    `SELECT submission.submitted_by FROM article_writing_tasks task
       JOIN article_writing_submissions submission ON submission.id = task.current_submission_id
      WHERE task.id = $1 AND task.status = 'submitted'`,
    [id],
  )
  if (!preview.rows[0]) throw createError({ statusCode: 409, statusMessage: 'This task has no submission awaiting review.' })
  const reviewer = await requireTaskReviewer(event, preview.rows[0].submitted_by)
  const client = await database.connect()
  let result
  try {
    await client.query('BEGIN')
    const locked = await client.query(
      `SELECT task.id, task.order_id, task.current_submission_id, assessment.query_text,
              assessment.locale, submission.kind, submission.title, submission.body_markdown,
              submission.sources, submission.overview, submission.authorship_mode, submission.model_name,
              submission.human_contribution, submission.submitted_by, submission.created_at AS submitted_at
         FROM article_writing_tasks task
         JOIN article_order_submissions orders ON orders.id = task.order_id
         JOIN article_order_assessments assessment ON assessment.id = orders.assessment_id
         JOIN article_writing_submissions submission ON submission.id = task.current_submission_id
        WHERE task.id = $1 AND task.status = 'submitted'
        FOR UPDATE OF task`,
      [id],
    )
    const task = locked.rows[0]
    if (!task) throw createError({ statusCode: 409, statusMessage: 'This task changed while it was being reviewed.' })
    if (reviewer.id === task.submitted_by) throw createError({ statusCode: 403, statusMessage: 'You cannot review your own submission.' })
    const review = await client.query(
      `INSERT INTO article_writing_reviews (task_id, submission_id, reviewer_id, decision, comment)
       VALUES ($1, $2, $3, $4, $5) RETURNING id, created_at`,
      [id, task.current_submission_id, reviewer.id, body.decision, body.comment.trim()],
    )
    if (body.decision === 'rejected') {
      await client.query(
        `UPDATE article_writing_tasks SET status = 'open', current_submission_id = NULL,
                claimed_by = NULL, claim_actor_label = NULL, claim_expires_at = NULL,
                automation_lease_until = NULL, updated_at = now() WHERE id = $1`,
        [id],
      )
      await client.query(
        `UPDATE article_order_submissions
            SET status = 'queued', execution_state = 'community', finished_at = NULL, updated_at = now()
          WHERE id = $1 AND status = 'draft_ready'`,
        [task.order_id],
      )
      result = { review: review.rows[0], taskStatus: 'open', topic: null }
    } else {
      if (task.kind === 'article') {
        const rules = reviewArticle({
          title: task.title,
          body: task.body_markdown,
          sources: Array.isArray(task.sources) ? task.sources : [],
          authorshipMode: task.authorship_mode,
          modelName: task.model_name,
          humanContribution: task.human_contribution,
        }, await loadArticleRuleOverrides(client))
        if (!rules.ok) throw rulesReviewError(rules.findings)
      }
      const slug = await allocateTopicSlug(client, null)
      const node = await client.query('SELECT node_id FROM actors WHERE id = $1', [reviewer.id])
      const authorId = task.submitted_by || reviewer.id
      const status = await openingTopicStatus(client, 'published')
      const topic = await client.query(
        `INSERT INTO topics (node_id, author_id, slug, kind, status, summary) VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING id, slug, page_number, kind, created_at`,
        [node.rows[0]?.node_id || null, authorId, slug, task.kind, status, task.kind === 'article' ? task.overview : null],
      )
      const articleKind = task.kind === 'article'
      const revision = await client.query(
        `INSERT INTO revisions
           (topic_id, author_id, locale, title, body_markdown, authorship_mode, model_name, human_contribution)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         RETURNING id, locale, title, body_markdown, authorship_mode, model_name, human_contribution, created_at`,
        [topic.rows[0].id, authorId, task.locale, task.title, task.body_markdown,
          articleKind ? markHumanReviewedAuthorship(task.authorship_mode, true) : null, articleKind ? task.model_name : null,
          articleKind ? task.human_contribution : null],
      )
      await client.query('INSERT INTO topic_current_revisions (topic_id, locale, revision_id) VALUES ($1, $2, $3)', [topic.rows[0].id, task.locale, revision.rows[0].id])
      await recordRevisionDiff(client, {
        revisionId: revision.rows[0].id,
        title: revision.rows[0].title,
        body: revision.rows[0].body_markdown,
        origin: 'publication',
        introducedBy: authorId,
        confirmedBy: reviewer.id,
        introducedAt: task.submitted_at,
        confirmedAt: review.rows[0].created_at,
      })
      await client.query('INSERT INTO page_read_counts (topic_id) VALUES ($1)', [topic.rows[0].id])
      if (Array.isArray(task.sources)) {
        for (const source of task.sources) await attachCitation(client, { topicId: topic.rows[0].id, revisionId: revision.rows[0].id, source })
      }
      await client.query(
        `INSERT INTO actor_audit_log (actor_id, action, target_type, target_id, details)
         VALUES ($1, 'article_writing_task_accepted', 'article_writing_task', $2,
           jsonb_build_object('submission_id', $3::text, 'topic_id', $4::text))`,
        [reviewer.id, id, task.current_submission_id, topic.rows[0].id],
      )
      if (articleKind && task.submitted_by && task.submitted_by !== reviewer.id) {
        await client.query(
          `INSERT INTO actor_token_ledger
            (actor_id, amount, reason, source_type, source_id, idempotency_key, description)
           VALUES ($1::uuid, 1, 'article_accepted', 'writing_task', $2::uuid,
                   'accepted-writing-task:' || $3::text, $4)
           ON CONFLICT (idempotency_key) DO NOTHING`,
          [task.submitted_by, id, id, `+1 WPG за принятую статью «${task.title}»`],
        )
      }
      await client.query(`UPDATE article_writing_tasks SET status = 'accepted', updated_at = now() WHERE id = $1`, [id])
      await client.query(
        `UPDATE article_order_submissions SET status = 'succeeded', result_topic_id = $2,
                execution_state = 'draft_ready', error_code = NULL, finished_at = now(), updated_at = now()
          WHERE id = $1`,
        [task.order_id, topic.rows[0].id],
      )
      result = { review: review.rows[0], taskStatus: 'accepted', topic: { ...topic.rows[0], revision: revision.rows[0], path: `/${topic.rows[0].page_number}` } }
    }
    await client.query('COMMIT')
  } catch (error) {
    await client.query('ROLLBACK')
    if (error.statusCode) throw createError({ statusCode: error.statusCode, statusMessage: error.message })
    if (error?.code === '23505') throw createError({ statusCode: 409, statusMessage: 'A page with that address already exists. Retry review.' })
    throw error
  } finally {
    client.release()
  }
  const published = result?.topic
  if (published && (published.status === 'published' || published.status === 'unlisted')) {
    await checkPageContent(getDatabase(), {
      topicId: published.id,
      trigger: 'publish',
      article: { title: published.revision.title, body: published.revision.body_markdown },
    })
    const fresh = await getDatabase().query('SELECT page_number, status FROM topics WHERE id = $1', [published.id])
    if (fresh.rows[0]?.status === 'published' && fresh.rows[0]?.page_number != null) {
      void notifySearchDiscovery({ siteUrl: useRuntimeConfig().public.siteUrl, paths: [`/${fresh.rows[0].page_number}`] })
    }
  }
  return result
})

async function attachCitation(client, { topicId, revisionId, source }) {
  const sourceResult = await client.query(
    `INSERT INTO sources (canonical_url, title, publisher, source_type)
     VALUES ($1, NULLIF($2::text, ''), NULLIF($3::text, ''), 'external')
     ON CONFLICT (canonical_url) DO UPDATE SET
       title = coalesce(sources.title, EXCLUDED.title),
       publisher = coalesce(sources.publisher, EXCLUDED.publisher)
     RETURNING id`,
    [source.url, source.title || '', source.publisher || ''],
  )
  await client.query(
    `INSERT INTO citations (topic_id, source_id, revision_id, locator, note)
     VALUES ($1, $2, $3, NULLIF($4::text, ''), NULLIF($5::text, ''))`,
    [topicId, sourceResult.rows[0].id, revisionId, source.locator || '', source.note || ''],
  )
}
