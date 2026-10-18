import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import pg from 'pg'

const expectedConfirmation = 'I CONFIRM AN AGENT RUN TEST ON A DISPOSABLE AIKI DATABASE'
const base = (process.env.AIKI_TEST_BASE_URL || '').replace(/\/$/, '')
const databaseUrl = process.env.DATABASE_URL || ''
if (!base || !databaseUrl || process.env.AIKI_AGENT_RUN_TEST_CONFIRM !== expectedConfirmation) {
  throw new Error(`Refusing writes. Set AIIKI_TEST_BASE_URL, DATABASE_URL, and AIKI_AGENT_RUN_TEST_CONFIRM=${JSON.stringify(expectedConfirmation)} only for a disposable database.`)
}
const app = new URL(base)
const dbUrl = new URL(databaseUrl)
const databaseName = decodeURIComponent(dbUrl.pathname.slice(1))
if (app.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(app.hostname)
    || !['localhost', '127.0.0.1', '::1'].includes(dbUrl.hostname)
    || !/^aiki_(?:login_test|mvp_test)_[a-z0-9_]+$/.test(databaseName)) {
  throw new Error('Agent-run integration is restricted to a loopback candidate and disposable local AIKI database.')
}
const db = new pg.Client({ connectionString: databaseUrl })
const suffix = randomBytes(5).toString('hex')
const password = `AIKI-Agent-Test-${randomBytes(20).toString('base64url')}`
const taskIds = []
const actorIds = []
const assessmentIds = []
let connected = false

