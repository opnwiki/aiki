import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'

const base = (process.env.AIKI_TEST_BASE_URL || '').replace(/\/$/, '')
if (!base) throw new Error('Set AIKI_TEST_BASE_URL to an isolated test server URL')
const origin = new URL(base).origin
const suffix = randomBytes(4).toString('hex')
const password = `AIKI-client-${randomBytes(18).toString('base64url')}`

const chromeAndroid = 'Mozilla/5.0 (Linux; Android 14; Pixel) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36'
const edgeWindows = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Edg/120.0.0.0'

async function request(path, { method = 'GET', body, cookie, bearer, userAgent } = {}) {
  const headers = { accept: 'application/json' }
  if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(method.toUpperCase())) headers.origin = origin
  if (body !== undefined) headers['content-type'] = 'application/json'
  if (cookie) headers.cookie = cookie
  if (bearer) headers.authorization = `Bearer ${bearer}`
  if (userAgent) headers['user-agent'] = userAgent
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

function replyByBody(topic, fragment) {
  const found = (topic.replies || []).find(item => String(item.body_markdown || '').includes(fragment))
  assert.ok(found, fragment)
  return found
}

const ownerName = `client-owner-${suffix}`
const registered = await request('/api/auth/register', {
  method: 'POST',
  body: { username: ownerName, email: `${ownerName}@example.org`, password },
})
assert.equal(registered.response.status, 201, JSON.stringify(registered.data))
const owner = cookieFrom(registered.response)

const account = await request('/api/account', { cookie: owner })
assert.equal(account.response.status, 200, JSON.stringify(account.data))
assert.equal(account.data.account.showClient, true)
assert.equal(account.data.account.showAuthor, true)

const hiddenProfile = await request('/api/account/profile', {
  method: 'PATCH',
  cookie: owner,
  body: { showAuthor: false },
})
assert.equal(hiddenProfile.response.status, 200, JSON.stringify(hiddenProfile.data))
assert.equal(hiddenProfile.data.showAuthor, false)

const profileDefaultPage = await request('/api/topics', {
  method: 'POST',
  cookie: owner,
  body: {
    title: `Profile author default ${suffix}`,
    body: 'This page checks that an omitted page-specific author choice follows the profile default.',
    kind: 'question',
    locale: 'en',
  },
})
assert.equal(profileDefaultPage.response.status, 201, JSON.stringify(profileDefaultPage.data))
const profileDefaultSlug = profileDefaultPage.data.topic.slug
const hiddenByProfile = await request(`/api/topics/${encodeURIComponent(profileDefaultSlug)}`)
assert.equal(hiddenByProfile.data.hideAuthor, true)
assert.equal(hiddenByProfile.data.authorVisibility, 'profile')

const explicitShown = await request(`/api/topics/${encodeURIComponent(profileDefaultSlug)}/author`, {
  method: 'PATCH', cookie: owner, body: { hideAuthor: false },
})
assert.equal(explicitShown.response.status, 200, JSON.stringify(explicitShown.data))
assert.equal(explicitShown.data.authorVisibility, 'show')
const shownByOverride = await request(`/api/topics/${encodeURIComponent(profileDefaultSlug)}`)
assert.equal(shownByOverride.data.hideAuthor, false)
assert.equal(shownByOverride.data.authorVisibility, 'show')

const resetToProfile = await request(`/api/topics/${encodeURIComponent(profileDefaultSlug)}/author`, {
  method: 'PATCH', cookie: owner, body: { hideAuthor: null },
})
assert.equal(resetToProfile.response.status, 200, JSON.stringify(resetToProfile.data))
assert.equal(resetToProfile.data.authorVisibility, 'profile')
const hiddenAfterReset = await request(`/api/topics/${encodeURIComponent(profileDefaultSlug)}`)
assert.equal(hiddenAfterReset.data.hideAuthor, true)

const shownProfile = await request('/api/account/profile', {
  method: 'PATCH', cookie: owner, body: { showAuthor: true },
})
assert.equal(shownProfile.response.status, 200, JSON.stringify(shownProfile.data))
assert.equal(shownProfile.data.showAuthor, true)
const shownByUpdatedProfile = await request(`/api/topics/${encodeURIComponent(profileDefaultSlug)}`)
assert.equal(shownByUpdatedProfile.data.hideAuthor, false)
assert.equal(shownByUpdatedProfile.data.authorVisibility, 'profile')

const article = await request('/api/topics', {
  method: 'POST',
  cookie: owner,
  body: {
    title: `Client marks article ${suffix}`,
    body: 'A sourced article body long enough for the shared publication rules.',
    kind: 'article',
    locale: 'en',
    authorshipMode: 'human_only',
    humanContribution: 'The owner wrote this disposable article.',
    sources: [{ url: `https://example.org/client-${suffix}`, title: 'Client source' }],
    rulesConsent: true,
  },
})
assert.equal(article.response.status, 201, JSON.stringify(article.data))
const articleSlug = article.data.topic.slug

