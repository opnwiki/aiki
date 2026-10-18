import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import pg from 'pg'
import { classifyTopicPage } from '../../server/utils/topic-ai-publisher.js'
import { acceptContentTaskSolution } from '../../server/utils/content-tasks.js'

const base = String(process.env.AIKI_TEST_BASE_URL || '').replace(/\/$/, '')
const databaseUrl = new URL(process.env.DATABASE_URL || 'http://invalid')
const origin = new URL(base)
assert.ok(origin.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(origin.hostname), 'Use an isolated loopback server.')
assert.ok(['localhost', '127.0.0.1'].includes(databaseUrl.hostname) && /^\/aiki_mvp_test_[a-z0-9_]+$/.test(databaseUrl.pathname), 'Use a disposable aiki_mvp_test_* database.')
const db = new pg.Client({ connectionString: databaseUrl.toString() })
const suffix = randomBytes(5).toString('hex')
const topics = []
let cookie
let actorId

async function request(path, { method = 'GET', body } = {}) {
  const headers = { accept: 'application/json', ...(cookie ? { cookie } : {}) }
  if (body !== undefined) Object.assign(headers, { 'content-type': 'application/json', origin: origin.origin })
  const response = await fetch(`${base}${path}`, {
    method, headers, body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(20_000),
  })
  const text = await response.text()
  let data
  try { data = JSON.parse(text) } catch { data = text }
  assert.ok(response.ok, `${method} ${path}: ${response.status} ${JSON.stringify(data)}`)
  return { response, data }
}

async function createTopic(label) {
  const { data } = await request('/api/topics', { method: 'POST', body: {
    kind: 'discussion', locale: 'en', title: `${label} ${suffix}`,
    body: 'A focused conversation with enough context to discuss the central topic and provide useful answers.',
    overview: 'A concise overview of the conversation and its context.',
  } })
  const topic = data.topic || data
  assert.ok(topic.id && topic.slug, JSON.stringify(data))
  topics.push(topic.id)
  return topic
}

async function assess(topic, score) {
  const found = await db.query(`SELECT request.* FROM topic_ai_requests request
    JOIN topic_current_revisions current ON current.revision_id = request.base_revision_id
    WHERE request.topic_id = $1 AND request.request_type = 'classify_page'
    ORDER BY request.created_at DESC LIMIT 1`, [topic.id])
  assert.ok(found.rows[0], 'typed pages must queue the fast classifier')
  assert.match(found.rows[0].prompt, /publicUsefulnessScore/)
  const result = { kind: 'discussion', locale: 'en', publish: true, tags: [], publicUsefulnessScore: score, publicUsefulnessReason: 'An isolated test assessment.' }
  await db.query('BEGIN')
  try {
    await classifyTopicPage(db, { request: found.rows[0], result, model: 'Isolated test classifier' })
    await db.query("UPDATE topic_ai_requests SET status = 'completed', result = $2::jsonb WHERE id = $1", [found.rows[0].id, JSON.stringify(result)])
    await db.query('COMMIT')
  } catch (error) { await db.query('ROLLBACK'); throw error }
}

async function reply(topic, index) {
  await request(`/api/topics/${topic.slug}/replies`, { method: 'POST', body: {
    locale: 'en', body: `Answer ${index}: distinct evidence and useful context for this isolated conversation.`,
  } })
}

async function articleTasks(topic) {
  return (await db.query("SELECT * FROM content_tasks WHERE topic_id = $1 AND task_type = 'write_article'", [topic.id])).rows
}

