import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { randomBytes } from 'node:crypto'

const base = (process.env.AIKI_TEST_BASE_URL || '').replace(/\/$/, '')
if (!base) throw new Error('Set AIKI_TEST_BASE_URL to an isolated test server URL')
const origin = new URL(base).origin
const suffix = randomBytes(4).toString('hex')
const password = `AIKI-mod-${randomBytes(18).toString('base64url')}`

const stub = createServer((request, response) => {
  let raw = ''
  request.on('data', chunk => { raw += chunk })
  request.on('end', () => {
    const hold = raw.includes('HOLD-THIS')
    const verdict = hold ? { ok: false, reason: 'held by the test model' } : { ok: true }
    response.writeHead(200, { 'content-type': 'application/json' })
    response.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify(verdict) } }] }))
  })
})
await new Promise(resolve => stub.listen(0, '127.0.0.1', resolve))
const modelBase = `http://127.0.0.1:${stub.address().port}/v1`

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

async function register(name) {
  const registered = await request('/api/auth/register', {
    method: 'POST',
    body: { username: name, email: `${name}@example.org`, password },
  })
  assert.equal(registered.response.status, 201, JSON.stringify(registered.data))
  return cookieFrom(registered.response)
}

function article(title, extra = {}) {
  return {
    title,
    body: 'A sourced article body long enough for the shared publication rules.',
    kind: 'article',
    locale: 'en',
    authorshipMode: 'human_only',
    humanContribution: 'A person wrote this disposable article.',
    sources: [{ url: `https://example.org/mod-${suffix}-${title.slice(0, 12).replace(/\s/g, '-')}`, title: 'Moderation source' }],
    rulesConsent: true,
    ...extra,
  }
}

function assistant(extra) {
  return {
    enabled: true,
    provider: 'openai',
    model: 'local-test',
    baseUrl: modelBase,
    apiKey: 'test-key-123456',
    trigger: 'publish',
    onFail: 'hidden',
    ...extra,
  }
}

const owner = await register(`mod-owner-${suffix}`)
const member = await register(`mod-member-${suffix}`)
const leader = await register(`mod-leader-${suffix}`)
const author = await register(`mod-author-${suffix}`)
const stranger = await register(`mod-guest-${suffix}`)

const node = await request('/api/node')
assert.equal(node.data.node.moderationMode, 'community')

const created = await request('/api/topics', { method: 'POST', cookie: owner, body: article(`Community page ${suffix}`) })
assert.equal(created.response.status, 201, JSON.stringify(created.data))
const slug = created.data.topic.slug
const page = await request(`/api/topics/${slug}`, { cookie: owner })
const proposal = await request(`/api/topics/${slug}/proposals`, {
  method: 'POST',
  cookie: member,
  body: {
    baseRevisionId: page.data.revision_id,
    locale: 'en',
    proposedBody: 'A proposed clarification that is long enough to stay on the page.',
    rationale: 'The community adds a clarification.',
  },
})
assert.equal(proposal.response.status, 201, JSON.stringify(proposal.data))
const proposalId = proposal.data.proposal?.id || proposal.data.id
assert.ok(proposalId, JSON.stringify(proposal.data))

const stance = await request(`/api/topics/${slug}/proposals/${proposalId}/stance`, {
  method: 'POST',
  cookie: owner,
  body: { stance: 'disagree' },
})
assert.equal(stance.response.status, 200, JSON.stringify(stance.data))
const removed = await request(`/api/topics/${slug}/proposals/${proposalId}`, { method: 'DELETE', cookie: owner })
assert.ok(removed.response.status === 404 || removed.response.status === 405)
const vote = await request(`/api/topics/${slug}/proposals/${proposalId}/votes`, {
  method: 'POST',
  cookie: member,
  body: { value: -1 },
})
assert.equal(vote.response.status, 200, JSON.stringify(vote.data))
assert.equal(vote.data.vote.score, -1)
const listed = await request(`/api/topics/${slug}/proposals`, { cookie: owner })
const row = listed.data.items.find(item => item.id === proposalId)
assert.equal(row.author_stance, 'disagree')
assert.equal(row.score, -1)

const opened = await request(`/api/topics/${slug}/visibility`, { method: 'PATCH', cookie: owner, body: { access: 'public' } })
assert.equal(opened.response.status, 200, JSON.stringify(opened.data))

