import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'

const base = (process.env.AIKI_TEST_BASE_URL || '').replace(/\/$/, '')
if (!base) throw new Error('Set AIKI_TEST_BASE_URL to an isolated test server URL')
const origin = new URL(base).origin
const suffix = randomBytes(4).toString('hex')
const password = `AIKI-rules-${randomBytes(18).toString('base64url')}`

async function request(path, { method = 'GET', body, cookie, bearer } = {}) {
  const headers = { accept: 'application/json' }
  if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(method.toUpperCase())) headers.origin = origin
  if (body !== undefined) headers['content-type'] = 'application/json'
  if (cookie) headers.cookie = cookie
  if (bearer) headers.authorization = `Bearer ${bearer}`
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

function article(extra = {}) {
  return {
    title: `Publication rules ${suffix}`,
    body: 'A sourced article body long enough for the shared publication rules.',
    kind: 'article',
    locale: 'en',
    authorshipMode: 'human_only',
    humanContribution: 'The owner wrote this disposable article.',
    sources: [{ url: `https://example.org/rules-${suffix}`, title: 'Rules source' }],
    rulesConsent: true,
    ...extra,
  }
}

const ownerName = `rules-owner-${suffix}`
const registered = await request('/api/auth/register', {
  method: 'POST',
  body: { username: ownerName, email: `${ownerName}@example.org`, password },
})
assert.equal(registered.response.status, 201, JSON.stringify(registered.data))
const owner = cookieFrom(registered.response)

const listed = await request('/api/article-rules?locale=ru')
assert.equal(listed.response.status, 200)
assert.equal(listed.data.rules.some(rule => rule.id === 'sources'), true)
assert.match(listed.data.rules.find(rule => rule.id === 'sources').statement, /источник/)
assert.equal(listed.data.baseline.length >= 5, true)

const missingConsent = await request('/api/topics', { method: 'POST', cookie: owner, body: article({ rulesConsent: false }) })
assert.equal(missingConsent.response.status, 400, JSON.stringify(missingConsent.data))
assert.match(missingConsent.data?.statusMessage || '', /publication rules/)

const withEmail = await request('/api/topics', {
  method: 'POST',
  cookie: owner,
  body: article({ body: 'A sourced article that names ada@example.org and is long enough to publish.' }),
})
assert.equal(withEmail.response.status, 400, JSON.stringify(withEmail.data))
assert.match(withEmail.data?.statusMessage || '', /почты|email/i)

const created = await request('/api/topics', { method: 'POST', cookie: owner, body: article() })
assert.equal(created.response.status, 201, JSON.stringify(created.data))
const slug = created.data.topic.slug

const question = await request('/api/topics', {
  method: 'POST',
  cookie: owner,
  body: { title: `Rules question ${suffix}`, body: 'A question does not ask for the article rule confirmation.', kind: 'question', locale: 'en' },
})
assert.equal(question.response.status, 201, JSON.stringify(question.data))

const proposal = await request(`/api/topics/${encodeURIComponent(slug)}/proposals`, {
  method: 'POST',
  cookie: owner,
  body: {
    baseRevisionId: (await request(`/api/topics/${encodeURIComponent(slug)}`, { cookie: owner })).data.revision_id,
    locale: 'en',
    proposedBody: 'This proposed body names ada@example.org and is long enough to be a revision.',
    rationale: 'Trying to add an email address.',
  },
})
assert.equal(proposal.response.status, 400, JSON.stringify(proposal.data))

const settings = await request('/api/admin/settings', { cookie: owner })
assert.equal(settings.response.status, 200, JSON.stringify(settings.data))
const saved = await request('/api/admin/settings', {
  method: 'PATCH',
  cookie: owner,
  body: {
    countsPublic: settings.data.settings.countsPublic,
    registrationOpen: settings.data.settings.registrationOpen,
    displayName: settings.data.settings.displayName,
    accentLight: settings.data.settings.accentLight,
    accentDark: settings.data.settings.accentDark,
    articleRules: [{ id: 'node-1', effect: 'forbid', statement: 'Do not use the marker phrase in an article.', match: 'marker-phrase' }],
  },
})
assert.equal(saved.response.status, 200, JSON.stringify(saved.data))
assert.equal(saved.data.settings.articleRules[0].match, 'marker-phrase')

const blocked = await request('/api/topics', {
  method: 'POST',
  cookie: owner,
  body: article({ title: `Marked rules ${suffix}`, body: 'A sourced article body that includes marker-phrase and stays long enough.' }),
})
assert.equal(blocked.response.status, 400, JSON.stringify(blocked.data))

const agent = await request('/api/agents', { method: 'POST', cookie: owner, body: { username: `rules-agent-${suffix}` } })
assert.equal(agent.response.status, 201, JSON.stringify(agent.data))
const key = agent.data.api_key
const status = await request('/mcp', {
  method: 'POST',
  bearer: key,
  body: { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'aiki_status', arguments: {} } },
})
assert.equal(status.data.result.structuredContent.articleRules.some(rule => rule.id === 'node-1'), true)

const refused = await request('/mcp', {
  method: 'POST',
  bearer: key,
  body: { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'aiki_create_article', arguments: {
    title: `Agent rules ${suffix}`,
    body: 'An agent article body long enough to publish without a recorded yes.',
    authorshipMode: 'ai_generated_unreviewed',
    modelName: 'Rules test model',
    sources: [{ url: `https://example.org/agent-rules-${suffix}` }],
  } } },
})
assert.equal(refused.data.result.isError, true, JSON.stringify(refused.data))

const accepted = await request('/mcp', {
  method: 'POST',
  bearer: key,
  body: { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'aiki_create_article', arguments: {
    title: `Agent rules yes ${suffix}`,
    body: 'An agent article body long enough to publish after a clear yes.',
    authorshipMode: 'ai_generated_unreviewed',
    modelName: 'Rules test model',
    rulesConsent: true,
    sources: [{ url: `https://example.org/agent-rules-yes-${suffix}` }],
  } } },
})
assert.equal(accepted.data.result.isError, false, JSON.stringify(accepted.data))
assert.equal(accepted.data.result.structuredContent.kind, 'article')

console.log('article rules ok')
