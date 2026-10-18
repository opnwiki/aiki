import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import pg from 'pg'

const expectedConfirmation = 'I CONFIRM AN ACCOUNT WALLET TEST ON A DISPOSABLE AIKI DATABASE'
const base = (process.env.AIKI_TEST_BASE_URL || '').replace(/\/$/, '')
const databaseUrl = process.env.DATABASE_URL || ''
if (!base || !databaseUrl || process.env.AIKI_WALLET_TEST_CONFIRM !== expectedConfirmation) {
  throw new Error(`Refusing writes. Set AIKI_TEST_BASE_URL, DATABASE_URL, and AIIKI_WALLET_TEST_CONFIRM=${JSON.stringify(expectedConfirmation)} only for a disposable database.`)
}
const app = new URL(base)
if (app.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(app.hostname)) {
  throw new Error('Account wallet integration is restricted to HTTP loopback candidates.')
}
const dbUrl = new URL(databaseUrl)
const databaseName = decodeURIComponent(dbUrl.pathname.slice(1))
if (!['localhost', '127.0.0.1', '::1'].includes(dbUrl.hostname) || !/^aiki_(?:login_test|mvp_test)_[a-z0-9_]+$/.test(databaseName)) {
  throw new Error('Refusing writes: use a dedicated local disposable AIKI test database.')
}
const db = new pg.Client({ connectionString: databaseUrl })
const suffix = randomBytes(6).toString('hex')
const password = `AIKI-Wallet-Test-${randomBytes(20).toString('base64url')}`
let connected = false
const actorIds = []
const taskId = '123e4567-e89b-42d3-a456-426614174105'