const beforeModel = await request('/api/admin/settings', { cookie: owner })
const nodeModel = await request('/api/admin/settings', {
  method: 'PATCH',
  cookie: owner,
  body: {
    countsPublic: beforeModel.data.settings.countsPublic,
    registrationOpen: beforeModel.data.settings.registrationOpen,
    displayName: beforeModel.data.settings.displayName,
    accentLight: beforeModel.data.settings.accentLight,
    accentDark: beforeModel.data.settings.accentDark,
    moderationMode: 'community',
    assistant: assistant(),
  },
})
assert.equal(nodeModel.response.status, 200, JSON.stringify(nodeModel.data))
assert.equal(nodeModel.data.settings.assistant.keySet, true)
assert.equal(nodeModel.data.settings.assistant.apiKey, undefined)
assert.equal(nodeModel.data.settings.assistant.enabled, true)

const heldPage = await request('/api/topics', {
  method: 'POST',
  cookie: owner,
  body: article(`Held page ${suffix}`, { body: 'A sourced article body that says HOLD-THIS and is long enough to publish.' }),
})
assert.equal(heldPage.response.status, 201, JSON.stringify(heldPage.data))
const heldSlug = heldPage.data.topic.slug
const hiddenGuest = await request(`/api/topics/${heldSlug}`)
assert.equal(hiddenGuest.response.status, 404)
const hiddenAuthor = await request(`/api/topics/${heldSlug}`, { cookie: owner })
assert.equal(hiddenAuthor.response.status, 200)
assert.equal(hiddenAuthor.data.access, 'author')

const clearPage = await request('/api/topics', { method: 'POST', cookie: owner, body: article(`Clear page ${suffix}`) })
const clearSlug = clearPage.data.topic.slug
const clearGuest = await request(`/api/topics/${clearSlug}`)
assert.equal(clearGuest.response.status, 200)
assert.equal(clearGuest.data.access, 'link')

const skipPage = await request('/api/topics', { method: 'POST', cookie: owner, body: article(`Skip page ${suffix}`) })
const skipSlug = skipPage.data.topic.slug
const denied = await request(`/api/topics/${skipSlug}/assistant-moderation`, {
  method: 'PATCH',
  cookie: member,
  body: { enabled: false },
})
assert.equal(denied.response.status, 403)
const skipped = await request(`/api/topics/${skipSlug}/assistant-moderation`, {
  method: 'PATCH',
  cookie: owner,
  body: { enabled: false },
})
assert.equal(skipped.response.status, 200, JSON.stringify(skipped.data))
assert.equal(skipped.data.assistantCheck, false)
const skipCurrent = await request(`/api/topics/${skipSlug}`, { cookie: owner })
const skipProposal = await request(`/api/topics/${skipSlug}/proposals`, {
  method: 'POST',
  cookie: member,
  body: {
    baseRevisionId: skipCurrent.data.revision_id,
    locale: 'en',
    proposedBody: 'A sourced article body that says HOLD-THIS and is long enough to stay a proposal.',
    rationale: 'This change should skip the node model because the page switch is off.',
  },
})
assert.equal(skipProposal.response.status, 201, JSON.stringify(skipProposal.data))
const skipProposalId = skipProposal.data.proposal?.id || skipProposal.data.id
const skipAccept = await request(`/api/topics/${skipSlug}/proposals/${skipProposalId}`, {
  method: 'PATCH',
  cookie: owner,
  body: { action: 'accept', comment: 'Accept without the model check.' },
})
assert.equal(skipAccept.response.status, 200, JSON.stringify(skipAccept.data))
const skipGuest = await request(`/api/topics/${skipSlug}`)
assert.equal(skipGuest.response.status, 200)
assert.notEqual(skipGuest.data.access, 'author')
const republishOff = await request(`/api/topics/${skipSlug}/visibility`, {
  method: 'PATCH',
  cookie: owner,
  body: { access: 'public' },
})
assert.equal(republishOff.response.status, 200, JSON.stringify(republishOff.data))
assert.equal(republishOff.data.access, 'public')
const republishOffGuest = await request(`/api/topics/${skipSlug}`)
assert.equal(republishOffGuest.response.status, 200)
assert.equal(republishOffGuest.data.access, 'public')

