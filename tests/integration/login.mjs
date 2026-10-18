import assert from 'node:assert/strict'
import { createHash, randomBytes } from 'node:crypto'
import { readdir } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import pg from 'pg'

const expectedConfirmation = 'I CONFIRM A LOGIN TEST ON A DISPOSABLE AIKI LOGIN DATABASE'
const confirmation = process.env.AIKI_LOGIN_TEST_CONFIRM
const base = (process.env.AIKI_TEST_BASE_URL || '').replace(/\/$/, '')
const connectionString = process.env.DATABASE_URL || ''
if (confirmation !== expectedConfirmation || !base || !connectionString) {
  throw new Error(`Refusing writes. Set AIKI_TEST_BASE_URL, DATABASE_URL, and AIKI_LOGIN_TEST_CONFIRM=${JSON.stringify(expectedConfirmation)} only for a disposable login-test database.`)
}

const appUrl = new URL(base)
if (appUrl.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(appUrl.hostname)) {
  throw new Error('Login integration test is restricted to an HTTP loopback candidate; never use a public or production host.')
}
const databaseUrl = new URL(connectionString)
const databaseName = decodeURIComponent(databaseUrl.pathname.slice(1))
if (!['localhost', '127.0.0.1', '::1'].includes(databaseUrl.hostname) || !/^aiki_login_test_[a-z0-9_]+$/.test(databaseName)) {
  throw new Error('Refusing writes: use a local disposable database named aiki_login_test_<unique_suffix>.')
}

const suffix = randomBytes(6).toString('hex')
const username = `login-test-${suffix}`
const email = `${username}@example.invalid`
const password = `AIKI-Login-Test-${randomBytes(24).toString('base64url')}`
const db = new pg.Client({ connectionString })
let actorId
let connected = false

async function request(path, body) {
  const response = await fetch(`${base}${path}`, {
    method: 'POST',
    headers: {
      accept: 'application/json',
      'content-type': 'application/json',
      origin: appUrl.origin,
    },
    body: JSON.stringify(body),
    redirect: 'manual',
    signal: AbortSignal.timeout(20_000),
  })
  const text = await response.text()
  let data = null
  try { data = text ? JSON.parse(text) : null } catch { data = text }
  return { response, data }
}

function sessionToken(result) {
  const header = result.response.headers.get('set-cookie') || ''
  const token = header.match(/(?:^|,\s*)aiki_session=([^;,]+)/)?.[1]
  assert.ok(token, 'successful login must issue a human session cookie')
  return token
}

