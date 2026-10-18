import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import pg from 'pg'

const base = (process.env.AIKI_TEST_BASE_URL || '').replace(/\/$/, '')
if (!base) throw new Error('Set AIKI_TEST_BASE_URL to an isolated test server URL')
const origin = new URL(base).origin
const suffix = randomBytes(5).toString('hex')
const password = `AIKI-review-${randomBytes(18).toString('base64url')}`
const slug = `review-reject-${suffix}`
const users = [`review-author-${suffix}`, `review-mod-${suffix}`, `review-mod2-${suffix}`]
const cookie = new Map()

async function request(path, { method = 'GET', body, session, headers = {} } = {}) {
  const requestHeaders = { accept: 'application/json', ...headers }
  if (body !== undefined) {
    requestHeaders['content-type'] = 'application/json'
    requestHeaders.origin ||= origin
  }
  if (session) requestHeaders.cookie = cookie.get(session)
  const response = await fetch(`${base}${path}`, { method, headers: requestHeaders, body: body === undefined ? undefined : JSON.stringify(body), redirect: 'manual' })
  const text = await response.text()
  let data = null
  try { data = text ? JSON.parse(text) : null } catch { data = text }
  return { response, data }
}

const db = new pg.Client({ connectionString: process.env.DATABASE_URL })
let topicId
let originalRevisionId
let proposalIds = []
try {
  await db.connect()
  for (const username of users) {
    const registration = await request('/api/auth/register', {
      method: 'POST', body: { username, email: `${username}@example.org`, password },
    })
    assert.equal(registration.response.status, 201, `registration failed for ${username}: ${JSON.stringify(registration.data)}`)
    const token = (registration.response.headers.get('set-cookie') || '').match(/(?:^|,\s*)aiki_session=([^;,]+)/)?.[1]
    assert.ok(token)
    cookie.set(username, `aiki_session=${token}`)
  }
  const actors = await db.query('SELECT id, username FROM actors WHERE username = ANY($1::text[])', [users])
  const moderators = actors.rows.filter(actor => actor.username !== users[0])
  const author = actors.rows.find(actor => actor.username === users[0])
  assert.ok(author && moderators.length === 2)
  await db.query("UPDATE actors SET role = 'moderator' WHERE id = ANY($1::uuid[])", [moderators.map(actor => actor.id)])

  const created = await request('/api/topics', {
    method: 'POST', session: users[0],
    body: {
      title: `Review test ${suffix}`,
      body: 'This test article will verify accepted and rejected proposal review behavior.',
      kind: 'article', locale: 'en', authorshipMode: 'human_only', rulesConsent: true,
      humanContribution: 'Disposable test fixture authored for review workflow coverage.',
      sources: [{ url: `https://example.org/review-${suffix}`, title: 'Review test source' }],
    },
  })
  assert.equal(created.response.status, 201, JSON.stringify(created.data))
  topicId = created.data.topic.id
  const current = await request(`/api/topics/${encodeURIComponent(created.data.topic.slug)}`)
  assert.equal(current.response.status, 200)
  originalRevisionId = current.data.revision_id

  for (const status of ['accept', 'reject']) {
    const proposalSourceUrl = `https://example.org/review-proposal-${suffix}`
    const proposal = await request(`/api/topics/${encodeURIComponent(created.data.topic.slug)}/proposals`, {
      method: 'POST', session: users[0],
      body: {
        baseRevisionId: originalRevisionId, locale: 'en',
        proposedBody: `Proposed body for ${status} case ${suffix} with sufficient explanatory content.`,
        rationale: `A reason for testing ${status} behavior.`,
        ...(status === 'accept' ? {
          sources: [{
            url: proposalSourceUrl,
            title: 'Proposal review source',
            publisher: 'Example publisher',
            publishedAt: null,
          }],
        } : {}),
      },
    })
    assert.equal(proposal.response.status, 201, JSON.stringify(proposal.data))
    proposalIds.push(proposal.data.proposal.id)
    const decision = await request(`/api/topics/${encodeURIComponent(created.data.topic.slug)}/proposals/${proposal.data.proposal.id}`, {
      method: 'PATCH', session: users[1],
      body: { action: status, comment: `Moderator rationale for ${status} ${suffix}.` },
    })
    assert.equal(decision.response.status, 200, `${status} failed: ${JSON.stringify(decision.data)}`)
    assert.equal(decision.data.proposal.status, status === 'accept' ? 'accepted' : 'rejected')
    if (status === 'accept') {
      const page = await request(`/api/topics/${encodeURIComponent(created.data.topic.slug)}`)
      assert.equal(page.data.revision_id, decision.data.proposal.result_revision_id)
      const attachedSource = await db.query(
        `SELECT s.canonical_url, s.published_at, c.revision_id
           FROM citations c
           JOIN sources s ON s.id = c.source_id
          WHERE c.revision_id = $1 AND s.canonical_url = $2`,
        [decision.data.proposal.result_revision_id, proposalSourceUrl],
      )
      assert.equal(attachedSource.rowCount, 1, 'accepted proposal source must be attached to the result revision')
      assert.equal(attachedSource.rows[0].published_at, null, 'a source without publishedAt must remain nullable')
      originalRevisionId = page.data.revision_id
    } else {
      assert.equal(decision.data.proposal.result_revision_id, null)
      const page = await request(`/api/topics/${encodeURIComponent(created.data.topic.slug)}`)
      assert.equal(page.data.revision_id, originalRevisionId, 'reject must not move the current revision pointer')
    }
  }

  const raceBase = originalRevisionId
  const raceProposal = await request(`/api/topics/${encodeURIComponent(created.data.topic.slug)}/proposals`, {
    method: 'POST', session: users[0],
    body: {
      baseRevisionId: raceBase, locale: 'en',
      proposedBody: `Concurrent review body ${suffix} with sufficient explanatory content.`,
      rationale: `Exercise simultaneous decisions ${suffix}.`,
    },
  })
  assert.equal(raceProposal.response.status, 201, JSON.stringify(raceProposal.data))
  const raceProposalId = raceProposal.data.proposal.id
  proposalIds.push(raceProposalId)
  const racePath = `/api/topics/${encodeURIComponent(created.data.topic.slug)}/proposals/${raceProposalId}`
  const decisions = await Promise.all([
    request(racePath, { method: 'PATCH', session: users[1], body: { action: 'accept', comment: `Concurrent acceptance ${suffix}.` } }),
    request(racePath, { method: 'PATCH', session: users[2], body: { action: 'reject', comment: `Concurrent rejection ${suffix}.` } }),
  ])
  assert.deepEqual(decisions.map(item => item.response.status).sort(), [200, 409], 'exactly one concurrent moderator decision must win')
  const winner = decisions.find(item => item.response.status === 200)
  const loser = decisions.find(item => item.response.status === 409)
  assert.ok(winner && loser)
  const stored = await db.query(
    `SELECT p.status, p.result_revision_id, p.base_revision_id, current.revision_id AS current_revision_id,
            (SELECT count(*)::int FROM revisions r WHERE r.parent_revision_id = p.base_revision_id AND r.author_id = ANY($2::uuid[])) AS review_revisions,
            (SELECT count(*)::int FROM actor_audit_log a WHERE a.target_type = 'edit_proposal' AND a.target_id = p.id::text AND a.action IN ('edit_proposal_accepted', 'edit_proposal_rejected')) AS review_audits
       FROM edit_proposals p
       JOIN topic_current_revisions current ON current.topic_id = p.topic_id AND current.locale = p.locale
      WHERE p.id = $1`,
    [raceProposalId, moderators.map(actor => actor.id)],
  )
  assert.equal(stored.rowCount, 1)
  const finalRace = stored.rows[0]
  assert.equal(finalRace.review_revisions, finalRace.status === 'accepted' ? 1 : 0, 'only an accepted decision may create one revision')
  assert.equal(finalRace.review_audits, 1, 'exactly one review audit event must be recorded')
  if (finalRace.status === 'accepted') {
    assert.ok(finalRace.result_revision_id)
    assert.equal(finalRace.current_revision_id, finalRace.result_revision_id)
    assert.equal(winner.data.proposal.status, 'accepted')
  } else {
    assert.equal(finalRace.status, 'rejected')
    assert.equal(finalRace.result_revision_id, null)
    assert.equal(finalRace.current_revision_id, raceBase, 'a winning rejection must leave the current revision unchanged')
    assert.equal(winner.data.proposal.status, 'rejected')
  }
  assert.match(String(loser.data.statusMessage || loser.data.message || ''), /reviewed|concurrent|reload/i)

  console.log('PASS isolated review integration: moderator accept/reject; proposal source citation with nullable date; atomic current pointer update; rejection preserves current revision')
} finally {
  if (topicId) {
    await db.query('DELETE FROM topics WHERE id = $1', [topicId]).catch(() => {})
  }
  if (users.length) {
    await db.query('DELETE FROM actors WHERE username = ANY($1::text[])', [users]).catch(() => {})
  }
  await db.end().catch(() => {})
}