async function request(path, { method = 'GET', body, cookie, headers = {} } = {}) {
  const requestHeaders = { accept: 'application/json', ...headers }
  if (body !== undefined) requestHeaders['content-type'] = 'application/json'
  if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) requestHeaders.origin = app.origin
  if (cookie) requestHeaders.cookie = cookie
  const response = await fetch(`${base}${path}`, {
    method, headers: requestHeaders,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    redirect: 'manual', signal: AbortSignal.timeout(20_000),
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

try {
  await db.connect()
  connected = true
  const selectedDb = await db.query('SELECT current_database() AS name')
  assert.equal(selectedDb.rows[0].name, databaseName)
  const migrationLedger = await db.query("SELECT version FROM schema_migrations WHERE version IN ('015', '016') ORDER BY version")
  assert.deepEqual(migrationLedger.rows.map(row => row.version), ['015', '016'], 'both feature migrations must be applied only on the disposable candidate')
  const idNamespace = await db.query('SELECT public_id FROM actors ORDER BY created_at LIMIT 1')
  assert.match(String(idNamespace.rows[0]?.public_id), /^\d{14}$/, 'public IDs use a 14-digit display format with node-local uniqueness')
  const health = await request('/api/health')
  assert.equal(health.response.status, 200)
  assert.equal(health.data.database, 'ok')

  const writer = await register(`agent-writer-${suffix}`)
  const funded = await db.query(
    `INSERT INTO actor_token_ledger (actor_id, amount, reason, source_type, source_id, idempotency_key, description)
     VALUES ($1, 2, 'manual_adjustment', 'system', $2, $3, 'Disposable agent run test funding') RETURNING id`,
    [writer.actor.id, randomBytes(16).toString('hex'), `agent-test-grant:${suffix}`],
  )
  const originalId = writer.actor.public_id || writer.actor.publicId
  const own = await request('/api/account', { cookie: writer.cookie })
  assert.equal(own.response.status, 200)
  assert.equal(String(own.data.account.publicId), String(originalId))
  assert.match(String(originalId), /^\d{14}$/)
  assert.equal(own.data.account.tokenAccount.balance, 2)

  const firstTask = await createTask(writer.actor.id, `AIKI federation ID research ${suffix}`)
  const publicSearch = await request(`/api/topics?q=${encodeURIComponent(`AIKI federation ID research ${suffix}`)}&limit=10`)
  assert.equal(publicSearch.response.status, 200, JSON.stringify(publicSearch.data))
  const searchHit = publicSearch.data.items.find(item => item.result_type === 'task' && item.id === firstTask)
  assert.ok(searchHit, 'public search should include an unpublished but open writing task')
  assert.equal(searchHit.task_status, 'claimed')

  const idempotencyKey = randomBytes(32).toString('hex')
  const runResult = await request(`/api/writing-tasks/${firstTask}/agent-run`, {
    method: 'POST', cookie: writer.cookie, body: { idempotencyKey, consent: true },
  })
  assert.equal(runResult.response.status, 202, JSON.stringify(runResult.data))
  assert.equal(runResult.data.run.status, 'queued')
  const repeat = await request(`/api/writing-tasks/${firstTask}/agent-run`, {
    method: 'POST', cookie: writer.cookie, body: { idempotencyKey, consent: true },
  })
  assert.equal(repeat.response.status, 200, JSON.stringify(repeat.data))
  assert.equal(repeat.data.run.id, runResult.data.run.id)

  const balance = await db.query('SELECT sum(amount)::text AS balance FROM actor_token_ledger WHERE actor_id = $1', [writer.actor.id])
  assert.equal(balance.rows[0].balance, '1', 'idempotent replay must charge exactly one WPG')
  const charged = await db.query("SELECT count(*)::int AS count FROM actor_token_ledger WHERE source_id = $1 AND reason = 'agent_run_charge'", [runResult.data.run.id])
  assert.equal(charged.rows[0].count, 1)

  const taskRead = await request('/api/writing-tasks?status=all&limit=50', { cookie: writer.cookie })
  const item = taskRead.data.items.find(value => value.id === firstTask)
  assert.equal(item.agentRun.status, 'queued')
  assert.equal(item.automationRunning, true)
  assert.equal(item.publishedResult, null, 'unfinished task content remains private')

  const secondTask = await createTask(writer.actor.id, `AIKI no balance refusal ${suffix}`)
  const other = await register(`agent-writer2-${suffix}`)
  const noBalance = await request(`/api/writing-tasks/${secondTask}/agent-run`, {
    method: 'POST', cookie: other.cookie, body: { idempotencyKey: randomBytes(32).toString('hex'), consent: true },
  })
  assert.equal(noBalance.response.status, 409, 'a different user cannot run a task claimed by someone else')

  console.log('PASS disposable agent-run integration: stable federated public ID, task search, one-WPG atomic/idempotent charge, queued state, active-run lease and ownership checks')
} finally {
  if (connected) {
    for (const taskId of taskIds) {
      await db.query('DELETE FROM actor_audit_log WHERE target_id = $1', [taskId]).catch(() => {})
      await db.query('DELETE FROM writing_task_agent_runs WHERE task_id = $1', [taskId]).catch(() => {})
      await db.query('DELETE FROM article_writing_tasks WHERE id = $1', [taskId]).catch(() => {})
    }
    for (const actorId of actorIds) {
      await db.query('DELETE FROM actor_audit_log WHERE actor_id = $1 OR target_id = $1::text', [actorId]).catch(() => {})
      await db.query('DELETE FROM human_sessions WHERE actor_id = $1', [actorId]).catch(() => {})
      await db.query('DELETE FROM actor_token_ledger WHERE actor_id = $1', [actorId]).catch(() => {})
    }
    for (const assessmentId of assessmentIds) {
      await db.query('DELETE FROM article_order_submissions WHERE assessment_id = $1', [assessmentId]).catch(() => {})
      await db.query('DELETE FROM article_order_assessments WHERE id = $1', [assessmentId]).catch(() => {})
    }
    await db.query("DELETE FROM actor_token_ledger WHERE idempotency_key = $1", [`agent-test-grant:${suffix}`]).catch(() => {})
    await db.query("DELETE FROM actor_token_ledger WHERE source_id IN (SELECT id FROM writing_task_agent_runs WHERE idempotency_key LIKE $1)", [`%${suffix}%`]).catch(() => {})
    await db.end().catch(() => {})
  }
}
