import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'

const base = (process.env.AIKI_TEST_BASE_URL || '').replace(/\/$/, '')
if (!base) throw new Error('Set AIKI_TEST_BASE_URL to an isolated test server URL')
const origin = new URL(base).origin
const suffix = randomBytes(4).toString('hex')
const password = `AIKI-access-${randomBytes(18).toString('base64url')}`

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

const ownerName = `access-owner-${suffix}`
const memberName = `access-member-${suffix}`
const ownerResponse = await request('/api/auth/register', {
  method: 'POST',
  body: { username: ownerName, email: `${ownerName}@example.org`, password },
})
assert.equal(ownerResponse.response.status, 201, JSON.stringify(ownerResponse.data))
const owner = cookieFrom(ownerResponse.response)
const memberResponse = await request('/api/auth/register', {
  method: 'POST',
  body: { username: memberName, email: `${memberName}@example.org`, password },
})
assert.equal(memberResponse.response.status, 201, JSON.stringify(memberResponse.data))
const member = cookieFrom(memberResponse.response)

const title = `Link access page ${suffix}`
const created = await request('/api/topics', {
  method: 'POST',
  cookie: owner,
  body: {
    title,
    body: 'This page starts available by its address and stays out of the public list.',
    kind: 'discussion',
    locale: 'en',
    access: 'link',
  },
})
assert.equal(created.response.status, 201, JSON.stringify(created.data))
assert.equal(created.data.topic.access, 'link')
const slug = created.data.topic.slug
const pageNumber = created.data.topic.page_number

const anonymous = await request(`/api/topics/${encodeURIComponent(slug)}`)
assert.equal(anonymous.response.status, 200)
assert.equal(anonymous.data.access, 'link')
assert.equal(anonymous.data.canChangeAccess, false)

const catalog = await request('/api/topics?limit=50')
assert.equal(catalog.response.status, 200)
assert.equal(catalog.data.items.some(item => item.slug === slug), false)

const shortLink = await request(`/n/${pageNumber}`)
assert.equal(shortLink.response.status, 301)
assert.match(shortLink.response.headers.get('location') || '', new RegExp(`/${pageNumber}$`))

const opened = await request(`/api/topics/${encodeURIComponent(slug)}/visibility`, {
  method: 'PATCH',
  cookie: owner,
  body: { access: 'public' },
})
assert.equal(opened.response.status, 200, JSON.stringify(opened.data))
assert.equal(opened.data.access, 'public')
const listed = await request('/api/topics?limit=50')
assert.equal(listed.data.items.some(item => item.slug === slug), true)

const withdrawn = await request(`/api/topics/${encodeURIComponent(slug)}/visibility`, {
  method: 'PATCH',
  cookie: owner,
  body: { access: 'link' },
})
assert.equal(withdrawn.response.status, 200)
assert.equal(withdrawn.data.access, 'link')
const hiddenFromCatalog = await request('/api/topics?limit=50')
assert.equal(hiddenFromCatalog.data.items.some(item => item.slug === slug), false)
assert.equal((await request(`/api/topics/${encodeURIComponent(slug)}`)).response.status, 200)

const secret = await request(`/api/topics/${encodeURIComponent(slug)}/visibility`, {
  method: 'PATCH',
  cookie: owner,
  body: { access: 'author' },
})
assert.equal(secret.response.status, 200)
assert.equal(secret.data.access, 'author')
assert.equal((await request(`/api/topics/${encodeURIComponent(slug)}`)).response.status, 404)
assert.equal((await request(`/n/${pageNumber}`)).response.status, 404)
const authorRead = await request(`/api/topics/${encodeURIComponent(slug)}`, { cookie: owner })
assert.equal(authorRead.response.status, 200)
assert.equal(authorRead.data.access, 'author')
assert.equal((await request(`/api/topics/${encodeURIComponent(slug)}`, { cookie: member })).response.status, 404)
assert.equal((await request(`/api/topics/${encodeURIComponent(slug)}/visibility`, {
  method: 'PATCH',
  cookie: member,
  body: { access: 'public' },
})).response.status, 404)

await request(`/api/topics/${encodeURIComponent(slug)}/visibility`, {
  method: 'PATCH',
  cookie: owner,
  body: { access: 'public' },
})
const memberDemote = await request(`/api/topics/${encodeURIComponent(slug)}/visibility`, {
  method: 'PATCH',
  cookie: member,
  body: { access: 'link' },
})
assert.equal(memberDemote.response.status, 400)
const ownerDemote = await request(`/api/topics/${encodeURIComponent(slug)}/visibility`, {
  method: 'PATCH',
  cookie: owner,
  body: { access: 'link' },
})
assert.equal(ownerDemote.response.status, 200)
assert.equal(ownerDemote.data.accessChoices.includes('author'), true)

console.log('page access ok')
