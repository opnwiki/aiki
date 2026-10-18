import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { automaticAcceptanceFailureComment } from '../../server/utils/content-task-executor.js'
import { inheritArticleAuthorship, OVERVIEW_REPLY_REFRESH_THRESHOLD, replyTaskReason, shouldCreateQuestionArticleTask, sourceArticleTaskReason } from '../../server/utils/content-tasks.js'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')

export async function run({ assert }) {
  assert.deepEqual(inheritArticleAuthorship({
    baseMode: 'human_only',
    baseHumanContribution: 'Written by a human.',
    solutionModelName: 'Codex (GPT-5.6 Luna)',
  }), {
    mode: 'human_only', modelName: null, humanContribution: 'Written by a human.',
  })
  assert.deepEqual(inheritArticleAuthorship({
    baseMode: 'ai_generated_unreviewed',
    baseModelName: 'Existing model',
    solutionModelName: 'Other model',
  }), {
    mode: 'ai_generated_unreviewed', modelName: 'Existing model', humanContribution: null,
  })
  assert.equal(shouldCreateQuestionArticleTask({ kind: 'question', replyCount: 2, publicUsefulnessScore: 80 }), false)
  assert.equal(shouldCreateQuestionArticleTask({ kind: 'question', replyCount: 3, publicUsefulnessScore: 50 }), true)
  assert.equal(shouldCreateQuestionArticleTask({ kind: 'discussion', replyCount: 3, publicUsefulnessScore: '75.20' }), true)
  assert.equal(shouldCreateQuestionArticleTask({ kind: 'question', replyCount: 7, publicUsefulnessScore: 80, sourceRevisionId: 'translation-revision' }), false)
  assert.equal(shouldCreateQuestionArticleTask({ kind: 'article', replyCount: 3, publicUsefulnessScore: 80 }), false)
  for (const score of [null, undefined, 0, 15.5, 49.99, '', 'bad', 100.01, Infinity]) {
    assert.equal(shouldCreateQuestionArticleTask({ kind: 'discussion', replyCount: 100, publicUsefulnessScore: score }), false)
  }
  assert.equal(sourceArticleTaskReason('question'), 'question_three_answers')
  assert.equal(sourceArticleTaskReason('discussion'), 'discussion_three_answers')
  assert.equal(replyTaskReason('question'), 'no_answer')
  assert.equal(replyTaskReason('discussion'), 'no_reply')
  assert.equal(OVERVIEW_REPLY_REFRESH_THRESHOLD, 3)
  assert.equal(
    automaticAcceptanceFailureComment(new Error('  database   constraint failed  ')),
    'Automatic acceptance paused: database constraint failed',
  )
  const source = await readFile(path.join(root, 'server/utils/content-tasks.js'), 'utf8')
  assert.match(source, /base\.authorship_mode AS base_authorship_mode/)
  assert.match(source, /inheritArticleAuthorship\(/)
  assert.match(source, /\['article', 'question', 'discussion'\]\.includes\(topic\.kind\) && !summary/)
  assert.match(source, /reply_count_since_overview/)
  assert.match(source, /reason: 'new_replies'/)
  assert.match(source, /taskType: 'fill_page'/)
  assert.match(source, /\['question', 'discussion'\]\.includes\(topic\.kind\)/)
  const taskCreateApi = await readFile(path.join(root, 'server/api/tasks/index.post.js'), 'utf8')
  assert.doesNotMatch(taskCreateApi, /update_overview tasks require an article page/)
  assert.doesNotMatch(taskCreateApi, /answer_question tasks require a question page/)
  assert.match(taskCreateApi, /\['question', 'discussion'\]\.includes\(topic\.kind\)/)
  const executorSource = await readFile(path.join(root, 'server/utils/content-task-executor.js'), 'utf8')
  const mcpSource = await readFile(path.join(root, 'server/routes/mcp.post.js'), 'utf8')
  assert.doesNotMatch(mcpSource, /update_overview tasks require an article page/)
  assert.doesNotMatch(mcpSource, /answer_question tasks require a question page/)
  assert.match(mcpSource, /JOIN topics topic ON topic\.id = task\.topic_id\r?\n/)
  assert.match(executorSource, /auto_accept_at = NULL/)
  assert.match(executorSource, /automatic_acceptance_failed/)
  assert.match(mcpSource, /await ensureContentTasks\(client, \{ topicId, creatorId: actor\.id \}\)/)
  const backfillMigration = await readFile(path.join(root, 'database/migrations/075_question_article_tasks.sql'), 'utf8')
  assert.match(backfillMigration, /question_three_answers/)
  assert.match(backfillMigration, /ON CONFLICT DO NOTHING/)
  assert.match(backfillMigration, /backfill.*true/i)
  const sourceChainMigration = await readFile(path.join(root, 'database/migrations/076_topic_source_chain.sql'), 'utf8')
  assert.match(sourceChainMigration, /source_topic_id UUID/)
  assert.match(sourceChainMigration, /discussion_three_answers/)
  assert.match(sourceChainMigration, /result_topic_id = derived\.id/)
  const overviewKindsMigration = await readFile(path.join(root, 'database/migrations/078_overview_tasks_for_all_page_kinds.sql'), 'utf8')
  assert.match(overviewKindsMigration, /topic\.kind IN \('article', 'question', 'discussion'\)/)
  assert.match(overviewKindsMigration, /ON CONFLICT DO NOTHING/)
  const staleOverviewMigration = await readFile(path.join(root, 'database/migrations/079_stale_overview_tasks.sql'), 'utf8')
  assert.match(staleOverviewMigration, /'new_replies'/)
  assert.match(staleOverviewMigration, /new_reply_count >= 3/)
  assert.match(staleOverviewMigration, /automatic.*true/)
  const discussionReplyMigration = await readFile(path.join(root, 'database/migrations/080_no_reply_tasks_for_discussions.sql'), 'utf8')
  assert.match(discussionReplyMigration, /topic\.kind IN \('question', 'discussion'\)/)
  assert.match(discussionReplyMigration, /CASE WHEN topic\.kind = 'discussion' THEN 'no_reply' ELSE 'no_answer' END/)
  assert.match(source, /source_topic_id, source_revision_id/)
  const fillPageMigration = await readFile(path.join(root, 'database/migrations/081_fill_page_tasks.sql'), 'utf8')
  assert.match(fillPageMigration, /'fill_page'/)
  assert.match(fillPageMigration, /topic\.kind = 'page'/)
}