await db.connect()
try {
  const registered = await request('/api/auth/register', { method: 'POST', body: {
    username: `useful-${suffix}`, password: `Isolated-${randomBytes(24).toString('base64url')}`,
  } })
  actorId = registered.data.actor.id
  const token = (registered.response.headers.get('set-cookie') || '').match(/(?:^|,\s*)aiki_session=([^;,]+)/)?.[1]
  assert.ok(token)
  cookie = `aiki_session=${token}`

  const publicTopic = await createTopic('Reusable public knowledge')
  await assess(publicTopic, 80.25)
  await reply(publicTopic, 1)
  await reply(publicTopic, 2)
  assert.equal((await articleTasks(publicTopic)).length, 0, 'two replies are insufficient')
  await reply(publicTopic, 3)
  const publicTasks = await articleTasks(publicTopic)
  assert.equal(publicTasks.length, 1, 'third public-topic reply creates one article task')
  const page = await request(`/api/topics/${publicTopic.slug}?locale=en&skipRead=true`)
  assert.equal(page.data.publicUsefulnessScore, 80.25)
  const html = await fetch(`${base}/${publicTopic.page_number || publicTopic.slug}`, { signal: AbortSignal.timeout(20_000) }).then(response => response.text())
  assert.match(html, /topic-public-usefulness/)
  assert.match(html, /80\.25/)

  const personal = await createTopic('My private preferences')
  await assess(personal, 12.34)
  for (let index = 1; index <= 3; index++) await reply(personal, index)
  assert.equal((await articleTasks(personal)).length, 0, 'a personal topic never creates an automatic article task')
  assert.equal((await request(`/api/topics/${personal.slug}?locale=en&skipRead=true`)).data.publicUsefulnessScore, 12.34)

  const unassessed = await createTopic('Awaiting public topic assessment')
  for (let index = 1; index <= 3; index++) await reply(unassessed, index)
  assert.equal((await articleTasks(unassessed)).length, 0, 'unknown usefulness does not authorize an article')
  await assess(unassessed, 50)
  assert.equal((await articleTasks(unassessed)).length, 1, 'delayed assessment creates a task at the exact 50.00 boundary')
  await assert.rejects(() => db.query('UPDATE topics SET public_usefulness_score = 100.01 WHERE id = $1', [personal.id]), error => error.code === '23514')

  // A queued solution cannot bypass the live assessment of its source topic.
  await db.query('UPDATE topics SET public_usefulness_score = 49.99 WHERE id = $1', [publicTopic.id])
  const solution = await db.query(`INSERT INTO content_task_solutions (task_id, cycle_no, submitted_by, payload)
    VALUES ($1, 1, $2, '{}'::jsonb) RETURNING id`, [publicTasks[0].id, actorId])
  await db.query('BEGIN')
  await assert.rejects(() => acceptContentTaskSolution(db, { solutionId: solution.rows[0].id, automatic: true }), /public usefulness score of at least 50.00/)
  await db.query('ROLLBACK')

  // Updating only the overview preserves the score; changing the body resets it.
  const current = (await db.query(`SELECT revision.* FROM revisions revision JOIN topic_current_revisions current
    ON current.revision_id = revision.id WHERE current.topic_id = $1 AND current.locale = 'en'`, [personal.id])).rows[0]
  const summaryRevision = (await db.query(`INSERT INTO revisions (topic_id, parent_revision_id, author_id, locale, title, body_markdown, summary)
    VALUES ($1, $2, $3, 'en', $4, $5, 'Updated overview only.') RETURNING id`, [personal.id, current.id, actorId, current.title, current.body_markdown])).rows[0]
  await db.query("UPDATE topic_current_revisions SET revision_id = $2 WHERE topic_id = $1 AND locale = 'en'", [personal.id, summaryRevision.id])
  assert.equal((await db.query('SELECT public_usefulness_score FROM topics WHERE id = $1', [personal.id])).rows[0].public_usefulness_score, '12.34')
  const bodyRevision = (await db.query(`INSERT INTO revisions (topic_id, parent_revision_id, author_id, locale, title, body_markdown)
    VALUES ($1, $2, $3, 'en', $4, 'A substantially different topic with a new body.') RETURNING id`, [personal.id, summaryRevision.id, actorId, current.title])).rows[0]
  await db.query("UPDATE topic_current_revisions SET revision_id = $2 WHERE topic_id = $1 AND locale = 'en'", [personal.id, bodyRevision.id])
  assert.equal((await db.query('SELECT public_usefulness_score FROM topics WHERE id = $1', [personal.id])).rows[0].public_usefulness_score, null)
  console.log('PASS public usefulness: typed-page classification, score API/HTML, three replies, personal topics, delayed assessment, database bounds, automatic acceptance guard, and score invalidation.')
} finally {
  await db.query('ROLLBACK')
  for (const topicId of topics) {
    await db.query("UPDATE topics SET status = 'deleted' WHERE id = $1", [topicId])
    await db.query("UPDATE content_tasks SET status = 'resolved', claimed_by = NULL, claim_expires_at = NULL, auto_publish_allowed = false WHERE topic_id = $1", [topicId])
  }
  await db.end()
}