try {
  await db.connect()
  connected = true
  const database = await db.query('SELECT current_database() AS name, current_user AS role')
  assert.equal(database.rows[0].name, databaseName)
  assert.match(databaseName, /^aiki_login_test_/)
  const migrations = await db.query('SELECT version FROM schema_migrations ORDER BY version')
  const migrationDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../database/migrations')
  const migrationFiles = (await readdir(migrationDir)).filter(name => /^\d{3}_[a-z0-9_]+\.sql$/.test(name))
  assert.equal(migrations.rows.length, migrationFiles.length, 'test database should have every known migration')

  const health = await fetch(`${base}/api/health`, { signal: AbortSignal.timeout(10_000) })
  assert.equal(health.status, 200, `candidate health failed with HTTP ${health.status}`)
  const healthData = await health.json()
  assert.equal(healthData.status, 'ok')
  assert.equal(healthData.database, 'ok')

  const registration = await request('/api/auth/register', { username, email, password })
  assert.equal(registration.response.status, 201, `registration failed: ${JSON.stringify(registration.data)}`)
  actorId = registration.data?.actor?.id
  assert.ok(actorId, 'registration must return a fixture actor')

  const before = await db.query(
    `SELECT (SELECT count(*)::int FROM human_sessions WHERE actor_id = $1) AS sessions,
            (SELECT count(*)::int FROM actor_audit_log WHERE actor_id = $1 AND action = 'signed_in') AS signins`,
    [actorId],
  )
  assert.equal(before.rows[0].sessions, 1, 'registration should create one session')
  assert.equal(before.rows[0].signins, 0, 'registration should not create a sign-in audit event')

  const successful = await request('/api/auth/login', { login: username, password })
  assert.equal(successful.response.status, 200, `valid login failed: ${JSON.stringify(successful.data)}`)
  assert.equal(successful.data?.actor?.id, actorId)
  assert.equal(successful.data?.actor?.username, username)
  assert.equal('password_hash' in successful.data.actor, false, 'password hash must not be returned')
  const firstToken = sessionToken(successful)
  const firstHash = createHash('sha256').update(firstToken).digest('hex')
  const firstSession = await db.query(
    'SELECT actor_id FROM human_sessions WHERE token_hash = $1 AND revoked_at IS NULL AND expires_at > now()',
    [firstHash],
  )
  assert.equal(firstSession.rowCount, 1, 'successful login token must match one persisted active session')
  assert.equal(firstSession.rows[0].actor_id, actorId)
  const firstAudit = await db.query(
    `SELECT actor_id, target_type, target_id FROM actor_audit_log
      WHERE actor_id = $1 AND action = 'signed_in' ORDER BY created_at DESC LIMIT 1`,
    [actorId],
  )
  assert.equal(firstAudit.rowCount, 1, 'successful login must create an audit event')
  assert.equal(firstAudit.rows[0].actor_id, actorId)
  assert.equal(firstAudit.rows[0].target_type, 'actor')
  assert.equal(firstAudit.rows[0].target_id, actorId)

  const invalid = await request('/api/auth/login', { login: username, password: `${password}-wrong` })
  assert.equal(invalid.response.status, 401, `wrong password should return 401, got ${invalid.response.status}: ${JSON.stringify(invalid.data)}`)
  const afterInvalid = await db.query(
    `SELECT (SELECT count(*)::int FROM human_sessions WHERE actor_id = $1) AS sessions,
            (SELECT count(*)::int FROM actor_audit_log WHERE actor_id = $1 AND action = 'signed_in') AS signins`,
    [actorId],
  )
  assert.equal(afterInvalid.rows[0].sessions, 2, 'wrong password must not create a session')
  assert.equal(afterInvalid.rows[0].signins, 1, 'wrong password must not record a successful sign-in')

  const repeated = await request('/api/auth/login', { login: email, password })
  assert.equal(repeated.response.status, 200, `repeat login by email failed: ${JSON.stringify(repeated.data)}`)
  assert.equal(repeated.data?.actor?.id, actorId)
  const secondToken = sessionToken(repeated)
  assert.notEqual(secondToken, firstToken, 'each successful login should receive a fresh opaque session token')
  const finalCounts = await db.query(
    `SELECT (SELECT count(*)::int FROM human_sessions WHERE actor_id = $1 AND revoked_at IS NULL AND expires_at > now()) AS sessions,
            (SELECT count(*)::int FROM actor_audit_log WHERE actor_id = $1 AND action = 'signed_in' AND target_id = $1::text) AS signins`,
    [actorId],
  )
  assert.equal(finalCounts.rows[0].sessions, 3, 'registration and both successful logins should each persist one active session')
  assert.equal(finalCounts.rows[0].signins, 2, 'both successful logins should have UUID actor and text target audit values')

  console.log('PASS isolated backend login: username/email login, session persistence, invalid password rejection, repeat login, and signed_in audit types')
} finally {
  if (connected && actorId) {
    await db.query('BEGIN')
    try {
      await db.query("DELETE FROM actor_audit_log WHERE actor_id = $1 OR target_id = $1::text", [actorId])
      await db.query('DELETE FROM actors WHERE id = $1', [actorId])
      await db.query('COMMIT')
    } catch (error) {
      await db.query('ROLLBACK')
      throw error
    }
  }
  if (connected) await db.end()
}
