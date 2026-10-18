import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import http from 'node:http'
import pg from 'pg'

const expectedConfirmation = 'I CONFIRM AN AGENT RUN TEST ON A DISPOSABLE AIKI DATABASE'
const baseUrl = process.env.DATABASE_URL || ''
if (!baseUrl || process.env.AIKI_AGENT_RUN_TEST_CONFIRM !== expectedConfirmation) {
  throw new Error(`Refusing writes. Set DATABASE_URL and AIKI_AGENT_RUN_TEST_CONFIRM=${JSON.stringify(expectedConfirmation)} only for a disposable database.`)
}
const dbUrl = new URL(baseUrl)
const databaseName = decodeURIComponent(dbUrl.pathname.slice(1))
if (!['localhost', '127.0.0.1', '::1'].includes(dbUrl.hostname)
    || !/^aiki_(?:login_test|mvp_test)_[a-z0-9_]+$/.test(databaseName)) {
  throw new Error('Agent-run executor integration is restricted to a loopback disposable local AIKI database.')
}

const fixtureKey = 'loopback-fixture-key-not-a-provider-credential'
const suffix = randomBytes(5).toString('hex')
const password = `AIKI-Agent-Test-${randomBytes(20).toString('base64url')}`
const publishQuery = `Loopback publication ${suffix}`
const refundQuery = `REFUND FIXTURE ${suffix}`
const sourceUrl = `https://example.org/loopback-${suffix}`
const appPort = 3014
const appBase = `http://127.0.0.1:${appPort}`
const db = new pg.Client({ connectionString: baseUrl })
const taskIds = []
const actorIds = []
const assessmentIds = []
const topicIds = []
let connected = false
let app
let fake

function articleResult() {
  return {
    kind: 'article',
    title: `Loopback publication ${suffix}`,
    body: 'This disposable article was produced by a loopback fixture and is long enough to publish.',
    locale: 'en',
    sources: [{ url: sourceUrl, title: 'Loopback source', publisher: 'Example' }],
    authorshipMode: 'ai_generated_unreviewed',
    modelName: 'Loopback fixture model',
    humanContribution: null,
  }
}

async function startFake() {
  const tasks = new Map()
  const hosts = []
  const server = http.createServer(async (request, response) => {
    hosts.push(request.headers.host || '')
    if (request.headers.authorization !== `Bearer ${fixtureKey}`) {
      response.writeHead(401, { 'content-type': 'application/json' })
      response.end('{}')
      return
    }
    if (request.method === 'POST' && request.url === '/tasks') {
      const chunks = []
      for await (const chunk of request) chunks.push(chunk)
      const body = JSON.parse(Buffer.concat(chunks).toString() || '{}')
      const id = `fake-${randomBytes(8).toString('hex')}`
      const fail = String(body.prompt || '').includes('REFUND FIXTURE')
      tasks.set(id, { id, fail, cost: { amount: fail ? 0.02 : 0.04, currency: 'USD' } })
      response.writeHead(202, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ task: { id, status: 'queued', cost: { amount: 0.01, currency: 'USD' } } }))
      return
    }
    const match = request.url.match(/^\/tasks\/([^/?]+)$/)
    if (request.method === 'GET' && match) {
      const task = tasks.get(decodeURIComponent(match[1]))
      if (!task) {
        response.writeHead(404, { 'content-type': 'application/json' })
        response.end('{}')
        return
      }
      const payload = task.fail
        ? { task: { id: task.id, status: 'failed', cost: task.cost } }
        : { task: { id: task.id, status: 'completed', cost: task.cost, result: articleResult() } }
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end(JSON.stringify(payload))
      return
    }
    response.writeHead(404, { 'content-type': 'application/json' })
    response.end('{}')
  })
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const { port } = server.address()
  return {
    server,
    hosts,
    base: `http://127.0.0.1:${port}`,
    calls: () => hosts.length,
  }
}

