import assert from 'node:assert/strict'
import { createHash, randomBytes } from 'node:crypto'
import pg from 'pg'

const base = (process.env.AIKI_TEST_BASE_URL || '').replace(/\/$/, '')
const confirmation = process.env.AIKI_WRITING_TEST_CONFIRM
const expectedConfirmation = 'I CONFIRM A TEMPORARY WRITING TASK TEST ON A DISPOSABLE AIKI DATABASE'
if (!base || confirmation !== expectedConfirmation || !process.env.DATABASE_URL) {
  throw new Error(`Refusing writes. Set AIKI_TEST_BASE_URL, DATABASE_URL, and AIKI_WRITING_TEST_CONFIRM=${JSON.stringify(expectedConfirmation)} only for a disposable database.`)
}
const origin = new URL(base)
if (origin.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(origin.hostname)) {
  throw new Error('Writing-task integration is restricted to an HTTP loopback candidate; never use a public or production host.')
}
const databaseUrl = new URL(process.env.DATABASE_URL)
const databaseName = decodeURIComponent(databaseUrl.pathname.slice(1))
const approvedCiDatabase = process.env.GITHUB_ACTIONS === 'true' && databaseName === 'aiki_test'
if (!['localhost', '127.0.0.1', '::1'].includes(databaseUrl.hostname)
    || (!approvedCiDatabase && !/^aiki_mvp_test_[a-z0-9_]+$/.test(databaseName))) {
  throw new Error('Refusing writes: use local aiki_mvp_test_<unique_suffix>; CI may use only its dedicated aiki_test service database.')
}

const suffix = randomBytes(6).toString('hex')
const password = `AIKI-Writing-Test-${randomBytes(20).toString('base64url')}`
const ownerName = `mvp-owner-${suffix}`
const writerName = `mvp-writer-${suffix}`
const secondWriterName = `mvp-writer-b-${suffix}`
const agentName = `mvp-agent-${suffix}`
const users = new Map()
const fixtureIds = { assessmentIds: [], orderIds: [] }
const db = new pg.Client({ connectionString: process.env.DATABASE_URL })
let connected = false

async function request(path, { method = 'GET', body, cookie, bearer, headers = {} } = {}) {
  const requestHeaders = { accept: 'application/json', ...headers }
  if (body !== undefined) requestHeaders['content-type'] = 'application/json'
  if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(method.toUpperCase())) requestHeaders.origin = origin.origin
  if (cookie) requestHeaders.cookie = cookie
  if (bearer) requestHeaders.authorization = `Bearer ${bearer}`
  const response = await fetch(`${base}${path}`, {
    method,
    headers: requestHeaders,
    body: body === undefined ? undefined : JSON.stringify(body),
    redirect: 'manual',
    signal: AbortSignal.timeout(20_000),
  })
  const text = await response.text()
  let data = null
  try { data = text ? JSON.parse(text) : null } catch { data = text }
  return { response, data }
}

async function register(username) {
  const result = await request('/api/auth/register', {
    method: 'POST',
    body: { username, email: `${username}@example.invalid`, password },
  })
  assert.equal(result.response.status, 201, `registration failed: ${JSON.stringify(result.data)}`)
  const token = (result.response.headers.get('set-cookie') || '').match(/(?:^|,\s*)aiki_session=([^;,]+)/)?.[1]
  assert.ok(token, 'registration must set an authenticated session')
  const actor = result.data.actor
  users.set(actor.id, { actor, cookie: `aiki_session=${token}` })
  return users.get(actor.id)
}

async function waitForCommunityOrder(orderId, accessToken) {
  const deadline = Date.now() + 30_000
  let last
  while (Date.now() < deadline) {
    const result = await request(`/api/article-orders/${orderId}`, { bearer: accessToken })
    assert.equal(result.response.status, 200, JSON.stringify(result.data))
    last = result.data
    if (last.execution === 'community' && last.order.writingTaskId) return last
    await new Promise(resolve => setTimeout(resolve, 1000))
  }
  throw new Error(`Order did not reach community fallback: ${JSON.stringify(last)}`)
}

