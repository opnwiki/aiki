import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { writeFile } from 'node:fs/promises'
import pg from 'pg'

const base = (process.env.AIKI_TEST_BASE_URL || '').replace(/\/$/, '')
if (!base) throw new Error('Set AIKI_TEST_BASE_URL to an isolated test server URL')
const origin = new URL(base).origin
const suffix = randomBytes(4).toString('hex')
const password = `AIKI-reg-${randomBytes(18).toString('base64url')}`

async function request(path, { method = 'GET', body, cookie } = {}) {
  const headers = { accept: 'application/json' }
  if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(method.toUpperCase())) headers.origin = origin
  if (body !== undefined) headers['content-type'] = 'application/json'
  if (cookie) headers.cookie = cookie
  const response = await fetch(`${base}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    redirect: 'manual',
  })
  const text = await response.text()
  let data = null
  try { data = text ? JSON.parse(text) : null } catch { data = text }
  return { response, data }
}

function cookieFrom(response) {
  const token = (response.headers.get('set-cookie') || '').match(/(?:^|,\s*)aiki_session=([^;,]+)/)?.[1]
  assert.ok(token, 'session cookie')
  return `aiki_session=${token}`
}

async function register(username) {
  const result = await request('/api/auth/register', {
    method: 'POST',
    body: { username, email: `${username}@example.org`, password },
  })
  return { ...result, cookie: result.response.status === 201 ? cookieFrom(result.response) : '' }
}

async function settingsBody(cookie, registrationOpen) {
  const current = await request('/api/admin/settings', { cookie })
  assert.equal(current.response.status, 200, JSON.stringify(current.data))
  const settings = current.data.settings
  return {
    countsPublic: settings.countsPublic === true,
    registrationOpen,
    displayName: settings.displayName,
    accentLight: settings.accentLight,
    accentDark: settings.accentDark,
  }
}

const db = new pg.Client({ connectionString: process.env.DATABASE_URL })
await db.connect()
try {
  const ownerName = `reg-owner-${suffix}`
  const readerName = `reg-reader-${suffix}`
  const blockedName = `reg-blocked-${suffix}`
  const owner = await register(ownerName)
  assert.equal(owner.response.status, 201, JSON.stringify(owner.data))
  assert.equal(owner.data.actor.role, 'owner')
  const reader = await register(readerName)
  assert.equal(reader.response.status, 201, JSON.stringify(reader.data))
  assert.equal(reader.data.actor.role, 'member')

  const openProfile = await request('/api/node')
  assert.equal(openProfile.data.node.registrationOpen, true)

  const closed = await request('/api/admin/settings', {
    method: 'PATCH',
    cookie: owner.cookie,
    body: await settingsBody(owner.cookie, false),
  })
  assert.equal(closed.response.status, 200, JSON.stringify(closed.data))
  assert.equal(closed.data.settings.registrationOpen, false)
  const closedProfile = await request('/api/node')
  assert.equal(closedProfile.data.node.registrationOpen, false)

  const blocked = await register(blockedName)
  assert.equal(blocked.response.status, 403, JSON.stringify(blocked.data))
  const stillThere = await db.query('SELECT count(*)::int AS total FROM actors WHERE username = $1', [blockedName])
  assert.equal(stillThere.rows[0].total, 0)

  const readerLogin = await request('/api/auth/login', {
    method: 'POST',
    body: { login: readerName, password },
  })
  assert.equal(readerLogin.response.status, 200, JSON.stringify(readerLogin.data))

  const memberPatch = await request('/api/admin/settings', {
    method: 'PATCH',
    cookie: reader.cookie,
    body: await settingsBody(owner.cookie, true),
  })
  assert.equal(memberPatch.response.status, 403, JSON.stringify(memberPatch.data))
  const stillClosed = await request('/api/node')
  assert.equal(stillClosed.data.node.registrationOpen, false)

  const reopened = await request('/api/admin/settings', {
    method: 'PATCH',
    cookie: owner.cookie,
    body: await settingsBody(owner.cookie, true),
  })
  assert.equal(reopened.response.status, 200, JSON.stringify(reopened.data))
  assert.equal(reopened.data.settings.registrationOpen, true)
  const late = await register(`reg-late-${suffix}`)
  assert.equal(late.response.status, 201, JSON.stringify(late.data))

  await writeFile('/tmp/aiki-reg.json', JSON.stringify({
    base,
    username: ownerName,
    password,
  }))
  console.log('PASS registration toggle', { owner: ownerName, closed: true, reopened: true })
} finally {
  await db.end()
}