async function startApp() {
  const env = { ...process.env }
  for (const name of ['NERON_API_KEY', 'NERON_API_BASE', 'NUXT_NERON_API_KEY', 'NUXT_NERON_API_BASE', 'NITRO_NERON_API_KEY', 'NITRO_NERON_API_BASE']) delete env[name]
  env.DATABASE_URL = baseUrl
  env.NUXT_DATABASE_URL = baseUrl
  env.NODE_ENV = 'production'
  env.HOST = '127.0.0.1'
  env.PORT = String(appPort)
  env.RATE_LIMIT_SECRET = 'ci-rate-limit-secret-not-for-production'
  env.NUXT_RATE_LIMIT_SECRET = env.RATE_LIMIT_SECRET
  env.READ_HMAC_SECRET = 'ci-read-hmac-secret-not-for-production'
  env.NUXT_READ_HMAC_SECRET = env.READ_HMAC_SECRET
  const child = spawn(process.execPath, ['.output/server/index.mjs'], { env, stdio: ['ignore', 'pipe', 'pipe'] })
  let logs = ''
  child.stdout.on('data', chunk => { logs += chunk })
  child.stderr.on('data', chunk => { logs += chunk })
  const deadline = Date.now() + 20_000
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`App exited before health: ${logs}`)
    try {
      const health = await fetch(`${appBase}/api/health`, { signal: AbortSignal.timeout(1000) })
      if (health.ok) return { child, logs: () => logs }
    } catch { /* still starting */ }
    await new Promise(resolve => setTimeout(resolve, 200))
  }
  child.kill('SIGTERM')
  throw new Error(`App did not become healthy: ${logs}`)
}

async function request(path, { method = 'GET', body, cookie } = {}) {
  const headers = { accept: 'application/json' }
  if (body !== undefined) headers['content-type'] = 'application/json'
  if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) headers.origin = appBase
  if (cookie) headers.cookie = cookie
  const response = await fetch(`${appBase}${path}`, {
    method,
    headers,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    redirect: 'manual',
    signal: AbortSignal.timeout(20_000),
  })
  const text = await response.text()
  let data = null
  try { data = text ? JSON.parse(text) : null } catch { data = text }
  return { response, data }
}

async function register(username) {
  const result = await request('/api/auth/register', { method: 'POST', body: { username, email: `${username}@example.invalid`, password } })
  assert.equal(result.response.status, 201, JSON.stringify(result.data))
  const token = (result.response.headers.get('set-cookie') || '').match(/(?:^|,\s*)aiki_session=([^;,]+)/)?.[1]
  assert.ok(token)
  actorIds.push(result.data.actor.id)
  return { actor: result.data.actor, cookie: `aiki_session=${token}` }
}

async function createTask(actorId, query) {
  const assessment = await db.query(
    `INSERT INTO article_order_assessments
      (actor_id, request_key_hash, client_ip, statica_response, statica_is_clean, query_text, locale, outcome, search_context)
     VALUES ($1, $2, '198.51.100.99', '{"security":{"is_clean":true}}'::jsonb, true, $3, 'en', 'queued', '[]'::jsonb)
     RETURNING id`,
    [actorId, randomBytes(32).toString('hex'), query],
  )
  assessmentIds.push(assessment.rows[0].id)
  const order = await db.query(
    `INSERT INTO article_order_submissions (assessment_id, access_token_hash, execution_state)
     VALUES ($1, $2, 'community') RETURNING id`,
    [assessment.rows[0].id, randomBytes(32).toString('hex')],
  )
  const task = await db.query(
    `INSERT INTO article_writing_tasks (order_id, status, claimed_by, claim_actor_label, claim_expires_at)
     VALUES ($1, 'claimed', $2, 'integration', now() + interval '2 hours') RETURNING id`,
    [order.rows[0].id, actorId],
  )
  taskIds.push(task.rows[0].id)
  return task.rows[0].id
}