const paused = await request('/api/admin/settings', {
  method: 'PATCH',
  cookie: owner,
  body: {
    countsPublic: beforeModel.data.settings.countsPublic,
    registrationOpen: beforeModel.data.settings.registrationOpen,
    displayName: beforeModel.data.settings.displayName,
    accentLight: beforeModel.data.settings.accentLight,
    accentDark: beforeModel.data.settings.accentDark,
    moderationMode: 'community',
    assistant: { enabled: false },
  },
})
assert.equal(paused.response.status, 200, JSON.stringify(paused.data))
assert.equal(paused.data.settings.assistant.enabled, false)
const quietHold = await request('/api/topics', {
  method: 'POST',
  cookie: owner,
  body: article(`Quiet hold ${suffix}`, { body: 'A sourced article body that says HOLD-THIS and is long enough to publish.' }),
})
assert.equal(quietHold.response.status, 201, JSON.stringify(quietHold.data))
const quietSlug = quietHold.data.topic.slug
assert.equal((await request(`/api/topics/${quietSlug}`)).response.status, 200)
const resumed = await request('/api/admin/settings', {
  method: 'PATCH',
  cookie: owner,
  body: {
    countsPublic: beforeModel.data.settings.countsPublic,
    registrationOpen: beforeModel.data.settings.registrationOpen,
    displayName: beforeModel.data.settings.displayName,
    accentLight: beforeModel.data.settings.accentLight,
    accentDark: beforeModel.data.settings.accentDark,
    moderationMode: 'community',
    assistant: assistant(),
  },
})
assert.equal(resumed.response.status, 200, JSON.stringify(resumed.data))
const republishOn = await request(`/api/topics/${quietSlug}/visibility`, {
  method: 'PATCH',
  cookie: owner,
  body: { access: 'public' },
})
assert.equal(republishOn.response.status, 200, JSON.stringify(republishOn.data))
assert.equal(republishOn.data.access, 'author')
assert.equal((await request(`/api/topics/${quietSlug}`)).response.status, 404)

const settings = await request('/api/admin/settings', { cookie: owner })
const manual = await request('/api/admin/settings', {
  method: 'PATCH',
  cookie: owner,
  body: {
    countsPublic: settings.data.settings.countsPublic,
    registrationOpen: settings.data.settings.registrationOpen,
    displayName: settings.data.settings.displayName,
    accentLight: settings.data.settings.accentLight,
    accentDark: settings.data.settings.accentDark,
    moderationMode: 'manual',
  },
})
assert.equal(manual.response.status, 200, JSON.stringify(manual.data))
assert.equal(manual.data.settings.moderationMode, 'manual')
const manualNode = await request('/api/node')
assert.equal(manualNode.data.node.moderationMode, 'manual')

const branchPage = await request('/api/topics', {
  method: 'POST',
  cookie: leader,
  body: article(`Branch home ${suffix}`, { newBranch: { title: `Moderation branch ${suffix}`, description: 'A branch used by the moderation check.' } }),
})
assert.equal(branchPage.response.status, 201, JSON.stringify(branchPage.data))
assert.equal(branchPage.data.topic.access, 'pending')
const branchSlug = branchPage.data.topic.branch.slug
const pending = await request('/api/topics', {
  method: 'POST',
  cookie: author,
  body: article(`Pending page ${suffix}`, { branchSlug }),
})
assert.equal(pending.response.status, 201, JSON.stringify(pending.data))
assert.equal(pending.data.topic.access, 'pending')
const pendingSlug = pending.data.topic.slug
assert.equal((await request(`/api/topics/${pendingSlug}`)).response.status, 404)
assert.equal((await request(`/api/topics/${pendingSlug}`, { cookie: author })).data.access, 'pending')
const self = await request(`/api/topics/${pendingSlug}/moderation`, {
  method: 'POST',
  cookie: author,
  body: { action: 'approve', comment: 'The author tries to confirm it.' },
})
assert.equal(self.response.status, 403)
const outsider = await request(`/api/topics/${pendingSlug}/moderation`, {
  method: 'POST',
  cookie: stranger,
  body: { action: 'approve', comment: 'A stranger tries to confirm it.' },
})
assert.equal(outsider.response.status, 403)
const queue = await request('/api/moderation/queue', { cookie: leader })
assert.equal(queue.data.items.some(item => item.slug === pendingSlug), true)
const approved = await request(`/api/topics/${pendingSlug}/moderation`, {
  method: 'POST',
  cookie: leader,
  body: { action: 'approve', comment: 'A branch leader confirms this page.' },
})
assert.equal(approved.response.status, 200, JSON.stringify(approved.data))
assert.equal((await request(`/api/topics/${pendingSlug}`)).response.status, 200)

const rejectedPage = await request('/api/topics', { method: 'POST', cookie: author, body: article(`Rejected page ${suffix}`) })
const rejectedSlug = rejectedPage.data.topic.slug
const rejected = await request(`/api/topics/${rejectedSlug}/moderation`, {
  method: 'POST',
  cookie: owner,
  body: { action: 'reject', comment: 'A node owner rejects this page.' },
})
assert.equal(rejected.response.status, 200, JSON.stringify(rejected.data))
assert.equal((await request(`/api/topics/${rejectedSlug}`)).response.status, 404)
assert.equal((await request(`/api/topics/${rejectedSlug}`, { cookie: author })).data.access, 'author')

stub.close()
console.log('content moderation ok')
