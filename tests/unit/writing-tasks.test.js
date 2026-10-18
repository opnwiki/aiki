import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { validateOverviewTaskSubmission, validateWritingSubmission } from '../../server/utils/writing-tasks.js'
import { parseNeronTaskCost, parseNeronTaskResponse } from '../../server/utils/article-orders.js'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')

export async function run({ assert }) {
  const goodArticle = {
    kind: 'article', locale: 'en', title: 'A valid title', body: 'A sufficiently detailed, sourced article body.',
    sources: [{ url: 'https://example.org/article', title: 'Evidence', publisher: 'Example' }],
    authorshipMode: 'ai_generated_unreviewed', modelName: 'Neron Agent',
  }
  const article = validateWritingSubmission(goodArticle)
  assert.equal(article.ok, true)
  assert.equal(article.value.authorship.modelName, 'Neron Agent')
  assert.equal(validateWritingSubmission({ ...goodArticle, sources: [] }).ok, false)
  assert.equal(validateWritingSubmission({ ...goodArticle, modelName: '' }).ok, false)
  assert.equal(validateWritingSubmission({ ...goodArticle, locale: 'unknown' }).ok, false)
  assert.equal(validateWritingSubmission({ ...goodArticle, unexpected: true }).ok, false)
  const humanOnly = validateWritingSubmission({
    ...goodArticle,
    authorshipMode: 'human_only',
    modelName: undefined,
    humanContribution: 'Written entirely by a test human.',
  })
  assert.equal(humanOnly.ok, true, 'a human may publish sourced writing tasks')
  const collaboration = validateWritingSubmission({
    ...goodArticle,
    authorshipMode: 'human_ai_collaboration',
    humanContribution: 'A human checked and rewrote the draft.',
  })
  assert.equal(collaboration.ok, true, 'collaborative writing task submissions are supported')
  const reviewedAi = validateWritingSubmission({
    ...goodArticle,
    authorshipMode: 'ai_generated_human_reviewed',
  })
  assert.equal(reviewedAi.ok, true)
  const discussion = validateWritingSubmission({ kind: 'discussion', locale: 'ru', title: 'A focused discussion', body: 'What should the community consider about this question?', sources: [] })
  assert.equal(discussion.ok, true)
  assert.equal(discussion.value.kind, 'discussion')
  assert.equal(validateWritingSubmission({ kind: 'discussion', title: 'A focused discussion', body: 'What should we discuss today?', locale: 'en', sources: [], modelName: 'Forged' }).ok, false)
  const overview = validateOverviewTaskSubmission({ locale: 'ru', overview: 'Краткий обзор статьи с основными тезисами и важным контекстом.', rationale: 'Он помогает быстро понять содержание статьи.' })
  assert.equal(overview.ok, true)
  assert.deepEqual(parseNeronTaskCost({ cost: { amount: 0.04, currency: 'USD' } }), { amount: 0.04, currency: 'USD' })
  assert.deepEqual(parseNeronTaskResponse({ task: { id: 'neron-1', status: 'queued', cost: { amount: 0.01, currency: 'USD' } } }), {
    id: 'neron-1', status: 'queued',
    providerResponse: { task: { id: 'neron-1', status: 'queued', cost: { amount: 0.01, currency: 'USD' } } },
    providerCost: { amount: 0.01, currency: 'USD' },
  })
  assert.equal(validateOverviewTaskSubmission({ locale: 'ru', overview: 'слишком коротко', rationale: 'достаточно' }).ok, false)
  assert.equal(validateOverviewTaskSubmission({ locale: 'ru', overview: 'Краткий обзор статьи с основными тезисами и важным контекстом.', rationale: 'достаточно', extra: true }).ok, false)

  const migration = await readFile(path.join(root, 'database/migrations/012_article_writing_tasks.sql'), 'utf8')
  assert.match(migration, /execution_state IN \('pending', 'starting', 'submitted', 'community', 'draft_ready', 'failed'\)/)
  assert.match(migration, /Existing orders were already queued for manual fulfillment; never hand them to the new executor/)
  assert.match(migration, /ELSE 'community'/)
  assert.match(migration, /INSERT INTO article_writing_tasks \(order_id, status\)\s+SELECT id, 'open' FROM article_order_submissions WHERE execution_state = 'community'/)
  assert.match(migration, /article_writing_submissions.*?BEFORE UPDATE OR DELETE/s)
  assert.match(migration, /article_writing_reviews.*?BEFORE UPDATE OR DELETE/s)
  assert.match(migration, /claim_expires_at IS NOT NULL/)
  const overviewMigration = await readFile(path.join(root, 'database/migrations/046_overview_tasks.sql'), 'utf8')
  assert.match(overviewMigration, /task_type IN \('writing', 'overview'\)/)
  assert.match(overviewMigration, /article_writing_tasks_overview_target_idx/)
  assert.match(overviewMigration, /proposal_type IN \('body', 'overview'\)/)
  assert.match(overviewMigration, /ON CONFLICT \(target_revision_id\) WHERE task_type = 'overview'/)
  const costMigration = await readFile(path.join(root, 'database/migrations/050_neron_task_cost.sql'), 'utf8')
  assert.match(costMigration, /article_order_submissions[\s\S]*provider_cost JSONB/)
  assert.match(costMigration, /writing_task_agent_runs[\s\S]*provider_cost JSONB/)

  const authorshipMigration = await readFile(path.join(root, 'database/migrations/013_writing_authorship_modes.sql'), 'utf8')
  assert.match(authorshipMigration, /pg_get_constraintdef\(oid\) ILIKE '%ai_generated_unreviewed%'/)
  assert.match(authorshipMigration, /'human_only'/)
  assert.match(authorshipMigration, /'human_ai_collaboration'/)
  assert.match(authorshipMigration, /'ai_generated_human_reviewed'/)
  assert.match(authorshipMigration, /'ai_generated_unreviewed'/)
  assert.match(authorshipMigration, /article_writing_submissions_authorship_check/)

  const taskListApi = await readFile(path.join(root, 'server/api/writing-tasks/index.get.js'), 'utf8')
  assert.match(taskListApi, /query\.task === 'string'/)
  assert.match(taskListApi, /requestedTaskId && requestedStatus === 'active'/)
  assert.match(taskListApi, /\$4::uuid IS NULL OR task\.id = \$4/)
  const taskShowApi = await readFile(path.join(root, 'server/api/writing-tasks/[id].get.js'), 'utf8')
  assert.match(taskShowApi, /getRouterParams\(event\)/)
  assert.match(taskShowApi, /\[statuses, requestedTaskId\]/)
  assert.match(taskShowApi, /AND task\.id = \$2::uuid/)
  const taskPage = await readFile(path.join(root, 'app/pages/a/[id].vue'), 'utf8')
  assert.match(taskPage, /api\/writing-tasks\/\$\{encodeURIComponent\(taskId\.value\)\}/)
  assert.match(taskPage, /a\.notFound/)
  const tasksList = await readFile(path.join(root, 'app/pages/tasks.vue'), 'utf8')
  assert.match(tasksList, /a\/\$\{encodeURIComponent\(task\.id\)\}/)
  const claimApi = await readFile(path.join(root, 'server/api/writing-tasks/[id]/claim.post.js'), 'utf8')
  assert.match(claimApi, /claim_expires_at > now\(\) AND claimed_by = \$2/)
  const submitApi = await readFile(path.join(root, 'server/api/writing-tasks/[id]/submissions.post.js'), 'utf8')
  assert.match(submitApi, /claim expired/i)
  assert.match(submitApi, /validateOverviewTaskSubmission/)
  assert.match(submitApi, /proposal_type, proposed_summary, source_task_id/)
  assert.match(submitApi, /JOIN topics topic ON topic\.id = task\.topic_id\r?\n/)
  assert.doesNotMatch(submitApi, /topic\.kind = 'article'/)
  assert.match(submitApi, /overview language must match the page/i)
  assert.match(taskListApi, /task\.task_type/)
  assert.match(taskListApi, /row\.topic_id \? \{/)
  assert.match(taskShowApi, /row\.topic_id \? \{/)
  assert.match(taskShowApi, /providerCost: row\.agent_run_provider_cost/)
  assert.match(tasksList, /overviewLabel/)
  const orderApi = await readFile(path.join(root, 'server/api/article-orders/index.post.js'), 'utf8')
  assert.match(orderApi, /INSERT INTO article_writing_tasks \(order_id, status\)\s+VALUES \(\$1, \$2\)\s+RETURNING id, status/)
  assert.match(orderApi, /freeRun \? 'closed' : 'open'/)
  assert.match(orderApi, /execution_state, status, error_code/)
  assert.match(orderApi, /freeRun \? 'pending' : 'community'/)
  assert.doesNotMatch(orderApi, /rejectStoredOutcome/)
  const executor = await readFile(path.join(root, 'server/utils/article-order-executor.js'), 'utf8')
  assert.match(executor, /status = 'closed'/)
  assert.match(executor, /provider_cost = COALESCE/)
}
