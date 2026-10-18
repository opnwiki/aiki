import { acceptContentTaskSolution, ensureContentTasks } from '../../server/utils/content-tasks.js'
import { classifyTopicPage } from '../../server/utils/topic-ai-publisher.js'

// Exercise classification and task creation together, including delayed
// classification after the third answer and preservation of explicit access.
function fixture({ kind = 'discussion', status = 'published', replies = 3, score = null } = {}) {
  const topic = {
    id: 'topic', node_id: 'node', author_id: 'author', kind, status,
    revision_id: 'revision', locale: 'ru', title: 'Обсуждение',
    body_markdown: 'Содержательный текст обсуждения.', summary: 'Обзор обсуждения.',
    public_usefulness_score: score, reply_count: replies, reply_count_since_overview: 0,
    source_revision_id: null,
  }
  const tasks = new Map()
  const assessments = []
  const client = {
    async query(sql, params = []) {
      if (sql.includes('UPDATE topics SET kind')) {
        topic.kind = params[1]
        topic.public_usefulness_score = params[2]
        topic.public_usefulness_reason = params[3]
      } else if (sql.includes("UPDATE topics SET status = 'published'")) {
        topic.status = 'published'
      } else if (sql.includes('SELECT t.id') && sql.includes('FROM topics t')) {
        return { rows: [{ ...topic }] }
      } else if (sql.includes('SELECT 1 FROM topic_tags')) {
        return { rows: [{ exists: true }] }
      } else if (sql.includes('INSERT INTO topic_ai_requests')) {
        assessments.push(params)
      } else if (sql.includes('INSERT INTO content_tasks')) {
        const key = JSON.stringify(params)
        if (tasks.has(key)) return { rows: [] }
        const task = { id: `task-${tasks.size}`, task_type: params[4], reason: params[5], status: 'open' }
        tasks.set(key, task)
        return { rows: [task] }
      } else if (sql.includes('FROM content_tasks')) {
        return { rows: [...tasks.values()].filter(task => task.task_type === params[2] && task.reason === params[3]) }
      }
      return { rows: [] }
    },
  }
  return { topic, client, tasks, assessments }
}

async function classify(state, score, overrides = {}) {
  return classifyTopicPage(state.client, {
    request: { id: 'request', topic_id: state.topic.id, base_revision_id: state.topic.revision_id, requester_id: 'author' },
    result: { kind: 'question', locale: 'en', publish: true, publicUsefulnessScore: score, publicUsefulnessReason: 'Оценка общественной полезности.', ...overrides },
    model: 'Fast model',
  })
}

export async function run({ assert }) {
  const publicTopic = fixture({ replies: 2, status: 'unlisted' })
  const classification = await classify(publicTopic, 75.25)
  assert.equal(classification.publicUsefulnessScore, 75.25)
  assert.equal(publicTopic.topic.public_usefulness_score, 75.25)
  assert.equal(classification.kind, 'discussion', 'assessment preserves an explicitly chosen type')
  assert.equal(classification.locale, 'ru', 'assessment preserves the language of a typed page')
  assert.equal(classification.access, 'link', 'a useful private-by-link topic keeps its access setting')
  assert.equal(publicTopic.tasks.size, 0, 'two answers are not enough')
  publicTopic.topic.reply_count = 3
  await ensureContentTasks(publicTopic.client, { topicId: 'topic' })
  await ensureContentTasks(publicTopic.client, { topicId: 'topic' })
  assert.equal(publicTopic.tasks.size, 1, 'repeated checks reuse the article task')
  assert.equal([...publicTopic.tasks.values()][0].task_type, 'write_article')
  assert.equal([...publicTopic.tasks.values()][0].reason, 'discussion_three_answers')

  const personal = fixture({ replies: 100 })
  await classify(personal, 12.34)
  assert.equal(personal.topic.status, 'published', 'personal topics can remain publicly readable')
  assert.equal(personal.tasks.size, 0, 'even a popular personal topic does not produce an article task')

  const pending = fixture()
  await ensureContentTasks(pending.client, { topicId: 'topic' })
  assert.equal(pending.assessments.length, 1, 'an older, unassessed conversation queues the fast model')
  assert.equal(pending.tasks.size, 0, 'three answers without an assessment do not authorize a task')
  await classify(pending, 50)
  assert.equal(pending.tasks.size, 1, 'classification arriving after the third answer creates the task')

  const shell = fixture({ kind: 'page', status: 'unlisted' })
  const assigned = await classify(shell, 80, { locale: 'ru' })
  assert.equal(assigned.kind, 'question')
  assert.equal(assigned.access, 'public')
  assert.equal(shell.tasks.size, 1, 'a newly classified public question with three answers gets an article task')

  for (const publicUsefulnessScore of [null, 49.99]) {
    await assert.rejects(() => acceptContentTaskSolution({
      query: async () => ({ rows: [{
        solution_status: 'submitted', auto_publish_allowed: true,
        task_type: 'write_article', reason: 'discussion_three_answers',
        public_usefulness_score: publicUsefulnessScore,
      }] }),
    }, { solutionId: 'legacy-solution', automatic: true }), /public usefulness score of at least 50.00/)
  }
}
