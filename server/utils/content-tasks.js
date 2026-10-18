import { createError } from 'h3'
import { validateArticleOverview, validateCitation, validateTopic } from './validation.js'
import { recordRevisionDiff } from './revision-history.js'
import { allocateTopicSlug } from './page-address.js'
import { openingTopicStatus } from './moderation.js'
import { markHumanReviewedAuthorship } from './authorship.js'
import { ensurePublicUsefulnessAssessment, hasPublicUsefulness } from './topic-ai.js'

export const CONTENT_TASK_TYPES = Object.freeze([
  'edit_article', 'answer_question', 'translate', 'update_overview',
  'write_article', 'write_discussion', 'fill_page',
])
export const CONTENT_TASK_STATUSES = Object.freeze(['open', 'claimed', 'submitted', 'under_review', 'resolved'])
export const CONTENT_TASK_LOCALES = Object.freeze(['en', 'zh', 'ru', 'es', 'ja', 'de', 'fr', 'ar'])
export const OVERVIEW_REPLY_REFRESH_THRESHOLD = 3

export function inheritArticleAuthorship({
  baseMode,
  baseModelName,
  baseHumanContribution,
  payload = {},
  solutionModelName,
} = {}) {
  const mode = clean(baseMode || payload.authorshipMode || 'legacy_undisclosed')
  const modelName = ['human_only', 'legacy_undisclosed'].includes(mode)
    ? null
    : clean(baseModelName || payload.modelName || solutionModelName) || null
  const humanContribution = ['ai_generated_unreviewed', 'ai_generated_human_reviewed', 'legacy_undisclosed'].includes(mode)
    ? null
    : clean(baseHumanContribution || payload.humanContribution) || null
  return { mode, modelName, humanContribution }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const STAFF = new Set(['owner', 'admin', 'moderator'])

export function isContentTaskUuid(value) {
  return UUID.test(String(value || ''))
}

export function shouldCreateQuestionArticleTask({ kind, replyCount, sourceRevisionId = null, publicUsefulnessScore = null } = {}) {
  return ['question', 'discussion'].includes(kind) && Number(replyCount || 0) >= 3 && !sourceRevisionId
    && hasPublicUsefulness(publicUsefulnessScore)
}

export function sourceArticleTaskReason(kind) {
  return kind === 'discussion' ? 'discussion_three_answers' : 'question_three_answers'
}

export function replyTaskReason(kind) {
  return kind === 'discussion' ? 'no_reply' : 'no_answer'
}

export function contentTaskSelectSql() {
  return `SELECT task.id, task.node_id, task.topic_id, task.base_revision_id,
                 task.creator_id, task.task_type, task.reason, task.source_locale,
                 task.target_locale, task.status, task.claimed_by,
                 task.claim_actor_label, task.claim_expires_at, task.cycle_no,
                 task.auto_publish_allowed, task.last_promoted_at,
                 task.created_at, task.updated_at,
                 topic.slug AS topic_slug, topic.page_number AS topic_page_number,
                 topic.kind AS topic_kind, topic.status AS topic_status,
                 topic.author_id AS topic_author_id,
                 base.title AS base_title, base.body_markdown AS base_body,
                 base.summary AS base_summary, base.locale AS base_revision_locale,
                 creator.username AS creator_username,
                 creator.display_name AS creator_display_name,
                 creator.agent_name AS creator_agent_name,
                 claimant.username AS claimant_username,
                 claimant.display_name AS claimant_display_name,
                 claimant.agent_name AS claimant_agent_name,
                 (SELECT count(*)::int FROM content_task_solutions solution
                   WHERE solution.task_id = task.id AND solution.cycle_no = task.cycle_no) AS solution_count
            FROM content_tasks task
            LEFT JOIN topics topic ON topic.id = task.topic_id
            LEFT JOIN revisions base ON base.id = task.base_revision_id
            LEFT JOIN actors creator ON creator.id = task.creator_id
            LEFT JOIN actors claimant ON claimant.id = task.claimed_by`
}

export function presentContentTask(row, { solutions = null } = {}) {
  return {
    id: row.id,
    type: row.task_type,
    reason: row.reason,
    status: row.status,
    topic: row.topic_id ? {
      slug: row.topic_slug,
      pageNumber: row.topic_page_number,
      kind: row.topic_kind,
      path: row.topic_page_number ? `/${row.topic_page_number}` : row.topic_slug ? `/${row.topic_slug}` : null,
    } : null,
    baseRevision: row.base_revision_id ? {
      id: row.base_revision_id,
      title: row.base_title,
      body: row.base_body,
      summary: row.base_summary,
      locale: row.base_revision_locale,
    } : null,
    sourceLocale: row.source_locale,
    targetLocale: row.target_locale,
    cycle: row.cycle_no,
    claimedBy: row.claimed_by,
    claimActor: row.claim_actor_label || row.claimant_display_name || row.claimant_agent_name || row.claimant_username || null,
    claimExpiresAt: row.claim_expires_at,
    autoPublishAllowed: row.auto_publish_allowed,
    lastPromotedAt: row.last_promoted_at,
    solutionCount: Number(row.solution_count || 0),
    creator: row.creator_id ? {
      id: row.creator_id,
      username: row.creator_username,
      name: row.creator_display_name || row.creator_agent_name || null,
    } : null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    solutions: Array.isArray(solutions) ? solutions.map(presentContentTaskSolution) : undefined,
  }
}

export function presentContentTaskSolution(row) {
  return {
    id: row.id,
    taskId: row.task_id,
    cycle: row.cycle_no,
    status: row.status,
    submittedBy: row.submitted_by,
    submitter: row.submitter_username ? {
      username: row.submitter_username,
      name: row.submitter_display_name || row.submitter_agent_name || null,
    } : null,
    payload: row.payload,
    sources: row.sources || [],
    model: row.model_name || null,
    client: row.client_label || null,
    providerCost: row.provider_cost || null,
    autoAcceptAt: row.auto_accept_at,
    reviewedBy: row.reviewed_by,
    reviewComment: row.review_comment,
    resultRevisionId: row.result_revision_id,
    resultReplyId: row.result_reply_id,
    resultTopicId: row.result_topic_id,
    createdAt: row.created_at,
    reviewedAt: row.reviewed_at,
  }
}

export async function ensureContentTasks(client, { topicId, baseRevisionId = null, creatorId = null } = {}) {
  if (!topicId) return []
  const topicResult = await client.query(
    `SELECT t.id, t.node_id, t.kind, t.status, t.author_id, t.public_usefulness_score,
            current.revision_id, revision.locale, revision.title,
            revision.body_markdown, revision.summary, revision.source_revision_id,
            (SELECT count(*)::int FROM citations WHERE revision_id = revision.id) AS source_count,
            (SELECT count(*)::int FROM replies WHERE topic_id = t.id AND status = 'published') AS reply_count,
            (SELECT count(*)::int
               FROM replies reply
              WHERE reply.topic_id = t.id
                AND reply.status = 'published'
                AND reply.created_at > coalesce(overview_update.updated_at, t.created_at)) AS reply_count_since_overview
       FROM topics t
       JOIN topic_current_revisions current ON current.topic_id = t.id
       JOIN revisions revision ON revision.id = current.revision_id
       LEFT JOIN LATERAL (
         SELECT summary_revision.created_at AS updated_at
           FROM revisions summary_revision
           LEFT JOIN revisions summary_parent ON summary_parent.id = summary_revision.parent_revision_id
          WHERE summary_revision.topic_id = t.id
            AND summary_revision.locale = revision.locale
            AND summary_revision.summary IS DISTINCT FROM summary_parent.summary
          ORDER BY summary_revision.created_at DESC, summary_revision.id DESC
          LIMIT 1
       ) overview_update ON true
      WHERE t.id = $1
        AND t.status IN ('published', 'unlisted', 'hidden')
        AND ($2::uuid IS NULL OR current.revision_id = $2::uuid)
      ORDER BY current.locale` ,
    [topicId, baseRevisionId],
  )
  if (!topicResult.rows.length) return []

  const created = []
  for (const topic of topicResult.rows) {
    await ensurePublicUsefulnessAssessment(client, { topic, requesterId: creatorId || topic.author_id })
    const summary = String(topic.summary || '').trim()
    const bodyText = String(topic.body_markdown || '').replace(/[`*_>#\[\]()!~]/g, ' ').replace(/\s+/g, ' ').trim()
    if (['article', 'question', 'discussion'].includes(topic.kind) && !summary) {
      created.push(await createOrReuseContentTask(client, {
        nodeId: topic.node_id, topicId: topic.id, baseRevisionId: topic.revision_id,
        creatorId: creatorId || topic.author_id, taskType: 'update_overview', reason: 'missing_overview',
        sourceLocale: topic.locale,
      }))
    }
    if (topic.kind === 'page' && bodyText.length < 400) {
      created.push(await createOrReuseContentTask(client, {
        nodeId: topic.node_id, topicId: topic.id, baseRevisionId: topic.revision_id,
        creatorId: creatorId || topic.author_id, taskType: 'fill_page', reason: 'page_needs_content',
        sourceLocale: topic.locale,
      }))
    }
    if (['article', 'question', 'discussion'].includes(topic.kind)
      && summary
      && Number(topic.reply_count_since_overview || 0) >= OVERVIEW_REPLY_REFRESH_THRESHOLD) {
      created.push(await createOrReuseOverviewRefreshTask(client, {
        nodeId: topic.node_id, topicId: topic.id, baseRevisionId: topic.revision_id,
        creatorId: creatorId || topic.author_id, sourceLocale: topic.locale,
      }))
    }
    if (topic.kind === 'article') {
      if (bodyText.length < 400) created.push(await createOrReuseContentTask(client, {
        nodeId: topic.node_id, topicId: topic.id, baseRevisionId: topic.revision_id,
        creatorId: creatorId || topic.author_id, taskType: 'edit_article', reason: 'insufficient_body',
        sourceLocale: topic.locale,
      }))
      if (Number(topic.source_count || 0) === 0) created.push(await createOrReuseContentTask(client, {
        nodeId: topic.node_id, topicId: topic.id, baseRevisionId: topic.revision_id,
        creatorId: creatorId || topic.author_id, taskType: 'edit_article', reason: 'missing_sources',
        sourceLocale: topic.locale,
      }))
    }
    if (['question', 'discussion'].includes(topic.kind) && Number(topic.reply_count || 0) === 0) {
      created.push(await createOrReuseContentTask(client, {
        nodeId: topic.node_id, topicId: topic.id, baseRevisionId: topic.revision_id,
        creatorId: creatorId || topic.author_id, taskType: 'answer_question', reason: replyTaskReason(topic.kind),
        sourceLocale: topic.locale,
      }))
    }
    if (shouldCreateQuestionArticleTask({
      kind: topic.kind,
      replyCount: topic.reply_count,
      sourceRevisionId: topic.source_revision_id,
      publicUsefulnessScore: topic.public_usefulness_score,
    })) {
      created.push(await createOrReuseContentTask(client, {
        nodeId: topic.node_id, topicId: topic.id, baseRevisionId: topic.revision_id,
        creatorId: creatorId || topic.author_id, taskType: 'write_article', reason: sourceArticleTaskReason(topic.kind),
        sourceLocale: topic.locale,
      }))
    }
  }

  // Machine translations are useful but should receive a separate verification
  // task instead of silently becoming the canonical human-approved text.
  const translations = await client.query(
    `SELECT snapshot.revision_id, snapshot.topic_id, snapshot.locale,
            snapshot.source_revision_id, snapshot.machine_title, snapshot.machine_body, snapshot.machine_summary,
            revision.title, revision.body_markdown, revision.summary, source.locale AS source_locale
       FROM translation_snapshots snapshot
       JOIN revisions revision ON revision.id = snapshot.revision_id
       JOIN revisions source ON source.id = snapshot.source_revision_id
       JOIN topic_current_revisions current
         ON current.topic_id = snapshot.topic_id AND current.locale = snapshot.locale
        AND current.revision_id = snapshot.revision_id
      WHERE snapshot.topic_id = $1
        AND snapshot.machine_title IS NOT DISTINCT FROM revision.title
        AND snapshot.machine_body IS NOT DISTINCT FROM revision.body_markdown
        AND snapshot.machine_summary IS NOT DISTINCT FROM revision.summary` ,
    [topicId],
  )
  for (const translation of translations.rows) {
    created.push(await createOrReuseContentTask(client, {
      topicId: translation.topic_id,
      baseRevisionId: translation.revision_id,
      creatorId,
      taskType: 'translate',
      reason: 'translation_review',
      sourceLocale: translation.source_locale,
      targetLocale: translation.locale,
    }))
  }
  return created.filter(Boolean)
}

export async function createOrReuseContentTask(client, {
  nodeId = null, topicId = null, baseRevisionId = null, creatorId = null,
  taskType, reason = 'manual', sourceLocale = null, targetLocale = null,
  cycleNo = 1,
}) {
  if (!CONTENT_TASK_TYPES.includes(taskType)) throw createError({ statusCode: 400, statusMessage: 'Unsupported task type.' })
  const result = await client.query(
    `INSERT INTO content_tasks
       (node_id, topic_id, base_revision_id, creator_id, task_type, reason,
        source_locale, target_locale, cycle_no)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     ON CONFLICT DO NOTHING
     RETURNING id, status, task_type, reason, topic_id, base_revision_id, cycle_no` ,
    [nodeId, topicId, baseRevisionId, creatorId, taskType, reason, sourceLocale, targetLocale, cycleNo],
  )
  if (result.rows[0]) {
    await client.query(
      `INSERT INTO content_task_events (task_id, actor_id, event_type, details)
       VALUES ($1, $2, 'created', jsonb_build_object('automatic', $3::boolean))`,
      [result.rows[0].id, creatorId, reason !== 'manual'],
    )
    return result.rows[0]
  }
  const existing = await client.query(
    `SELECT id, status, task_type, reason, topic_id, base_revision_id, cycle_no
       FROM content_tasks
      WHERE topic_id IS NOT DISTINCT FROM $1
        AND base_revision_id IS NOT DISTINCT FROM $2
        AND task_type = $3 AND reason = $4
        AND source_locale IS NOT DISTINCT FROM $5
        AND target_locale IS NOT DISTINCT FROM $6
        AND cycle_no = $7
      LIMIT 1`,
    [topicId, baseRevisionId, taskType, reason, sourceLocale, targetLocale, cycleNo],
  )
  return existing.rows[0] || null
}

async function createOrReuseOverviewRefreshTask(client, {
  nodeId = null, topicId, baseRevisionId = null, creatorId = null, sourceLocale = null,
}) {
  const latest = await client.query(
    `SELECT id, status, cycle_no, base_revision_id
       FROM content_tasks
      WHERE topic_id = $1 AND task_type = 'update_overview' AND reason = 'new_replies'
      ORDER BY cycle_no DESC, created_at DESC
      LIMIT 1`,
    [topicId],
  )
  const existing = latest.rows[0]
  if (existing
    && ['open', 'claimed', 'submitted', 'under_review'].includes(existing.status)
    && existing.base_revision_id === baseRevisionId) return existing
  return createOrReuseContentTask(client, {
    nodeId, topicId, baseRevisionId, creatorId, taskType: 'update_overview', reason: 'new_replies',
    sourceLocale, cycleNo: Number(existing?.cycle_no || 0) + 1,
  })
}

export function validateContentTaskInput(input = {}) {
  const allowed = new Set(['type', 'taskType', 'topicId', 'topicSlug', 'baseRevisionId', 'reason', 'sourceLocale', 'targetLocale'])
  if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(key => !allowed.has(key))) {
    return { ok: false, error: 'unknown_field' }
  }
  const taskType = String(input.taskType || input.type || '')
  if (!CONTENT_TASK_TYPES.includes(taskType)) return { ok: false, error: 'invalid_task_type' }
  const sourceLocale = input.sourceLocale == null ? null : String(input.sourceLocale)
  const targetLocale = input.targetLocale == null ? null : String(input.targetLocale)
  if ((sourceLocale && !CONTENT_TASK_LOCALES.includes(sourceLocale)) || (targetLocale && !CONTENT_TASK_LOCALES.includes(targetLocale))) return { ok: false, error: 'invalid_locale' }
  if (taskType === 'translate' && !targetLocale) return { ok: false, error: 'target_locale_required' }
  if (taskType !== 'translate' && targetLocale) return { ok: false, error: 'target_locale_only_for_translation' }
  return {
    ok: true,
    value: {
      taskType,
      topicId: input.topicId ? String(input.topicId).toLowerCase() : null,
      topicSlug: input.topicSlug ? String(input.topicSlug).trim() : null,
      baseRevisionId: input.baseRevisionId ? String(input.baseRevisionId).toLowerCase() : null,
      reason: String(input.reason || 'manual').replace(/\0/g, '').trim().slice(0, 80) || 'manual',
      sourceLocale,
      targetLocale,
    },
  }
}

export function validateContentSolution(taskType, input = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return { ok: false, error: 'invalid_body' }
  const allowed = new Set(['title', 'body', 'summary', 'overview', 'rationale', 'locale', 'targetLocale', 'parentReplyId', 'sources', 'authorshipMode', 'modelName', 'humanContribution', 'client', 'providerCost'])
  if (Object.keys(input).some(key => !allowed.has(key))) return { ok: false, error: 'unknown_field' }
  const title = clean(input.title)
  const body = clean(input.body)
  const summary = clean(input.summary ?? input.overview)
  const rationale = clean(input.rationale)
  const locale = String(input.locale || input.targetLocale || 'en')
  if (!CONTENT_TASK_LOCALES.includes(locale)) return { ok: false, error: 'invalid_locale' }
  if (['edit_article', 'translate', 'write_article', 'write_discussion', 'fill_page'].includes(taskType)) {
    if (title.length < 8 || title.length > 180 || body.length < 20 || body.length > 40_000) return { ok: false, error: 'invalid_content' }
  }
  if (taskType === 'answer_question' && (body.length < 3 || body.length > 10_000)) return { ok: false, error: 'invalid_answer' }
  if (taskType === 'update_overview' && (!summary || summary.length < 20 || summary.length > 2_000)) return { ok: false, error: 'invalid_overview' }
  if (['edit_article', 'translate', 'update_overview', 'write_article', 'write_discussion', 'fill_page'].includes(taskType)
    && rationale.length > 2_000) return { ok: false, error: 'invalid_rationale' }
  const rawSources = input.sources === undefined ? [] : input.sources
  if (!Array.isArray(rawSources) || rawSources.length > 20) return { ok: false, error: 'invalid_sources' }
  if (taskType === 'write_article' && rawSources.length < 1) return { ok: false, error: 'article_sources_required' }
  const sources = rawSources.map(validateCitation)
  if (sources.some(item => !item.ok)) return { ok: false, error: 'invalid_sources' }
  const model = clean(input.modelName)
  const client = clean(input.client)
  return {
    ok: true,
    value: {
      title, body, summary, rationale, locale,
      parentReplyId: input.parentReplyId ? String(input.parentReplyId).toLowerCase() : null,
      sources: sources.map(item => item.value),
      authorshipMode: clean(input.authorshipMode) || null,
      modelName: model || null,
      client: client || null,
      humanContribution: clean(input.humanContribution) || null,
      providerCost: input.providerCost && typeof input.providerCost === 'object' && !Array.isArray(input.providerCost) ? input.providerCost : null,
    },
  }
}

export async function acceptContentTaskSolution(client, { solutionId, reviewerId = null, automatic = false }) {
  const locked = await client.query(
    `SELECT solution.id, solution.task_id, solution.cycle_no, solution.submitted_by,
            solution.payload, solution.sources, solution.model_name, solution.client_label,
            solution.status AS solution_status, solution.created_at AS submitted_at,
            task.task_type, task.reason, task.status AS task_status, task.topic_id, task.base_revision_id,
            task.source_locale, task.target_locale, task.auto_publish_allowed,
            coalesce(topic.node_id, task.node_id) AS node_id,
            topic.author_id AS topic_author_id, topic.kind, topic.status AS topic_status,
            topic.public_usefulness_score,
            translation.source_revision_id AS translation_source_revision_id,
            current.revision_id AS current_revision_id,
            base.locale AS base_revision_locale,
            base.title AS base_title, base.body_markdown AS base_body, base.summary AS base_summary,
            base.authorship_mode AS base_authorship_mode, base.model_name AS base_model_name,
            base.human_contribution AS base_human_contribution
       FROM content_task_solutions solution
       JOIN content_tasks task ON task.id = solution.task_id
       LEFT JOIN topics topic ON topic.id = task.topic_id
       LEFT JOIN revisions base ON base.id = task.base_revision_id
       LEFT JOIN translation_snapshots translation ON translation.revision_id = task.base_revision_id
       LEFT JOIN topic_current_revisions current
         ON current.topic_id = task.topic_id
         AND current.locale = coalesce(task.target_locale, task.source_locale, base.locale)
      WHERE solution.id = $1
      FOR UPDATE OF solution, task`,
    [solutionId],
  )
  const row = locked.rows[0]
  if (!row) throw createError({ statusCode: 404, statusMessage: 'Task solution not found.' })
  if (!['submitted', 'partially_accepted'].includes(row.solution_status)) throw createError({ statusCode: 409, statusMessage: 'This solution has already been reviewed.' })
  if (automatic && !row.auto_publish_allowed) throw createError({ statusCode: 409, statusMessage: 'Automatic publication is disabled for this task.' })
  if (automatic && row.task_type === 'write_article'
    && ['question_three_answers', 'discussion_three_answers'].includes(row.reason)) {
    // Keep the assessment stable until publication commits: an edit of the
    // source topic can invalidate it while the solution is being reviewed.
    const assessment = await client.query('SELECT public_usefulness_score FROM topics WHERE id = $1 FOR SHARE', [row.topic_id])
    if (!hasPublicUsefulness(assessment.rows[0]?.public_usefulness_score)) {
      throw createError({ statusCode: 409, statusMessage: 'Automatic article publication requires a public usefulness score of at least 50.00.' })
    }
  }

  const payload = row.payload || {}
  let result = { revisionId: null, replyId: null, topicId: null }
  if (row.topic_id && !['write_article', 'write_discussion'].includes(row.task_type)) {
    if (row.task_type === 'answer_question') {
      const inserted = await client.query(
        `INSERT INTO replies (topic_id, parent_reply_id, author_id, locale, body_markdown, client_label)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING id`,
        [row.topic_id, payload.parentReplyId || null, row.submitted_by, row.source_locale || 'en', payload.body, row.client_label || row.model_name || null],
      )
      result.replyId = inserted.rows[0].id
      await attachTaskSources(client, { topicId: row.topic_id, replyId: result.replyId, sources: row.sources })
      await client.query('UPDATE topics SET updated_at = now() WHERE id = $1', [row.topic_id])
    } else {
      const locale = row.target_locale || row.source_locale || row.base_revision_locale || 'en'
      // An overview does not touch the body, so it applies to whatever revision
      // is current; other edits must start from the revision they were made on.
      if (row.current_revision_id && !['translate', 'update_overview'].includes(row.task_type) && row.current_revision_id !== row.base_revision_id) {
        throw createError({ statusCode: 409, statusMessage: 'The page changed since this task was opened. Reopen it from the current revision.' })
      }
      const parentId = row.current_revision_id || row.base_revision_id
      const parent = await client.query(
        `SELECT title, body_markdown, summary, authorship_mode, model_name, human_contribution
           FROM revisions WHERE id = $1 FOR UPDATE`,
        [parentId],
      )
      if (!parent.rows[0]) throw createError({ statusCode: 409, statusMessage: 'The task base revision is unavailable.' })
      const nextTitle = payload.title || parent.rows[0].title
      const nextBody = payload.body || parent.rows[0].body_markdown
      const nextSummary = row.task_type === 'update_overview' ? payload.summary : (payload.summary || parent.rows[0].summary)
      const inheritedAuthorship = inheritArticleAuthorship({
        baseMode: row.base_authorship_mode,
        baseModelName: row.base_model_name,
        baseHumanContribution: row.base_human_contribution,
        payload,
        solutionModelName: row.model_name,
      })
      const inserted = await client.query(
        `INSERT INTO revisions
           (topic_id, parent_revision_id, author_id, locale, title, body_markdown, summary,
            source_revision_id, authorship_mode, model_name, human_contribution)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
         RETURNING id, created_at`,
        [row.topic_id, parentId, row.submitted_by, locale, nextTitle, nextBody, nextSummary,
          row.task_type === 'translate' ? (row.translation_source_revision_id || row.base_revision_id) : null,
          markHumanReviewedAuthorship(inheritedAuthorship.mode, Boolean(reviewerId) && !automatic),
          inheritedAuthorship.modelName, inheritedAuthorship.humanContribution],
      )
      result.revisionId = inserted.rows[0].id
      await recordRevisionDiff(client, {
        revisionId: result.revisionId,
        parentRevisionId: parentId,
        parentTitle: parent.rows[0].title,
        parentBody: parent.rows[0].body_markdown,
        title: nextTitle,
        body: nextBody,
        origin: 'accepted_edit',
        introducedBy: row.submitted_by,
        confirmedBy: reviewerId,
        introducedAt: row.submitted_at,
        confirmedAt: inserted.rows[0].created_at,
      })
      await client.query(
        `INSERT INTO topic_current_revisions (topic_id, locale, revision_id)
         VALUES ($1, $2, $3)
         ON CONFLICT (topic_id, locale) DO UPDATE SET revision_id = EXCLUDED.revision_id`,
        [row.topic_id, locale, result.revisionId],
      )
      await client.query('UPDATE topics SET summary = $2, updated_at = now() WHERE id = $1', [row.topic_id, nextSummary || null])
      await client.query(
        `INSERT INTO citations (topic_id, source_id, revision_id, locator, note)
         SELECT topic_id, source_id, $2, locator, note FROM citations WHERE revision_id = $1`,
        [parentId, result.revisionId],
      )
      await attachTaskSources(client, { topicId: row.topic_id, revisionId: result.revisionId, sources: row.sources })
    }
  } else {
    if (!['write_article', 'write_discussion'].includes(row.task_type)) throw createError({ statusCode: 409, statusMessage: 'This task has no target page.' })
    const checked = validateTopic({ title: payload.title, body: payload.body, kind: row.task_type === 'write_article' ? 'article' : 'discussion', locale: row.source_locale || 'en' })
    if (!checked.ok) throw createError({ statusCode: 409, statusMessage: 'The submitted page content is no longer valid.' })
    const slug = await allocateTopicSlug(client, null)
    const status = await openingTopicStatus(client, 'published')
    const topic = await client.query(
      `INSERT INTO topics (
         node_id, author_id, slug, kind, status, summary, source_topic_id, source_revision_id
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING id, page_number, slug`,
      [row.node_id, row.submitted_by, slug, checked.value.kind, status, payload.summary || null,
        row.topic_id || null, row.topic_id ? row.base_revision_id : null],
    )
    const revision = await client.query(
      `INSERT INTO revisions (topic_id, author_id, locale, title, body_markdown, summary, authorship_mode, model_name, human_contribution)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
      [topic.rows[0].id, row.submitted_by, checked.value.locale, checked.value.title, checked.value.body,
        payload.summary || null, markHumanReviewedAuthorship(payload.authorshipMode || null, Boolean(reviewerId) && !automatic),
        payload.modelName || null, payload.humanContribution || null],
    )
    await client.query('INSERT INTO topic_current_revisions (topic_id, locale, revision_id) VALUES ($1, $2, $3)', [topic.rows[0].id, checked.value.locale, revision.rows[0].id])
    await client.query('INSERT INTO page_read_counts (topic_id) VALUES ($1) ON CONFLICT DO NOTHING', [topic.rows[0].id])
    await attachTaskSources(client, { topicId: topic.rows[0].id, revisionId: revision.rows[0].id, sources: row.sources })
    await ensureContentTasks(client, { topicId: topic.rows[0].id, baseRevisionId: revision.rows[0].id, creatorId: row.submitted_by })
    await recordRevisionDiff(client, {
      revisionId: revision.rows[0].id,
      title: checked.value.title,
      body: checked.value.body,
      origin: 'publication',
      introducedBy: row.submitted_by,
      confirmedBy: reviewerId,
    })
    result.topicId = topic.rows[0].id
    result.revisionId = revision.rows[0].id
  }

  await client.query(
    `UPDATE content_task_solutions
        SET status = 'accepted', reviewed_by = $2, reviewed_at = now(),
            result_revision_id = $3, result_reply_id = $4, result_topic_id = $5
      WHERE id = $1`,
    [solutionId, reviewerId, result.revisionId, result.replyId, result.topicId],
  )
  await client.query(
    `UPDATE content_task_solutions
        SET status = 'rejected', reviewed_by = $4, reviewed_at = now(),
            review_comment = 'Another solution was accepted.'
      WHERE task_id = $1 AND cycle_no = $2 AND id <> $3 AND status = 'submitted'`,
    [row.task_id, row.cycle_no, solutionId, reviewerId],
  )
  await client.query(
    `UPDATE content_tasks
        SET status = 'resolved', claimed_by = NULL, claim_actor_label = NULL,
            claim_expires_at = NULL, updated_at = now()
      WHERE id = $1`,
    [row.task_id],
  )
  await client.query(
    `INSERT INTO content_task_events (task_id, actor_id, event_type, details)
     VALUES ($1, $2, 'solution_accepted', jsonb_build_object('solution_id', $3::text, 'automatic', $4::boolean))`,
    [row.task_id, reviewerId || row.submitted_by, solutionId, automatic],
  )
  if (row.task_type === 'answer_question' && row.topic_id) {
    await ensureContentTasks(client, { topicId: row.topic_id, creatorId: row.submitted_by })
  }
  return { ...result, taskId: row.task_id, solutionId }
}

export async function attachTaskSources(client, { topicId, revisionId = null, replyId = null, sources = [] }) {
  for (const source of Array.isArray(sources) ? sources : []) {
    const inserted = await client.query(
      `INSERT INTO sources (canonical_url, title, publisher, source_type, published_at)
       VALUES ($1, NULLIF($2::text, ''), NULLIF($3::text, ''), 'external', $4::date)
       ON CONFLICT (canonical_url) DO UPDATE SET
         title = coalesce(sources.title, EXCLUDED.title), publisher = coalesce(sources.publisher, EXCLUDED.publisher),
         published_at = coalesce(sources.published_at, EXCLUDED.published_at)
       RETURNING id`,
      [source.url, source.title || '', source.publisher || '', source.publishedAt || null],
    )
    await client.query(
      `INSERT INTO citations (topic_id, source_id, revision_id, reply_id, locator, note)
       VALUES ($1, $2, $3, $4, NULLIF($5::text, ''), NULLIF($6::text, ''))`,
      [topicId, inserted.rows[0].id, revisionId, replyId, source.locator || '', source.note || ''],
    )
  }
}

export function contentTaskSolutionSelectSql() {
  return `SELECT solution.id, solution.task_id, solution.cycle_no, solution.submitted_by,
                 solution.payload, solution.sources, solution.model_name, solution.client_label,
                 solution.provider_cost, solution.status, solution.auto_accept_at,
                 solution.reviewed_by, solution.review_comment, solution.result_revision_id,
                 solution.result_reply_id, solution.result_topic_id, solution.created_at,
                 solution.reviewed_at,
                 submitter.username AS submitter_username,
                 submitter.display_name AS submitter_display_name,
                 submitter.agent_name AS submitter_agent_name
            FROM content_task_solutions solution
            LEFT JOIN actors submitter ON submitter.id = solution.submitted_by`
}

export async function loadContentTask(client, taskId, { includeSolutions = true } = {}) {
  const taskResult = await client.query(`${contentTaskSelectSql()} WHERE task.id = $1 LIMIT 1`, [taskId])
  const row = taskResult.rows[0]
  if (!row) return null
  let solutions = null
  if (includeSolutions) {
    const result = await client.query(`${contentTaskSolutionSelectSql()} WHERE solution.task_id = $1 ORDER BY solution.created_at DESC`, [taskId])
    solutions = result.rows
  }
  return presentContentTask(row, { solutions })
}

export function canManageContentTask(actor, row) {
  return Boolean(actor && row && (STAFF.has(actor.role) || (row.topic_author_id && row.topic_author_id === actor.id)))
}

function clean(value) {
  return String(value ?? '').replace(/\0/g, '').trim()
}
