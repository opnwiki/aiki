import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import pg from 'pg'

const base = (process.env.AIKI_TEST_BASE_URL || '').replace(/\/$/, '')
if (!base) throw new Error('Set AIKI_TEST_BASE_URL to an isolated test server URL')

const origin = new URL(base).origin
const suffix = randomBytes(5).toString('hex')
const username = `smoke-${suffix}`
const email = `${username}@example.org`
const password = `AIKI-test-${randomBytes(18).toString('base64url')}`

async function request(path, { method = 'GET', body, cookie, originHeader = 'auto', fetchSite, extraHeaders = {} } = {}) {
  const headers = { accept: 'application/json' }
  if (body !== undefined) headers['content-type'] = 'application/json'
  if (originHeader === 'auto') {
    if (body !== undefined) headers.origin = origin
  } else if (originHeader) {
    headers.origin = originHeader
  }
  if (fetchSite) headers['sec-fetch-site'] = fetchSite
  if (cookie) headers.cookie = cookie
  Object.assign(headers, extraHeaders)
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

const registration = await request('/api/auth/register', {
  method: 'POST',
  body: { username, email, password },
})
assert.equal(registration.response.status, 201, `registration failed: ${JSON.stringify(registration.data)}`)
assert.equal(registration.data.actor.username, username)
assert.equal(registration.data.actor.role, 'owner', 'first human account should own an empty node')
const setCookie = registration.response.headers.get('set-cookie') || ''
const token = setCookie.match(/(?:^|,\s*)aiki_session=([^;,]+)/)?.[1]
assert.ok(token, 'registration must set an HTTP-only session cookie')
const cookie = `aiki_session=${token}`

const missingOrigin = await request('/api/topics', {
  method: 'POST',
  cookie,
  originHeader: null,
  body: { title: 'Missing origin must fail', body: 'This write must not be accepted.', kind: 'discussion', locale: 'en' },
})
assert.equal(missingOrigin.response.status, 403, 'authenticated unsafe requests without origin metadata must be denied')

const crossSite = await request('/api/topics', {
  method: 'POST',
  cookie,
  fetchSite: 'cross-site',
  body: { title: 'Cross-site must fail', body: 'This write must not be accepted.', kind: 'discussion', locale: 'en' },
})
assert.equal(crossSite.response.status, 403, 'cross-site writes must be denied even with a matching Origin')

const anonymousWrite = await request('/api/topics', {
  method: 'POST',
  body: { title: 'Anonymous integration topic', body: 'This unauthenticated write must be rejected.', kind: 'discussion', locale: 'en' },
})
assert.equal(anonymousWrite.response.status, 401, 'anonymous topic creation must be denied')

const title = `Integration smoke topic ${suffix}`
const creation = await request('/api/topics', {
  method: 'POST',
  cookie,
  body: {
    title,
    body: 'This isolated end-to-end smoke test verifies source attribution, safe rendering and replies.',
    kind: 'article',
    locale: 'en',
    authorshipMode: 'human_ai_collaboration',
    rulesConsent: true,
    modelName: 'Smoke-test model 1.0',
    humanContribution: 'A human checked the page and selected its source.',
    sources: [{ url: 'https://example.org/aiki-smoke', title: 'Smoke-test source', publisher: 'Example', locator: 'section 1' }],
  },
})
assert.equal(creation.response.status, 201, `topic creation failed: ${JSON.stringify(creation.data)}`)
const slug = creation.data.topic.slug
assert.ok(slug)

const reply = await request(`/api/topics/${encodeURIComponent(slug)}/replies`, {
  method: 'POST',
  cookie,
  body: {
    body: 'An authenticated reply with its own supporting citation.',
    locale: 'en',
    source: { url: 'https://example.org/aiki-smoke-reply', title: 'Reply source' },
  },
})
assert.equal(reply.response.status, 201, `reply creation failed: ${JSON.stringify(reply.data)}`)

const page = await request(`/api/topics/${encodeURIComponent(slug)}`)
assert.equal(page.response.status, 200, `public topic read failed: ${JSON.stringify(page.data)}`)
assert.equal(page.data.title, title)
assert.equal(page.data.reply_count, 1)
assert.equal(page.data.replies.length, 1)
assert.match(page.data.html, /isolated end-to-end smoke test/)
assert.equal(page.data.citations.length, 1)
assert.equal(page.data.citations[0].canonical_url, 'https://example.org/aiki-smoke')
assert.ok(Number(page.data.reads) >= 1)
assert.ok(Number(page.data.unique_web_readers) >= 1)
const initialReads = Number(page.data.reads)
const initialUniqueReaders = Number(page.data.unique_web_readers)
const repeatRead = await request(`/api/topics/${encodeURIComponent(slug)}`, {
  extraHeaders: { 'x-forwarded-for': '198.51.100.99', 'x-aiki-agent-id': 'spoofed-agent' },
})
assert.equal(repeatRead.response.status, 200)
assert.equal(Number(repeatRead.data.reads), initialReads + 1, 'each successful page payload increments successful reads once')
assert.equal(Number(repeatRead.data.unique_web_readers), initialUniqueReaders, 'spoofed IP headers cannot create another unique reader behind loopback Nginx')
assert.equal(Number(repeatRead.data.unique_agents), 0, 'an unauthenticated agent ID header must never increment agent reads')
const anonymousProposal = await request(`/api/topics/${encodeURIComponent(slug)}/proposals`, {
  method: 'POST',
  body: {
    baseRevisionId: page.data.revision_id,
    locale: 'en',
    proposedBody: 'An unauthenticated edit proposal must never be accepted by this API.',
    rationale: 'Prove proposal write authentication.',
  },
})
assert.equal(anonymousProposal.response.status, 401)

const nonArticleProposal = await request('/api/topics/how-should-knowledge-pages-cite-sources/proposals', {
  method: 'POST',
  cookie,
  body: {
    baseRevisionId: '00000000-0000-4000-8000-000000000022',
    locale: 'en',
    proposedBody: 'A question or discussion must not accept article edit proposals.',
    rationale: 'Prove article-only proposal scope.',
  },
})
assert.equal(nonArticleProposal.response.status, 409)

const staleProposal = await request(`/api/topics/${encodeURIComponent(slug)}/proposals`, {
  method: 'POST',
  cookie,
  body: {
    baseRevisionId: '00000000-0000-4000-8000-000000000021',
    locale: 'en',
    proposedBody: 'This proposal deliberately refers to a revision that is not current for the new topic.',
    rationale: 'Prove stale revision protection.',
  },
})
assert.equal(staleProposal.response.status, 409, 'a proposal must target the current exact revision')

const proposalCreation = await request(`/api/topics/${encodeURIComponent(slug)}/proposals`, {
  method: 'POST',
  cookie,
  body: {
    baseRevisionId: page.data.revision_id,
    locale: 'en',
    proposedTitle: `${title} improved`,
    proposedBody: 'This is an alternative body submitted against the exact revision returned by public reading.',
    rationale: 'Clarify the purpose and supporting evidence.',
  },
})
assert.equal(proposalCreation.response.status, 201, `proposal creation failed: ${JSON.stringify(proposalCreation.data)}`)
assert.equal(proposalCreation.data.proposal.base_revision_id, page.data.revision_id)

const proposalList = await request(`/api/topics/${encodeURIComponent(slug)}/proposals?status=open&limit=999`)
assert.equal(proposalList.response.status, 200)
assert.equal(proposalList.data.total, 1)
assert.equal(proposalList.data.items.length, 1)
assert.equal(proposalList.data.limit, 50, 'proposal list must cap page size')
assert.equal(proposalList.data.items[0].id, proposalCreation.data.proposal.id)
assert.match(proposalList.data.items[0].html, /alternative body/)

const proposalId = proposalCreation.data.proposal.id
const proposalDiff = await request(`/api/topics/${encodeURIComponent(slug)}/proposals/${proposalId}/diff`)
assert.equal(proposalDiff.response.status, 200, `proposal diff failed: ${JSON.stringify(proposalDiff.data)}`)
assert.equal(proposalDiff.data.title.before, title)
assert.equal(proposalDiff.data.title.after, `${title} improved`)
assert.equal(proposalDiff.data.body.lines.some(line => line.type === 'added' && line.text.includes('alternative body')), true)

const nonReviewer = await request(`/api/topics/${encodeURIComponent(slug)}/proposals/${proposalId}`, {
  method: 'PATCH', cookie,
  body: { action: 'accept', comment: 'This member cannot review proposals.' },
})
assert.equal(nonReviewer.response.status, 403, 'ordinary members must not review proposals')

const reviewerRegistration = await request('/api/auth/register', {
  method: 'POST', body: { username: `${username}-reviewer`, email: `${username}-reviewer@example.org`, password },
})
assert.equal(reviewerRegistration.response.status, 201)
const reviewerCookieToken = (reviewerRegistration.response.headers.get('set-cookie') || '').match(/(?:^|,\s*)aiki_session=([^;,]+)/)?.[1]
assert.ok(reviewerCookieToken, 'reviewer registration must set an HTTP-only session cookie')
const reviewerCookie = `aiki_session=${reviewerCookieToken}`
const promotedReviewer = await request('/api/auth/me', { cookie: reviewerCookie })
assert.equal(promotedReviewer.response.status, 200)
const disposableDb = new pg.Client({ connectionString: process.env.DATABASE_URL })
await disposableDb.connect()
try {
  await disposableDb.query("UPDATE actors SET role = 'moderator' WHERE id = $1", [promotedReviewer.data.actor.id])
} finally {
  await disposableDb.end()
}

const selfReview = await request(`/api/topics/${encodeURIComponent(slug)}/proposals/${proposalId}`, {
  method: 'PATCH', cookie,
  body: { action: 'reject', comment: 'The proposal author cannot moderate their own change.' },
})
assert.equal(selfReview.response.status, 403, 'proposal authors must not review their own proposal')

const acceptedProposal = await request(`/api/topics/${encodeURIComponent(slug)}/proposals/${proposalId}`, {
  method: 'PATCH', cookie: reviewerCookie,
  body: { action: 'accept', comment: 'The proposed correction is supported by the cited context.' },
})
assert.equal(acceptedProposal.response.status, 200, `proposal acceptance failed: ${JSON.stringify(acceptedProposal.data)}`)
assert.equal(acceptedProposal.data.proposal.status, 'accepted')
assert.ok(acceptedProposal.data.proposal.result_revision_id)
const updatedPage = await request(`/api/topics/${encodeURIComponent(slug)}`)
assert.equal(updatedPage.response.status, 200)
assert.equal(updatedPage.data.revision_id, acceptedProposal.data.proposal.result_revision_id)
assert.equal(updatedPage.data.title, `${title} improved`)
assert.match(updatedPage.data.html, /alternative body/)
const acceptedRevision = await request(`/api/topics/${encodeURIComponent(slug)}/revisions/${updatedPage.data.revision_id}`)
assert.equal(acceptedRevision.response.status, 200)
assert.equal(acceptedRevision.data.parent.id, page.data.revision_id, 'accepted revision must point to the exact base revision')
const revisionHistory = await request(`/api/topics/${encodeURIComponent(slug)}/revisions?locale=en&limit=999`)
assert.equal(revisionHistory.response.status, 200)
assert.equal(revisionHistory.data.limit, 50)
assert.equal(revisionHistory.data.total, 2)
assert.equal(revisionHistory.data.items.filter(item => item.is_current).length, 1)
const historicalRevision = await request(`/api/topics/${encodeURIComponent(slug)}/revisions/${page.data.revision_id}`)
assert.equal(historicalRevision.response.status, 200)
assert.equal(historicalRevision.data.title, title)
assert.equal(historicalRevision.data.is_current, false)
assert.equal(historicalRevision.data.citations.length, 1, 'accepted revision must preserve citations')
assert.equal(historicalRevision.data.parent, null, 'the initial revision has no parent')
const repeatedReview = await request(`/api/topics/${encodeURIComponent(slug)}/proposals/${proposalId}`, {
  method: 'PATCH', cookie: reviewerCookie,
  body: { action: 'accept', comment: 'Repeated acceptance must be rejected safely.' },
})
assert.equal(repeatedReview.response.status, 409, 'a reviewed proposal must not be applied twice')

const anonReview = await request(`/api/topics/${encodeURIComponent(slug)}/proposals/${proposalId}`, {
  method: 'PATCH', body: { action: 'reject', comment: 'Anonymous review must be forbidden.' },
})
assert.equal(anonReview.response.status, 401, 'anonymous users must not review proposals')

const rejectedCreation = await request(`/api/topics/${encodeURIComponent(slug)}/proposals`, {
  method: 'POST', cookie,
  body: {
    baseRevisionId: updatedPage.data.revision_id,
    locale: 'en',
    proposedBody: 'A different proposed revision that will be rejected by the moderator for this test.',
    rationale: 'Verify the documented review rejection flow.',
  },
})
assert.equal(rejectedCreation.response.status, 201, `second proposal failed: ${JSON.stringify(rejectedCreation.data)}`)
const rejected = await request(`/api/topics/${encodeURIComponent(slug)}/proposals/${rejectedCreation.data.proposal.id}`, {
  method: 'PATCH', cookie: reviewerCookie,
  body: { action: 'reject', comment: 'This change lacks adequate support in its current form.' },
})
assert.equal(rejected.response.status, 200, `proposal rejection failed: ${JSON.stringify(rejected.data)}`)
assert.equal(rejected.data.proposal.status, 'rejected')
assert.equal(rejected.data.proposal.result_revision_id, null)
const unchangedPage = await request(`/api/topics/${encodeURIComponent(slug)}`)
assert.equal(unchangedPage.data.revision_id, updatedPage.data.revision_id, 'rejection must leave the current revision unchanged')

const signedIn = await request('/api/auth/me', { cookie })
assert.equal(signedIn.response.status, 200)
assert.equal(signedIn.data.actor.username, username)

const logout = await request('/api/auth/logout', { method: 'POST', cookie, fetchSite: 'same-origin' })
assert.ok(logout.response.status >= 200 && logout.response.status < 300, `logout failed: ${JSON.stringify(logout.data)}`)
const signedOut = await request('/api/auth/me', { cookie })
assert.equal(signedOut.data.actor, null, 'logout must revoke the server-side session')

console.log(`PASS isolated integration: registration/owner, session, auth guard, topic+source, reply+source, public read counts, logout (${slug})`)