const question = await request('/api/topics', {
  method: 'POST',
  cookie: owner,
  body: {
    title: `Client marks question ${suffix}`,
    body: 'A question long enough to hold both a person and an agent answer.',
    kind: 'question',
    locale: 'en',
  },
})
assert.equal(question.response.status, 201, JSON.stringify(question.data))
const questionSlug = question.data.topic.slug

const humanArticle = await request(`/api/topics/${encodeURIComponent(articleSlug)}/replies`, {
  method: 'POST',
  cookie: owner,
  userAgent: chromeAndroid,
  body: { body: 'A person replies under the article from a phone browser.', locale: 'en' },
})
assert.equal(humanArticle.response.status, 201, JSON.stringify(humanArticle.data))

const humanQuestion = await request(`/api/topics/${encodeURIComponent(questionSlug)}/replies`, {
  method: 'POST',
  cookie: owner,
  userAgent: edgeWindows,
  body: { body: 'A person answers the question from a desktop browser.', locale: 'en' },
})
assert.equal(humanQuestion.response.status, 201, JSON.stringify(humanQuestion.data))

const shownArticle = await request(`/api/topics/${encodeURIComponent(articleSlug)}`)
const articleReply = replyByBody(shownArticle.data, 'phone browser')
assert.equal(articleReply.author_kind, 'human')
assert.equal(articleReply.client, 'Chrome, Android')
assert.equal(Object.hasOwn(articleReply, 'client_label'), false)
assert.equal(Object.hasOwn(articleReply, 'show_client'), false)

const shownQuestion = await request(`/api/topics/${encodeURIComponent(questionSlug)}`)
const questionReply = replyByBody(shownQuestion.data, 'desktop browser')
assert.equal(questionReply.author_kind, 'human')
assert.equal(questionReply.client, 'Edge, Windows')

const hidden = await request('/api/account/client', {
  method: 'PATCH',
  cookie: owner,
  body: { showClient: false },
})
assert.equal(hidden.response.status, 200, JSON.stringify(hidden.data))
assert.equal(hidden.data.showClient, false)

const hiddenArticle = replyByBody((await request(`/api/topics/${encodeURIComponent(articleSlug)}`)).data, 'phone browser')
assert.equal(hiddenArticle.author_kind, 'human')
assert.equal(hiddenArticle.client, null)
const hiddenQuestion = replyByBody((await request(`/api/topics/${encodeURIComponent(questionSlug)}`)).data, 'desktop browser')
assert.equal(hiddenQuestion.client, null)

const restored = await request('/api/account/client', {
  method: 'PATCH',
  cookie: owner,
  body: { showClient: true },
})
assert.equal(restored.response.status, 200)
assert.equal(replyByBody((await request(`/api/topics/${encodeURIComponent(articleSlug)}`)).data, 'phone browser').client, 'Chrome, Android')

const badToggle = await request('/api/account/client', {
  method: 'PATCH',
  cookie: owner,
  body: { showClient: false, extra: true },
})
assert.equal(badToggle.response.status, 400)

const agent = await request('/api/agents', { method: 'POST', cookie: owner, body: { username: `client-agent-${suffix}` } })
assert.equal(agent.response.status, 201, JSON.stringify(agent.data))
const key = agent.data.api_key

async function agentReply(id, slug, args) {
  return request('/mcp', {
    method: 'POST',
    bearer: key,
    body: { jsonrpc: '2.0', id, method: 'tools/call', params: { name: 'aiki_create_reply', arguments: { slug, ...args } } },
  })
}

const claude = await agentReply(1, questionSlug, { body: 'An agent answers with a named model.', client: 'Claude (Opus 5.5)' })
assert.equal(claude.data.result.isError, false, JSON.stringify(claude.data))
const claudeReply = replyByBody((await request(`/api/topics/${encodeURIComponent(questionSlug)}`)).data, 'named model')
assert.equal(claudeReply.author_kind, 'agent')
assert.equal(claudeReply.client, 'Claude (Opus 5.5)')

const codex = await agentReply(2, articleSlug, { body: 'Another agent leaves a model mark on the article.', client: 'Codex (GPT 6 Luna)' })
assert.equal(codex.data.result.isError, false, JSON.stringify(codex.data))
assert.equal(replyByBody((await request(`/api/topics/${encodeURIComponent(articleSlug)}`)).data, 'model mark').client, 'Codex (GPT 6 Luna)')

const unnamed = await agentReply(3, questionSlug, { body: 'An agent reply without a model name.' })
assert.equal(unnamed.data.result.isError, false, JSON.stringify(unnamed.data))
const unnamedReply = replyByBody((await request(`/api/topics/${encodeURIComponent(questionSlug)}`)).data, 'without a model')
assert.equal(unnamedReply.author_kind, 'agent')
assert.equal(unnamedReply.client, null)

const rejected = await agentReply(4, questionSlug, { body: 'This client string is not a model name.', client: 'https://example.org/model' })
assert.equal(rejected.data.result.isError, true, JSON.stringify(rejected.data))
assert.match(rejected.data.result.content[0].text, /model name/)

console.log('reply client ok')