function tokens() {
  return {
    requestKey: randomBytes(32).toString('base64url'),
    accessToken: randomBytes(32).toString('base64url'),
  }
}

try {
  await db.connect()
  connected = true
  const health = await request('/api/health')
  assert.equal(health.response.status, 200, JSON.stringify(health.data))
  assert.equal(health.data?.status, 'ok')
  assert.equal(health.data?.database, 'ok')

  const owner = await register(ownerName)
  if (!['owner', 'admin'].includes(owner.actor.role)) {
    const promoted = await db.query("UPDATE actors SET role = 'owner' WHERE id = $1 RETURNING role", [owner.actor.id])
    assert.equal(promoted.rows[0]?.role, 'owner', 'owner promotion is restricted to this named disposable database fixture')
    owner.actor.role = 'owner'
  }
  const writer = await register(writerName)
  assert.equal(writer.actor.role, 'member')
  const secondWriter = await register(secondWriterName)
  assert.equal(secondWriter.actor.role, 'member')
  await db.query("UPDATE actors SET role = 'moderator' WHERE id = ANY($1::uuid[])", [[writer.actor.id, secondWriter.actor.id]])
  writer.actor.role = 'moderator'
  secondWriter.actor.role = 'moderator'
  const enrollment = await request('/api/agents', { method: 'POST', cookie: owner.cookie, body: { username: agentName } })
  assert.equal(enrollment.response.status, 201, JSON.stringify(enrollment.data))
  const agent = { actor: enrollment.data.actor, key: enrollment.data.api_key }
  assert.match(agent.key, /^aiki_agent_[A-Za-z0-9_-]{43}$/)

  // The preload mock intercepts Statica and Neron hostnames; it must never contact either provider.
  const malformedVerdict = tokens()
  const malformed = await request("/api/article-orders", {
    method: "POST",
    headers: { "idempotency-key": malformedVerdict.requestKey, "x-article-order-access-token": malformedVerdict.accessToken, "x-real-ip": "198.51.100.253" },
    body: { query: `Malformed Statica fixture ${suffix}`, locale: "en" },
  })
  assert.equal(malformed.response.status, 503, "non-boolean security.is_clean must fail closed")
  const falseVerdict = tokens()
    const unclean = await request("/api/article-orders", {
    method: "POST",
    headers: { "idempotency-key": falseVerdict.requestKey, "x-article-order-access-token": falseVerdict.accessToken, "x-real-ip": "198.51.100.252" },
    body: { query: `Unclean Statica fixture ${suffix}`, locale: "en" },
  })
    assert.equal(unclean.response.status, 202, JSON.stringify(unclean.data))
    assert.equal(unclean.data.order.status, 'queued')
    assert.ok(unclean.data.order.writingTaskId, 'unclean connections must still receive a community writing task')
    assert.equal(unclean.data.execution, 'community')
  const deniedAudit = await db.query(
    "SELECT outcome, statica_is_clean FROM article_order_assessments WHERE request_key_hash = $1",
    [createHash("sha256").update(`article-order\0${falseVerdict.requestKey}`).digest("hex")],
  )
  assert.deepEqual(deniedAudit.rows[0], { outcome: "rejected_not_clean", statica_is_clean: false })
    fixtureIds.orderIds.push(unclean.data.order.id)
    const uncleanAssessment = await db.query('SELECT assessment_id FROM article_order_submissions WHERE id = $1', [unclean.data.order.id])
    fixtureIds.assessmentIds.push(uncleanAssessment.rows[0].assessment_id)

  const query = `fallback: AIKI writing flow fixture ${suffix}`
  const context = [{ title: `Existing test page ${suffix}`, path: '/welcome-to-aiki', excerpt: 'Bounded, untrusted context fixture.' }]
  const orderTokens = tokens()
  const orderHeaders = {
    'idempotency-key': orderTokens.requestKey,
    'x-article-order-access-token': orderTokens.accessToken,
    'x-real-ip': `2001:db8:${suffix.match(/.{4}/g).join(':')}::1`,
  }
  const createOrder = () => request('/api/article-orders', {
    method: 'POST', headers: orderHeaders, body: { query, locale: 'en', context },
  })
  const created = await createOrder()
  assert.equal(created.response.status, 202, JSON.stringify(created.data))
  const orderId = created.data.order.id
  assert.ok(orderId)
  const assessmentLookup = await db.query('SELECT assessment_id FROM article_order_submissions WHERE id = $1', [orderId])
  assert.equal(assessmentLookup.rowCount, 1)
  fixtureIds.orderIds.push(orderId)
  fixtureIds.assessmentIds.push(assessmentLookup.rows[0].assessment_id)
  assert.equal(created.data.order.query, query)
  assert.equal(created.data.order.accessToken, orderTokens.accessToken)

  const duplicate = await createOrder()
  assert.equal(duplicate.response.status, 200, JSON.stringify(duplicate.data))
  assert.equal(duplicate.data.duplicate, true)
  assert.equal(duplicate.data.order.id, orderId, 'same idempotency key must return the same durable order')
  assert.equal(duplicate.data.order.accessToken, orderTokens.accessToken)

  const limitTokens = tokens()
  const limitIp = `2001:db8:${suffix.match(/.{4}/g).join(':')}::2`
  const firstLimitedIpOrder = await request('/api/article-orders', {
    method: 'POST',
    headers: {
      'idempotency-key': limitTokens.requestKey,
      'x-article-order-access-token': limitTokens.accessToken,
      'x-real-ip': limitIp,
    },
    body: { query: `First request for daily-limit fixture ${suffix}`, locale: 'en' },
  })
  assert.equal(firstLimitedIpOrder.response.status, 202, JSON.stringify(firstLimitedIpOrder.data))
  const limitOrderId = firstLimitedIpOrder.data.order.id
  const limitAssessment = await db.query('SELECT assessment_id FROM article_order_submissions WHERE id = $1', [limitOrderId])
  assert.equal(limitAssessment.rowCount, 1)
  fixtureIds.orderIds.push(limitOrderId)
  fixtureIds.assessmentIds.push(limitAssessment.rows[0].assessment_id)
  const secondLimitTokens = tokens()
  const dailyLimit = await request('/api/article-orders', {
    method: 'POST',
    headers: {
      'idempotency-key': secondLimitTokens.requestKey,
      'x-article-order-access-token': secondLimitTokens.accessToken,
      'x-real-ip': limitIp,
    },
    body: { query: `Second request for daily-limit fixture ${suffix}`, locale: 'en' },
  })
    assert.equal(dailyLimit.response.status, 202, JSON.stringify(dailyLimit.data))
    assert.equal(dailyLimit.data.order.status, 'queued')
    assert.ok(dailyLimit.data.order.writingTaskId, 'daily-limited connections must still receive a community writing task')
    assert.equal(dailyLimit.data.execution, 'community')
    fixtureIds.orderIds.push(dailyLimit.data.order.id)
    const dailyLimitAssessment = await db.query('SELECT assessment_id FROM article_order_submissions WHERE id = $1', [dailyLimit.data.order.id])
    fixtureIds.assessmentIds.push(dailyLimitAssessment.rows[0].assessment_id)
  const limitedIpAttempts = await db.query(
    `SELECT count(*)::int AS total,
            count(*) FILTER (WHERE outcome = 'queued')::int AS queued
       FROM article_order_assessments WHERE client_ip = $1::inet`, [limitIp],
  )
  assert.equal(limitedIpAttempts.rows[0].total, 2, 'both clean attempts are audited')
  assert.equal(limitedIpAttempts.rows[0].queued, 1, 'only one free request is queued per IP per UTC day')

  const statusBeforeFallback = await request(`/api/article-orders/${orderId}`, { bearer: orderTokens.accessToken })
  assert.equal(statusBeforeFallback.response.status, 200)
  assert.equal(JSON.stringify(statusBeforeFallback.data).includes(orderHeaders['x-real-ip']), false, 'capability status must not reveal IP')
  assert.equal(JSON.stringify(statusBeforeFallback.data).toLowerCase().includes('statica'), false, 'capability status must not reveal provider payload')
  const badCapability = await request(`/api/article-orders/${orderId}`, { bearer: randomBytes(32).toString('base64url') })
  assert.equal(badCapability.response.status, 404)

  const finalStatus = await waitForCommunityOrder(orderId, orderTokens.accessToken)
  const taskId = finalStatus.order.writingTaskId
  assert.equal(finalStatus.execution, 'community')
  assert.equal(finalStatus.order.status, 'queued')
  const orderData = await db.query(
    `SELECT assessment.client_ip::text AS client_ip, assessment.statica_response,
            assessment.statica_is_clean, assessment.search_context, orders.executor_error_code
       FROM article_order_submissions orders
       JOIN article_order_assessments assessment ON assessment.id = orders.assessment_id
      WHERE orders.id = $1`, [orderId],
  )
  assert.equal(orderData.rowCount, 1)
  assert.equal(orderData.rows[0].client_ip.split('/')[0], orderHeaders['x-real-ip'])
  assert.equal(orderData.rows[0].statica_is_clean, true)
  assert.equal(orderData.rows[0].statica_response.integration_mock, true)
  assert.deepEqual(orderData.rows[0].search_context, context)
  assert.equal(orderData.rows[0].executor_error_code, 'budget_unavailable', 'terminal provider budget failure must survive the community fallback transition')

  const anonymousClaim = await request(`/api/writing-tasks/${taskId}/claim`, { method: 'POST', body: { action: 'claim' } })
  assert.equal(anonymousClaim.response.status, 401)
  const taskList = await request('/api/writing-tasks?status=active')
  assert.equal(taskList.response.status, 200, JSON.stringify(taskList.data))
  assert.ok(taskList.data.items.some(item => item.id === taskId))

  const claimAttempts = await Promise.all([
    request(`/api/writing-tasks/${taskId}/claim`, { method: 'POST', body: { action: 'claim' }, cookie: writer.cookie }),
    request(`/api/writing-tasks/${taskId}/claim`, { method: 'POST', body: { action: 'claim' }, bearer: agent.key }),
  ])
  assert.deepEqual(claimAttempts.map(item => item.response.status).sort(), [200, 409], 'only one human or agent can claim the task')
  const successfulClaim = claimAttempts.find(item => item.response.status === 200)
  const writerActor = successfulClaim.data.actor.id === writer.actor.id ? writer.actor : agent.actor
  const writerAuth = writerActor.id === writer.actor.id ? { cookie: writer.cookie } : { bearer: agent.key }
  const afterClaim = await request('/api/writing-tasks?status=active')
  const claimedTask = afterClaim.data.items.find(item => item.id === taskId)
  assert.equal(claimedTask.claimedBy, writerActor.id)

  const draft = {
    kind: 'article', title: `AIKI writing flow fixture ${suffix}`,
    body: `This disposable human or agent draft verifies the review flow for ${query}. It is not published automatically.`,
    locale: 'en',
    sources: [{ url: `https://example.org/aiki-writing-${suffix}`, title: 'Writing flow test source', publisher: 'Example publisher' }],
    rulesConsent: true,
    ...(writerActor.kind === 'human' ? { authorshipMode: 'human_only', humanContribution: 'Created only as a disposable integration-test fixture.' } : {
      authorshipMode: 'ai_generated_unreviewed', modelName: 'Mock community writer', humanContribution: null,
    }),
  }
  const submission = await request(`/api/writing-tasks/${taskId}/submissions`, { method: 'POST', body: draft, ...writerAuth })
  assert.equal(submission.response.status, 201, JSON.stringify(submission.data))
  assert.equal(submission.data.submission.revision_no, 1)
  if (writerActor.kind === 'human') {
    const selfReview = await request(`/api/writing-tasks/${taskId}/review`, {
      method: 'PATCH', cookie: writer.cookie,
      body: { decision: 'accepted', comment: 'The submitter cannot accept this own draft.' },
    })
    assert.equal(selfReview.response.status, 403, 'a moderator who authored the submission must still be denied')
  }

  const rejected = await request(`/api/writing-tasks/${taskId}/review`, {
    method: 'PATCH', cookie: secondWriter.cookie,
    body: { decision: 'rejected', comment: `Needs stronger citations for fixture ${suffix}.` },
  })
  assert.equal(rejected.response.status, 200, JSON.stringify(rejected.data))
  assert.equal(rejected.data.taskStatus, 'open')
  const afterRejection = await db.query(
    `SELECT orders.status AS order_status, orders.execution_state, task.status AS task_status,
            (SELECT count(*)::int FROM article_writing_submissions WHERE task_id = task.id) AS submissions,
            (SELECT count(*)::int FROM article_writing_reviews WHERE task_id = task.id) AS reviews
       FROM article_order_submissions orders JOIN article_writing_tasks task ON task.order_id = orders.id
      WHERE orders.id = $1`, [orderId],
  )
  assert.equal(afterRejection.rows[0].order_status, 'queued')
  assert.equal(afterRejection.rows[0].execution_state, 'community', 'rejected draft must return order from draft_ready to community')
  assert.equal(afterRejection.rows[0].task_status, 'open')
  assert.equal(afterRejection.rows[0].submissions, 1, 'rejected submission remains immutable history')
  assert.equal(afterRejection.rows[0].reviews, 1, 'rejection remains in immutable review history')

  const reclaimed = await request(`/api/writing-tasks/${taskId}/claim`, { method: 'POST', body: { action: 'claim' }, ...writerAuth })
  assert.equal(reclaimed.response.status, 200)
  const acceptedSubmission = await request(`/api/writing-tasks/${taskId}/submissions`, {
    method: 'POST', ...writerAuth,
    body: { ...draft, title: `Accepted AIKI writing fixture ${suffix}`, body: `A revised evidence-backed draft for ${query}, incorporating the review note and preserving public citations.` },
  })
  assert.equal(acceptedSubmission.response.status, 201, JSON.stringify(acceptedSubmission.data))
  assert.equal(acceptedSubmission.data.submission.revision_no, 2)
  const accepted = await request(`/api/writing-tasks/${taskId}/review`, {
    method: 'PATCH', cookie: owner.cookie,
    body: { decision: 'accepted', comment: `Sources and attribution checked for ${suffix}.` },
  })
  assert.equal(accepted.response.status, 200, JSON.stringify(accepted.data))
  assert.equal(accepted.data.taskStatus, 'accepted')
  assert.ok(accepted.data.topic?.path)
  const page = await request(`/api/topics/${encodeURIComponent(accepted.data.topic.path.slice(1))}`)
  assert.equal(page.response.status, 200, JSON.stringify(page.data))
  assert.equal(page.data.title, `Accepted AIKI writing fixture ${suffix}`)
  assert.equal(page.data.citations.length, 1)

  const finished = await request(`/api/article-orders/${orderId}`, { bearer: orderTokens.accessToken })
  assert.equal(finished.data.order.status, 'succeeded')
  const resultPage = await request(`/api/topics/${encodeURIComponent(finished.data.order.resultPath.slice(1))}`)
  assert.equal(resultPage.response.status, 200, JSON.stringify(resultPage.data))
  assert.equal(resultPage.data.id, page.data.id, 'numeric and slug result paths must resolve to the accepted article')
  const auditRecord = await db.query('SELECT 1 FROM article_order_assessments WHERE id = $1', [fixtureIds.assessmentIds[0]])
  assert.equal(auditRecord.rowCount, 1, 'abuse-prevention assessment remains immutable and retained')
  const selfReviewCount = await db.query(
    `SELECT count(*)::int AS count FROM article_writing_reviews
      WHERE task_id = $1 AND reviewer_id = $2`, [taskId, writerActor.id],
  )
  assert.equal(selfReviewCount.rows[0].count, 0, 'self-review attempts must not create review records')
  console.log(`PASS isolated search order → Statica mock → Neron budget fallback → human/agent claim race → reject/revise/accept (${suffix})`)
} finally {
  if (connected) {
    // Order assessments, submissions, reviews, and audit records are immutable by product policy.
    // Their synthetic fixtures therefore intentionally remain only in this disposable database, which must be dropped after the test.
    console.log(`Immutable writing-flow fixtures ${suffix} remain in the named disposable DB; drop the whole DB after acceptance.`)
    await db.end().catch(() => {})
  }
}
