import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import pg from 'pg'
import { PRODUCT_VERSION } from '../../server/utils/release.js'

const base = (process.env.AIKI_TEST_BASE_URL || '').replace(/\/$/, '')
if (!base) throw new Error('Set AIKI_TEST_BASE_URL to an isolated test server URL')
const databaseUrl = process.env.DATABASE_URL || ''
if (!databaseUrl) throw new Error('Set DATABASE_URL to the disposable database')
const origin = new URL(base).origin
const suffix = randomBytes(4).toString('hex')
const password = `AIKI-archive-${randomBytes(18).toString('base64url')}`

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

function accountFile({ slug, version, node }) {
  const file = {
    aiki: 'account-archive',
    version,
    exported_at: '2026-01-04T00:00:00.000Z',
    pages: [{
      slug,
      kind: 'question',
      created_at: '2026-01-02T00:00:00.000Z',
      revisions: [{
        locale: 'en',
        title: `Imported question ${slug}`,
        body: 'Which part of an old map should a reader be able to check?',
        sources: [],
      }],
    }],
    comments: [],
  }
  if (node) file.node = node
  return file
}

const ownerName = `archive-owner-${suffix}`
const registered = await request('/api/auth/register', {
  method: 'POST',
  body: { username: ownerName, email: `${ownerName}@example.org`, password },
})
assert.equal(registered.response.status, 201, JSON.stringify(registered.data))
const owner = cookieFrom(registered.response)

const created = await request('/api/topics', {
  method: 'POST',
  cookie: owner,
  body: {
    title: `Public archive page ${suffix}`,
    body: 'A published question long enough to leave this node in an archive.',
    kind: 'question',
    locale: 'en',
  },
})
assert.equal(created.response.status, 201, JSON.stringify(created.data))
const slug = created.data.topic.slug
const opened = await request(`/api/topics/${encodeURIComponent(slug)}/visibility`, {
  method: 'PATCH',
  cookie: owner,
  body: { access: 'public' },
})
assert.equal(opened.response.status, 200, JSON.stringify(opened.data))

const nodeArchive = await request('/api/node-archive')
assert.equal(nodeArchive.response.status, 200, JSON.stringify(nodeArchive.data))
assert.equal(nodeArchive.data.aiki, 'node-archive')
assert.equal(nodeArchive.data.version, 1)
assert.equal(nodeArchive.data.node.version, PRODUCT_VERSION)
assert.equal(nodeArchive.data.node.domain, nodeArchive.data.domain)
assert.ok(nodeArchive.data.node.origin)
assert.equal(nodeArchive.data.node.exported_at, nodeArchive.data.exported_at)
assert.equal(nodeArchive.data.pages.some(page => page.slug === slug), true)
assert.match(nodeArchive.response.headers.get('content-disposition') || '', /aiki-node-public-archive\.json/)

const accountArchive = await request('/api/account-archive', { cookie: owner })
assert.equal(accountArchive.response.status, 200, JSON.stringify(accountArchive.data))
assert.equal(accountArchive.data.aiki, 'account-archive')
assert.equal(accountArchive.data.node.version, PRODUCT_VERSION)
assert.equal(accountArchive.data.node.domain, nodeArchive.data.node.domain)
assert.equal(accountArchive.data.node.origin, nodeArchive.data.node.origin)
assert.equal(accountArchive.data.account.username, ownerName)
assert.equal(accountArchive.data.pages.some(page => page.slug === slug), true)

const olderSlug = `older-map-${suffix}`
const older = await request('/api/account-archive', {
  method: 'POST',
  cookie: owner,
  body: accountFile({
    slug: olderSlug,
    version: 1,
    node: {
      version: '1.0.0',
      domain: 'old.example',
      origin: 'https://old.example',
      exported_at: '2026-01-01T00:00:00.000Z',
    },
  }),
})
assert.equal(older.response.status, 200, JSON.stringify(older.data))
assert.equal(older.data.imported.pages, 1)

const newer = await request('/api/account-archive', {
  method: 'POST',
  cookie: owner,
  body: accountFile({
    slug: `newer-map-${suffix}`,
    version: 1,
    node: { version: '9.9.9', domain: 'new.example', origin: 'https://new.example', exported_at: '2026-02-01T00:00:00.000Z' },
  }),
})
assert.equal(newer.response.status, 400, JSON.stringify(newer.data))
assert.match(newer.data?.statusMessage || '', /newer archive/)

const futureFormat = await request('/api/account-archive', {
  method: 'POST',
  cookie: owner,
  body: accountFile({ slug: `future-map-${suffix}`, version: 2 }),
})
assert.equal(futureFormat.response.status, 400, JSON.stringify(futureFormat.data))
assert.match(futureFormat.data?.statusMessage || '', /newer file format/)

const legacy = await request('/api/account-archive', {
  method: 'POST',
  cookie: owner,
  body: accountFile({ slug: `legacy-map-${suffix}`, version: 1 }),
})
assert.equal(legacy.response.status, 200, JSON.stringify(legacy.data))
assert.equal(legacy.data.imported.pages, 1)

const pool = new pg.Pool({ connectionString: databaseUrl, max: 1 })
try {
  const audit = await pool.query(
    `SELECT details FROM actor_audit_log
      WHERE action = 'archive_imported' AND details->>'domain' = 'old.example'
      ORDER BY created_at DESC LIMIT 1`,
  )
  assert.equal(audit.rowCount, 1)
  assert.equal(audit.rows[0].details.node_version, '1.0.0')
  assert.equal(audit.rows[0].details.origin, 'https://old.example')
  assert.equal(audit.rows[0].details.exported_at, '2026-01-01T00:00:00.000Z')
  assert.equal(audit.rows[0].details.pages, 1)
} finally {
  await pool.end()
}

console.log('archive provenance ok')