async function balance(actorId) {
  const result = await db.query('SELECT coalesce(sum(amount), 0)::text AS balance FROM actor_token_ledger WHERE actor_id = $1', [actorId])
  return result.rows[0].balance
}

async function waitFor(label, read) {
  const deadline = Date.now() + 25_000
  let last
  while (Date.now() < deadline) {
    last = await read()
    if (last) return last
    await new Promise(resolve => setTimeout(resolve, 400))
  }
  throw new Error(`${label} timed out: ${JSON.stringify(last)}`)
}

try {
  fake = await startFake()
  assert.ok(fake.base.startsWith('http://127.0.0.1:'))
  await db.connect()
  connected = true
  await db.query(
    `UPDATE nodes SET agent_provider_config = $1::jsonb WHERE is_home`,
    [JSON.stringify({ mode: 'neron', endpoint: fake.base, apiKey: fixtureKey, format: 'task_json' })],
  )
  app = await startApp()
  const selectedDb = await db.query('SELECT current_database() AS name')
  assert.equal(selectedDb.rows[0].name, databaseName)
  await db.query('TRUNCATE auth_rate_limits')
  const ledger = await db.query("SELECT version FROM schema_migrations WHERE version IN ('015', '016') ORDER BY version")
  assert.deepEqual(ledger.rows.map(row => row.version), ['015', '016'])

  const writer = await register(`agent-exec-${suffix}`)
  await db.query(
    `INSERT INTO actor_token_ledger (actor_id, amount, reason, source_type, source_id, idempotency_key, description)
     VALUES ($1, 2, 'manual_adjustment', 'system', $2, $3, 'Disposable loopback agent run funding')`,
    [writer.actor.id, randomBytes(16), `agent-exec-grant:${suffix}`],
  )
  assert.match(String(writer.actor.public_id), /^\d{14}$/)

  const publishTask = await createTask(writer.actor.id, publishQuery)
  const refused = await request(`/api/writing-tasks/${publishTask}/agent-run`, {
    method: 'POST', cookie: writer.cookie, body: { idempotencyKey: randomBytes(32).toString('hex'), consent: false },
  })
  assert.equal(refused.response.status, 400, JSON.stringify(refused.data))
  const idempotencyKey = randomBytes(32).toString('hex')
  const started = await request(`/api/writing-tasks/${publishTask}/agent-run`, {
    method: 'POST', cookie: writer.cookie, body: { idempotencyKey, consent: true },
  })
  assert.equal(started.response.status, 202, JSON.stringify(started.data))
  assert.equal(started.data.run.status, 'queued')
  const replay = await request(`/api/writing-tasks/${publishTask}/agent-run`, {
    method: 'POST', cookie: writer.cookie, body: { idempotencyKey, consent: true },
  })
  assert.equal(replay.response.status, 200, JSON.stringify(replay.data))
  assert.equal(replay.data.run.id, started.data.run.id)
  assert.equal(await balance(writer.actor.id), '1', 'one explicit launch charges exactly 1 WPG')

  const published = await waitFor('publication', async () => {
    const list = await request('/api/writing-tasks?status=all&limit=50', { cookie: writer.cookie })
    const item = list.data?.items?.find(value => value.id === publishTask)
    return item?.publishedPath ? item : null
  })
  assert.equal(published.agentRun.status, 'completed')
  const publishedRun = await db.query('SELECT provider_cost FROM writing_task_agent_runs WHERE id = $1', [started.data.run.id])
  assert.deepEqual(publishedRun.rows[0].provider_cost, { amount: 0.04, currency: 'USD' })
  assert.equal(published.status, 'accepted')
  const page = await request(`/api/topics/${published.publishedPath.slice(1)}`)
  assert.equal(page.response.status, 200, JSON.stringify(page.data))
  assert.equal(page.data.authorship_mode, 'ai_generated_unreviewed')
  assert.equal(page.data.model_name, 'Loopback fixture model')
  assert.equal(page.data.human_contribution, null)
  assert.equal(page.data.citations.some(citation => citation.canonical_url === sourceUrl), true)
  const topic = await db.query('SELECT id FROM topics WHERE page_number::text = $1 OR lower(slug) = lower($1)', [published.publishedPath.slice(1)])
  topicIds.push(topic.rows[0].id)
  const successLedger = await db.query(
    "SELECT reason, amount::text FROM actor_token_ledger WHERE actor_id = $1 AND reason IN ('agent_run_charge', 'agent_run_refund', 'article_accepted') ORDER BY created_at",
    [writer.actor.id],
  )
  assert.deepEqual(successLedger.rows, [{ reason: 'agent_run_charge', amount: '-1' }], 'publication must not award a second WPG or refund the charge')

  const refundTask = await createTask(writer.actor.id, refundQuery)
  const failedStart = await request(`/api/writing-tasks/${refundTask}/agent-run`, {
    method: 'POST', cookie: writer.cookie, body: { idempotencyKey: randomBytes(32).toString('hex'), consent: true },
  })
  assert.equal(failedStart.response.status, 202, JSON.stringify(failedStart.data))
  assert.equal(await balance(writer.actor.id), '0')
  const failed = await waitFor('refund', async () => {
    const list = await request('/api/writing-tasks?status=all&limit=50', { cookie: writer.cookie })
    const item = list.data?.items?.find(value => value.id === refundTask)
    return item?.agentRun?.status === 'failed' ? item : null
  })
  assert.equal(failed.agentRun.refunded, true)
  const failedRun = await db.query('SELECT provider_cost FROM writing_task_agent_runs WHERE task_id = $1', [refundTask])
  assert.deepEqual(failedRun.rows[0].provider_cost, { amount: 0.02, currency: 'USD' })
  assert.equal(failed.publishedPath, null)
  assert.equal(await balance(writer.actor.id), '1', 'a terminal provider failure refunds the single charge')
  const refundLedger = await db.query(
    "SELECT count(*)::int AS count FROM actor_token_ledger WHERE actor_id = $1 AND reason = 'agent_run_refund'",
    [writer.actor.id],
  )
  assert.equal(refundLedger.rows[0].count, 1)
  assert.ok(fake.calls() >= 4, 'the executor must talk to the loopback fixture for start and poll')
  assert.ok(fake.hosts.every(host => host.startsWith('127.0.0.1:')), `fixture saw a non-loopback host: ${fake.hosts.join(',')}`)

  console.log('PASS loopback agent-run executor: consent, one-WPG idempotent charge, automatic publication, and refund without a provider call')
} finally {
  if (app?.child) app.child.kill('SIGTERM')
  if (fake?.server) await new Promise(resolve => fake.server.close(resolve))
  if (connected) {
    for (const taskId of taskIds) {
      await db.query('DELETE FROM writing_task_agent_runs WHERE task_id = $1', [taskId]).catch(() => {})
      await db.query('DELETE FROM article_writing_submissions WHERE task_id = $1', [taskId]).catch(() => {})
      await db.query('DELETE FROM article_writing_tasks WHERE id = $1', [taskId]).catch(() => {})
    }
    for (const topicId of topicIds) {
      await db.query('UPDATE article_order_submissions SET result_topic_id = NULL WHERE result_topic_id = $1', [topicId]).catch(() => {})
      await db.query('DELETE FROM topics WHERE id = $1', [topicId]).catch(() => {})
    }
    for (const assessmentId of assessmentIds) {
      await db.query('DELETE FROM article_order_submissions WHERE assessment_id = $1', [assessmentId]).catch(() => {})
      await db.query('DELETE FROM article_order_assessments WHERE id = $1', [assessmentId]).catch(() => {})
    }
    await db.end().catch(() => {})
  }
}
