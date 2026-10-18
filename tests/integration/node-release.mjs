import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { randomBytes } from 'node:crypto'

const base = (process.env.AIKI_TEST_BASE_URL || '').replace(/\/$/, '')
if (!base) throw new Error('Set AIKI_TEST_BASE_URL to an isolated test server URL')
const origin = new URL(base).origin
const suffix = randomBytes(4).toString('hex')
const password = `AIKI-rel-${randomBytes(18).toString('base64url')}`

let hubVersion = '1.3.0'
let hubStatus = 200
const hub = await new Promise((resolve, reject) => {
  const server = createServer((request, response) => {
    if (request.url !== '/api/node') {
      response.writeHead(404)
      response.end()
      return
    }
    if (hubStatus >= 300 && hubStatus < 400) {
      response.writeHead(hubStatus, { location: 'https://aiki.wiki/api/node' })
      response.end()
      return
    }
    response.writeHead(hubStatus, { 'content-type': 'application/json' })
    response.end(JSON.stringify({ node: { version: hubVersion } }))
  })
  server.once('error', reject)
  server.listen(0, '127.0.0.1', () => resolve(server))
})
const hubUrl = `http://127.0.0.1:${hub.address().port}`

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

try {
  const node = await request('/api/node')
  assert.equal(node.response.status, 200)
  assert.equal(node.data.node.version, '1.2.11')

  const anonymous = await request('/api/admin/release')
  assert.equal(anonymous.response.status, 401)

  const ownerName = `rel-owner-${suffix}`
  const memberName = `rel-member-${suffix}`
  const ownerResponse = await request('/api/auth/register', {
    method: 'POST',
    body: { username: ownerName, email: `${ownerName}@example.org`, password },
  })
  assert.equal(ownerResponse.response.status, 201, JSON.stringify(ownerResponse.data))
  assert.equal(ownerResponse.data.actor.role, 'owner')
  const owner = cookieFrom(ownerResponse.response)
  const memberResponse = await request('/api/auth/register', {
    method: 'POST',
    body: { username: memberName, email: `${memberName}@example.org`, password },
  })
  assert.equal(memberResponse.response.status, 201, JSON.stringify(memberResponse.data))
  const member = cookieFrom(memberResponse.response)
  const memberRelease = await request('/api/admin/release', { cookie: member })
  assert.equal(memberRelease.response.status, 403)

  const before = await request('/api/admin/release', { cookie: owner })
  assert.equal(before.response.status, 200, JSON.stringify(before.data))
  assert.equal(before.data.version, '1.2.11')
  assert.equal(before.data.updateAvailable, false)

  const saved = await request('/api/admin/mesh', {
    method: 'POST',
    cookie: owner,
    body: { action: 'hub', hubUrl },
  })
  assert.equal(saved.response.status, 200, JSON.stringify(saved.data))

  const newer = await request('/api/admin/release', { cookie: owner })
  assert.equal(newer.response.status, 200, JSON.stringify(newer.data))
  assert.equal(newer.data.updateAvailable, true)
  assert.equal(newer.data.hubVersion, '1.3.0')
  assert.equal(newer.data.version, '1.2.11')

  hubVersion = '1.2.11'
  const same = await request('/api/admin/release', { cookie: owner })
  assert.equal(same.data.updateAvailable, false)
  assert.equal(same.data.hubVersion, '1.2.11')

  hubVersion = '1.1.9'
  const older = await request('/api/admin/release', { cookie: owner })
  assert.equal(older.data.updateAvailable, false)
  assert.equal(older.data.hubVersion, '1.1.9')

  hubVersion = '1.1.2'
  const numeric = await request('/api/admin/release', { cookie: owner })
  assert.equal(numeric.data.updateAvailable, false)

  hubVersion = '1.2.11'
  hubStatus = 302
  const redirected = await request('/api/admin/release', { cookie: owner })
  assert.equal(redirected.data.updateAvailable, false)
  assert.equal(redirected.data.hubVersion, null)

  hubStatus = 500
  const down = await request('/api/admin/release', { cookie: owner })
  assert.equal(down.data.updateAvailable, false)

  console.log(`node release ok owner=${ownerName} hub=${hubUrl}`)
} finally {
  await new Promise(resolve => hub.close(resolve))
}
