import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { randomBytes } from 'node:crypto'
import { writeFile } from 'node:fs/promises'
import pg from 'pg'

const base = (process.env.AIKI_TEST_BASE_URL || '').replace(/\/$/, '')
if (!base) throw new Error('Set AIKI_TEST_BASE_URL to an isolated test server URL')
const origin = new URL(base).origin
const suffix = randomBytes(4).toString('hex')
const password = `AIKI-mesh-${randomBytes(18).toString('base64url')}`

function card(url, name) {
  return JSON.stringify({
    protocol: 'aiki-mesh-0',
    self: { url, name },
    hub: { url: origin, name: 'AiKi' },
    total: 1,
    nodes: [{ url, name, role: 'peer' }],
    links: [],
  })
}

function listen(handler) {
  const server = createServer(handler)
  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => resolve(server))
  })
}

const northServer = await listen((request, response) => {
  const url = `http://127.0.0.1:${northServer.address().port}`
  if (request.url === '/api/mesh') {
    response.writeHead(200, { 'content-type': 'application/json' })
    response.end(card(url, 'Север'))
    return
  }
  response.writeHead(404)
  response.end()
})
const southServer = await listen((request, response) => {
  const url = `http://127.0.0.1:${southServer.address().port}`
  if (request.url === '/api/mesh') {
    response.writeHead(200, { 'content-type': 'application/json' })
    response.end(card(url, 'Юг'))
    return
  }
  response.writeHead(404)
  response.end()
})
const liarServer = await listen((request, response) => {
  response.writeHead(200, { 'content-type': 'application/json' })
  response.end(card('https://someone-else.example', 'Чужой'))
})
const northUrl = `http://127.0.0.1:${northServer.address().port}`
const southUrl = `http://127.0.0.1:${southServer.address().port}`
const liarUrl = `http://127.0.0.1:${liarServer.address().port}`

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

const db = new pg.Client({ connectionString: process.env.DATABASE_URL })
await db.connect()
try {
  const ownerName = `mesh-owner-${suffix}`
  const memberName = `mesh-member-${suffix}`
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

  const alone = await request('/api/mesh')
  assert.equal(alone.response.status, 200, JSON.stringify(alone.data))
  assert.equal(alone.data.protocol, 'aiki-mesh-0')
  assert.equal(alone.data.role, 'hub')
  assert.equal(alone.data.total, 1)
  assert.equal(alone.data.self.url, origin)

  const denied = await request('/api/admin/mesh', { method: 'POST', cookie: member, body: { action: 'add', url: northUrl } })
  assert.equal(denied.response.status, 403, JSON.stringify(denied.data))

  const north = await request('/api/admin/mesh', { method: 'POST', cookie: owner, body: { action: 'add', url: northUrl } })
  assert.equal(north.response.status, 200, JSON.stringify(north.data))
  const south = await request('/api/mesh/announce', { method: 'POST', body: { url: southUrl } })
  assert.equal(south.response.status, 200, JSON.stringify(south.data))
  const liar = await request('/api/mesh/announce', { method: 'POST', body: { url: liarUrl } })
  assert.equal(liar.response.status, 422, JSON.stringify(liar.data))
  const privateAddress = await request('/api/admin/mesh', { method: 'POST', cookie: owner, body: { action: 'add', url: 'http://10.1.2.3' } })
  assert.equal(privateAddress.response.status, 400, JSON.stringify(privateAddress.data))

  const directory = await request('/api/mesh')
  assert.equal(directory.data.total, 3, JSON.stringify(directory.data))
  const urls = directory.data.nodes.map(node => node.url).sort()
  assert.deepEqual(urls, [northUrl, origin, southUrl].sort())
  const names = new Map(directory.data.nodes.map(node => [node.url, node.name]))
  assert.equal(names.get(northUrl), 'Север')
  assert.equal(names.get(southUrl), 'Юг')
  const between = directory.data.links.find(link => link.via === 'directory')
  assert.ok(between, 'peers find each other through the center')
  assert.deepEqual([between.from, between.to].sort(), [northUrl, southUrl].sort())

  const admin = await request('/api/admin/mesh', { cookie: owner })
  assert.equal(admin.response.status, 200, JSON.stringify(admin.data))
  assert.equal(admin.data.mesh.total, 3)
  assert.equal(admin.data.mesh.nodes.find(node => node.role === 'hub').x, 160)

  const removed = await request('/api/admin/mesh', { method: 'POST', cookie: owner, body: { action: 'remove', url: southUrl } })
  assert.equal(removed.response.status, 200, JSON.stringify(removed.data))
  assert.equal(removed.data.mesh.total, 2)
  const restored = await request('/api/admin/mesh', { method: 'POST', cookie: owner, body: { action: 'add', url: southUrl } })
  assert.equal(restored.data.mesh.total, 3)

  const rows = await db.query('SELECT count(*)::int AS total FROM mesh_nodes')
  assert.equal(rows.rows[0].total, 3)
  await writeFile('/tmp/aiki-mesh.json', JSON.stringify({ base, username: ownerName, password }))
  console.log('PASS node mesh', { owner: ownerName, total: 3, north: northUrl, south: southUrl })
} finally {
  await db.end()
  northServer.close()
  southServer.close()
  liarServer.close()
}