async function request(path, { method = 'GET', body, cookie, headers = {} } = {}) {
  const requestHeaders = { accept: 'application/json', ...headers }
  if (body !== undefined) requestHeaders['content-type'] = 'application/json'
  if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) requestHeaders.origin = app.origin
  if (cookie) requestHeaders.cookie = cookie
  const response = await fetch(`${base}${path}`, {
    method,
    headers: requestHeaders,
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
  const cookieToken = (result.response.headers.get('set-cookie') || '').match(/(?:^|,\s*)aiki_session=([^;,]+)/)?.[1]
  assert.ok(cookieToken)
  actorIds.push(result.data.actor.id)
  return { actor: result.data.actor, cookie: `aiki_session=${cookieToken}` }
}

try {
  await db.connect()
  connected = true
  const current = await db.query('SELECT current_database() AS name')
  assert.equal(current.rows[0].name, databaseName)
  const ledger = await db.query('SELECT count(*)::int AS count FROM schema_migrations WHERE version = $1', ['014'])
  assert.equal(ledger.rows[0].count, 1, 'WPG ledger migration must be applied in the dedicated DB')
  const health = await request('/api/health')
  assert.equal(health.response.status, 200)
  assert.equal(health.data.database, 'ok')

  const writer = await register(`wallet-writer-${suffix}`)
  const reviewer = await register(`wallet-reviewer-${suffix}`)
  await db.query("UPDATE actors SET role = 'moderator' WHERE id = $1", [reviewer.actor.id])

  const anonymous = await request('/api/account')
  assert.equal(anonymous.response.status, 401, 'account wallet must require authentication')
  const own = await request('/api/account', { cookie: writer.cookie })
  assert.equal(own.response.status, 200, JSON.stringify(own.data))
  assert.equal(own.data.account.id, writer.actor.id)
  assert.equal(own.data.account.publicId, writer.actor.public_id)
  assert.match(String(own.data.account.publicId), /^\d{14}$/)
  assert.equal(own.data.account.tokenAccount.ticker, 'WPG')
  assert.equal(own.data.account.tokenAccount.balance, 0, 'new account must not get an unbacked starter grant')
  assert.equal(own.data.account.tokenAccount.redemptionEnabled, false)
  assert.deepEqual(own.data.account.tokenAccount.history, [])
  const otherActor = await request(`/api/account?actorId=${reviewer.actor.id}`, { cookie: writer.cookie })
  assert.equal(otherActor.response.status, 200)
  assert.equal(otherActor.data.account.id, writer.actor.id, 'a query parameter must never switch the account whose balance is returned')

  await db.query(
    `INSERT INTO article_order_assessments
      (request_key_hash, client_ip, statica_response, statica_is_clean, query_text, locale, outcome)
     VALUES ($1, '198.51.100.98', '{"security":{"is_clean":true}}'::jsonb, true, $2, 'en', 'queued')`,
    [randomBytes(32).toString('hex'), `WPG accepted article fixture ${suffix}`],
  )
  const assessment = await db.query('SELECT id FROM article_order_assessments WHERE query_text = $1', [`WPG accepted article fixture ${suffix}`])
  const order = await db.query('INSERT INTO article_order_submissions (assessment_id, access_token_hash) VALUES ($1, $2) RETURNING id', [assessment.rows[0].id, randomBytes(32).toString('hex')])
  await db.query("INSERT INTO article_writing_tasks (id, order_id, status) VALUES ($1, $2, 'closed')", [taskId, order.rows[0].id])
  await db.query(
    `INSERT INTO article_writing_submissions
      (task_id, revision_no, submitted_by, kind, title, body_markdown, sources, authorship_mode, human_contribution)
     VALUES ($1, 1, $2, 'article', $3, $4, '[{"url":"https://example.org/wpg-test","title":"fixture source"}]'::jsonb,
             'human_only', 'Disposable wallet integration article fixture.')`,
    [taskId, writer.actor.id, `Wallet integration article ${suffix}`, `This fixture proves only accepted independent article reviews award one internal WPG token; id ${suffix}.`],
  )
  const submission = await db.query('SELECT id FROM article_writing_submissions WHERE task_id = $1', [taskId])
  await db.query('UPDATE article_writing_tasks SET status = $2, current_submission_id = $3 WHERE id = $1', [taskId, 'submitted', submission.rows[0].id])

  const selfReview = await request(`/api/writing-tasks/${taskId}/review`, {
    method: 'PATCH', cookie: writer.cookie,
    body: { decision: 'accepted', comment: 'The author cannot independently review their own submission.' },
  })
  assert.equal(selfReview.response.status, 403)
  const writerBalanceAfterSelfReview = await request('/api/account', { cookie: writer.cookie })
  assert.equal(writerBalanceAfterSelfReview.data.account.tokenAccount.balance, 0, 'self review must not award WPG')

  const accepted = await request(`/api/writing-tasks/${taskId}/review`, {
    method: 'PATCH', cookie: reviewer.cookie,
    body: { decision: 'accepted', comment: 'Independent moderator reviewed the sourced article.' },
  })
  assert.equal(accepted.response.status, 200, JSON.stringify(accepted.data))
  assert.equal(accepted.data.taskStatus, 'accepted')

  const writerBalance = await request('/api/account', { cookie: writer.cookie })
  assert.equal(writerBalance.response.status, 200)
  assert.equal(writerBalance.data.account.tokenAccount.balance, 1)
  assert.equal(writerBalance.data.account.tokenAccount.history.length, 1)
  assert.equal(writerBalance.data.account.tokenAccount.history[0].amount, 1)
  assert.equal(writerBalance.data.account.tokenAccount.history[0].sourceId, taskId)
  const reviewerBalance = await request('/api/account', { cookie: reviewer.cookie })
  assert.equal(reviewerBalance.data.account.tokenAccount.balance, 0, 'the submitter earns the token, not the reviewer')
  const tokenEntry = await db.query(
    `SELECT actor_id, amount, reason, idempotency_key FROM actor_token_ledger WHERE source_id = $1`,
    [taskId],
  )
  assert.equal(tokenEntry.rowCount, 1, 'the acceptance transaction should award exactly one immutable idempotent token entry')
  assert.equal(tokenEntry.rows[0].actor_id, writer.actor.id)
  assert.equal(Number(tokenEntry.rows[0].amount), 1)
  assert.equal(tokenEntry.rows[0].reason, 'article_accepted')
  await assert.rejects(db.query('UPDATE actor_token_ledger SET amount = 1000 WHERE source_id = $1', [taskId]), /immutable/)

  console.log('PASS isolated account wallet: own user ID, zero initial balance, no unauthenticated read, independent article acceptance awards exactly +1 WPG')
} finally {
  if (connected) {
    for (const id of actorIds) {
      await db.query('DELETE FROM actor_audit_log WHERE actor_id = $1 OR target_id = $1::text', [id]).catch(() => {})
      await db.query('DELETE FROM human_sessions WHERE actor_id = $1', [id]).catch(() => {})
    }
    await db.end().catch(() => {})
  }
}
