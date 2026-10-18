import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { spawn } from 'node:child_process'
import pg from 'pg'
import { assertApprovedDisposableDatabase } from '../support/disposable-owner.mjs'

const expectedConfirmation = 'I CONFIRM A DELEGATED ACCOUNT TEST ON A DISPOSABLE AIKI DATABASE'
const baseUrl = process.env.DATABASE_URL || ''
if (!baseUrl || process.env.AIKI_DELEGATED_ACCOUNTS_TEST_CONFIRM !== expectedConfirmation) {
  throw new Error(`Refusing writes. Set DATABASE_URL and AIKI_DELEGATED_ACCOUNTS_TEST_CONFIRM=${JSON.stringify(expectedConfirmation)} only for a disposable database.`)
}
assertApprovedDisposableDatabase(baseUrl)
const dbUrl = new URL(baseUrl)
const databaseName = decodeURIComponent(dbUrl.pathname.slice(1))
if (!/^aiki_(?:mvp_test|live_test)_[a-z0-9_]+$/.test(databaseName)) {
  throw new Error('Delegated-account integration is restricted to a loopback disposable local AIKI database.')
}

const suffix = randomBytes(5).toString('hex')
const username = `delegated-${suffix}`
const oldPassword = `Delegated-old-${randomBytes(18).toString('base64url')}`
const newPassword = `Delegated-new-${randomBytes(18).toString('base64url')}`
const appPort = 3016
const appBase = `http://127.0.0.1:${appPort}`
const db = new pg.Client({ connectionString: baseUrl })
let app

function cookieFrom(response) {
  const token = (response.headers.get('set-cookie') || '').match(/(?:^|,\s*)aiki_session=([^;,]+)/)?.[1]
  return token ? `aiki_session=${token}` : null
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
  return { response, data, cookie: cookieFrom(response) }
}

async function startApp() {
  const env = { ...process.env }
  env.DATABASE_URL = baseUrl
  env.NUXT_DATABASE_URL = baseUrl
  env.NODE_ENV = 'production'
  env.HOST = '127.0.0.1'
  env.PORT = String(appPort)
  env.RATE_LIMIT_SECRET = 'delegated-accounts-rate-secret'
  env.NUXT_RATE_LIMIT_SECRET = env.RATE_LIMIT_SECRET
  env.NITRO_RATE_LIMIT_SECRET = env.RATE_LIMIT_SECRET
  env.READ_HMAC_SECRET = 'delegated-accounts-read-secret'
  env.NUXT_READ_HMAC_SECRET = env.READ_HMAC_SECRET
  env.NITRO_READ_HMAC_SECRET = env.READ_HMAC_SECRET
  env.NITRO_DATABASE_URL = baseUrl
  for (const name of ['NERON_API_KEY', 'NERON_API_BASE', 'NUXT_NERON_API_KEY', 'NUXT_NERON_API_BASE', 'NITRO_NERON_API_KEY', 'NITRO_NERON_API_BASE']) delete env[name]
  const child = spawn(process.execPath, ['.output/server/index.mjs'], { env, stdio: ['ignore', 'pipe', 'pipe'] })
  let logs = ''
  child.stdout.on('data', chunk => { logs += chunk })
  child.stderr.on('data', chunk => { logs += chunk })
  const deadline = Date.now() + 20_000
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`App exited before health: ${logs}`)
    try {
      const health = await fetch(`${appBase}/api/health`, { signal: AbortSignal.timeout(1000) })
      if (health.ok) return child
    } catch { /* still starting */ }
    await new Promise(resolve => setTimeout(resolve, 200))
  }
  child.kill('SIGTERM')
  throw new Error(`App did not become healthy: ${logs}`)
}

try {
  await db.connect()
  app = await startApp()

  const registration = await request('/api/auth/register', {
    method: 'POST',
    body: { username, email: `${username}@example.invalid`, password: oldPassword },
  })
  assert.equal(registration.response.status, 201, JSON.stringify(registration.data))
  let humanCookie = registration.cookie
  assert.ok(humanCookie)
  const humanId = registration.data.actor.id

  const passwordChange = await request('/api/account/password', {
    method: 'PATCH',
    cookie: humanCookie,
    body: { currentPassword: oldPassword, newPassword },
  })
  assert.equal(passwordChange.response.status, 200, JSON.stringify(passwordChange.data))
  humanCookie = passwordChange.cookie || humanCookie

  const oldLogin = await request('/api/auth/login', {
    method: 'POST',
    body: { login: username, password: oldPassword },
  })
  assert.equal(oldLogin.response.status, 401, 'old password must stop working after a change')
  const newLogin = await request('/api/auth/login', {
    method: 'POST',
    body: { login: username, password: newPassword },
  })
  assert.equal(newLogin.response.status, 200, JSON.stringify(newLogin.data))
  humanCookie = newLogin.cookie || humanCookie

  const firstKey = await request('/api/account/agent-key', { method: 'POST', cookie: humanCookie, body: {} })
  assert.equal(firstKey.response.status, 201, JSON.stringify(firstKey.data))
  assert.match(firstKey.data.api_key, /^aiki_agent_[A-Za-z0-9_-]{43}$/)
  const firstAgentId = firstKey.data.agent.id
  const account = await request('/api/account', { cookie: humanCookie })
  assert.equal(account.response.status, 200, JSON.stringify(account.data))
  assert.equal(account.data.account.id, humanId)
  assert.equal(account.data.account.linkedAgent.id, firstAgentId)

  const linkedLogin = await request('/api/auth/agent-key', { method: 'POST', body: { key: firstKey.data.api_key } })
  assert.equal(linkedLogin.response.status, 200, JSON.stringify(linkedLogin.data))
  assert.equal(linkedLogin.data.signedInAs, 'human')
  assert.equal(linkedLogin.data.viaAgent.agentName, `${username}'s agent`)
  const linkedMe = await request('/api/auth/me', { cookie: linkedLogin.cookie })
  assert.equal(linkedMe.response.status, 200, JSON.stringify(linkedMe.data))
  assert.equal(linkedMe.data.actor.id, humanId)
  assert.equal(linkedMe.data.actor.kind, 'human')

  const secondKey = await request('/api/account/agent-key', { method: 'POST', cookie: humanCookie, body: {} })
  assert.equal(secondKey.response.status, 201, JSON.stringify(secondKey.data))
  assert.notEqual(secondKey.data.api_key, firstKey.data.api_key)
  const oldAgentLogin = await request('/api/auth/agent-key', { method: 'POST', body: { key: firstKey.data.api_key } })
  assert.equal(oldAgentLogin.response.status, 401, 'reissuing a linked key must invalidate the old key')
  const newAgentLogin = await request('/api/auth/agent-key', { method: 'POST', body: { key: secondKey.data.api_key } })
  assert.equal(newAgentLogin.response.status, 200, JSON.stringify(newAgentLogin.data))
  assert.equal(newAgentLogin.data.actor.id, humanId)

  const anonymousAgent = await request('/api/agents', { method: 'POST', body: {} })
  assert.equal(anonymousAgent.response.status, 201, JSON.stringify(anonymousAgent.data))
  assert.equal(anonymousAgent.data.actor.kind, 'agent')
  assert.equal(anonymousAgent.data.actor.agent_name, null)
  assert.equal(anonymousAgent.data.actor.agent_model, null)

  console.log('PASS delegated account, password/key rotation, agent-key login, and public agent registration')
} finally {
  if (app) app.kill('SIGTERM')
  await db.end().catch(() => {})
}
