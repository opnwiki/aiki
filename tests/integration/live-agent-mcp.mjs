import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import pg from 'pg'

const base = (process.env.AIKI_LIVE_TEST_BASE_URL || '').replace(/\/$/, '')
const confirmation = process.env.AIKI_LIVE_TEST_CONFIRM
const expectedConfirmation = 'I CONFIRM A TEMPORARY AGENT TEST ON AN ISOLATED AIKI SERVER CLONE'
if (!base || confirmation !== expectedConfirmation) {
  throw new Error(`Refusing live writes. Set AIKI_LIVE_TEST_BASE_URL and AIKI_LIVE_TEST_CONFIRM=${JSON.stringify(expectedConfirmation)} after verifying the isolated test environment.`)
}
const origin = new URL(base)
if (origin.protocol !== 'http:' || origin.hostname !== '127.0.0.1' || origin.username || origin.password) {
  throw new Error('This test is restricted to a loopback candidate app; never point it at the public production site.')
}
if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required for precisely scoped cleanup and verification.')
const databaseUrl = new URL(process.env.DATABASE_URL)
const databaseName = decodeURIComponent(databaseUrl.pathname.slice(1))
if (!['localhost', '127.0.0.1', '::1'].includes(databaseUrl.hostname) || !/^aiki_live_test_[a-z0-9_]+$/.test(databaseName)) {
  throw new Error('Refusing to write: DATABASE_URL must point to local PostgreSQL database aiki_live_test_<unique_suffix>.')
}

const suffix = randomBytes(6).toString('hex')
const ownerName = `live-test-owner-${suffix}`
const agentName = `live-test-agent-${suffix}`
const password = `AIKI-Live-Test-${randomBytes(24).toString('base64url')}`
const title = `Temporary AIKI agent acceptance ${suffix}`
const sourceUrl = `https://example.org/aiki-live-test-${suffix}`
let ownerId
let agentId
let topicId
let ownerCookie
let agentKey
let failure
let cleanupVerified = false
const db = new pg.Client({ connectionString: process.env.DATABASE_URL })
let dbConnected = false

async function request(path, { method = 'GET', body, cookie, bearer } = {}) {
  const headers = { accept: 'application/json' }
  if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(method.toUpperCase())) headers.origin = origin.origin
  if (body !== undefined) headers['content-type'] = 'application/json'
  if (cookie) headers.cookie = cookie
  if (bearer) headers.authorization = `Bearer ${bearer}`
  const response = await fetch(`${base}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    redirect: 'manual',
    signal: AbortSignal.timeout(20_000),
  })
  const text = await response.text()
  let data = null
  try { data = text ? JSON.parse(text) : null } catch { data = text }
  return { response, data }
}

async function mcpCall(id, name, args = {}) {
  const result = await request('/mcp', {
    method: 'POST', bearer: agentKey,
    body: { jsonrpc: '2.0', id, method: 'tools/call', params: { name, arguments: args } },
  })
  assert.equal(result.response.status, 200, JSON.stringify(result.data))
  assert.equal(result.data?.result?.isError, false, JSON.stringify(result.data))
  return result.data.result.structuredContent
}

try {
  await db.connect()
  dbConnected = true
  const health = await request('/api/health')
  assert.equal(health.response.status, 200, JSON.stringify(health.data))
  assert.equal(health.data?.status, 'ok')
  assert.equal(health.data?.database, 'ok')

  const registration = await request('/api/auth/register', {
    method: 'POST', body: { username: ownerName, email: `${ownerName}@example.invalid`, password },
  })
  assert.equal(registration.response.status, 201, JSON.stringify(registration.data))
  ownerId = registration.data.actor.id
  assert.equal(registration.data.actor.role, 'owner', 'live agent enrollment needs node-owner authorization')
  const token = (registration.response.headers.get('set-cookie') || '').match(/(?:^|,\s*)aiki_session=([^;,]+)/)?.[1]
  assert.ok(token, 'registration must issue an authenticated session')
  ownerCookie = `aiki_session=${token}`

  const enrollment = await request('/api/agents', { method: 'POST', cookie: ownerCookie, body: { username: agentName } })
  assert.equal(enrollment.response.status, 201, JSON.stringify(enrollment.data))
  agentId = enrollment.data.actor.id
  agentKey = enrollment.data.api_key
  assert.equal(enrollment.data.actor.kind, 'agent')
  assert.equal(enrollment.data.actor.role, 'member')
  assert.match(agentKey, /^aiki_agent_[A-Za-z0-9_-]{43}$/)

  const status = await mcpCall(1, 'aiki_status')
  assert.equal(status.actor.id, agentId)
  assert.equal(status.actor.username, agentName)
  assert.ok(status.capabilities.includes('create_article'))

  const created = await mcpCall(2, 'aiki_create_article', {
    title,
    summary: 'Temporary live acceptance fixture; deleted after verification.',
    body: `This temporary article verifies authenticated agent publishing against the live AIKI service. Fixture ${suffix}.\n\n## Verification\n\nThe agent creates this article, the canonical page is read publicly, then the fixture is removed.`,
    locale: 'en',
    authorshipMode: 'ai_generated_human_reviewed',
    rulesConsent: true,
    modelName: 'AIKI live acceptance agent (test fixture)',
    sources: [{ url: sourceUrl, title: `Temporary source ${suffix}`, publisher: 'Example.org' }],
  })
  topicId = created.id
  assert.ok(topicId)
  assert.equal(created.kind, 'article')
  assert.match(created.canonical_path, /^\/\d+$/)
  assert.equal(created.revision.authorship_mode, 'ai_generated_human_reviewed')
  assert.equal(created.revision.model_name, 'AIKI live acceptance agent (test fixture)')

  const byAgent = await mcpCall(3, 'aiki_get_article', { slug: created.slug, locale: 'en' })
  assert.equal(byAgent.slug, created.slug)
  assert.equal(byAgent.author, agentName)
  assert.equal(byAgent.model_name, 'AIKI live acceptance agent (test fixture)')
  assert.equal(byAgent.citations.length, 1)

  const publicPage = await fetch(new URL(created.canonical_path, origin), { signal: AbortSignal.timeout(20_000) })
  const publicHtml = await publicPage.text()
  assert.equal(publicPage.status, 200)
  assert.match(String(publicPage.headers.get('content-type')), /text\/html/i)
  assert.match(publicHtml, /AIKI live acceptance agent/)
  const publicApi = await request(`/api/topics/${encodeURIComponent(created.slug)}`)
  assert.equal(publicApi.response.status, 200, JSON.stringify(publicApi.data))
  assert.equal(publicApi.data.author, agentName)
  assert.equal(publicApi.data.citations.length, 1)

  const agents = await request('/api/agents', { cookie: ownerCookie })
  assert.equal(agents.response.status, 200)
  const listed = agents.data.agents.find(agent => agent.id === agentId)
  assert.ok(listed)
  assert.equal(Object.hasOwn(listed, 'api_key'), false)
  console.log(`PASS live agent publishing: account session, agent enrollment, MCP status/create/read, page ${created.canonical_path}, public source and authorship`)
} catch (error) {
  failure = error
} finally {
  if (dbConnected) {
    if (topicId) {
      await db.query('DELETE FROM topics WHERE id = $1', [topicId]).catch(error => { failure ||= error })
      await db.query('DELETE FROM sources s WHERE s.canonical_url = $1 AND NOT EXISTS (SELECT 1 FROM citations c WHERE c.source_id = s.id)', [sourceUrl]).catch(error => { failure ||= error })
      const pageLeft = await db.query('SELECT 1 FROM topics WHERE id = $1', [topicId]).catch(error => { failure ||= error; return { rowCount: 1 } })
      if (pageLeft.rowCount) failure ||= new Error('Temporary article cleanup could not be verified.')
    }
    if (ownerId && agentId) {
      const revoked = await request(`/api/agents/${agentId}`, { method: 'DELETE', cookie: ownerCookie }).catch(error => { failure ||= error; return null })
      if (revoked && ![200, 404].includes(revoked.response.status)) failure ||= new Error(`Agent key revocation returned ${revoked.response.status}.`)
    }
    if (agentId) {
      await db.query('DELETE FROM actors WHERE id = $1 AND kind = $2', [agentId, 'agent']).catch(error => { failure ||= error })
      const agentLeft = await db.query('SELECT 1 FROM actors WHERE id = $1 AND kind = $2', [agentId, 'agent']).catch(error => { failure ||= error; return { rowCount: 1 } })
      if (agentLeft.rowCount) failure ||= new Error('Temporary agent account cleanup could not be verified.')
    }
    if (ownerId) {
      await db.query('DELETE FROM actors WHERE id = $1 AND kind = $2', [ownerId, 'human']).catch(error => { failure ||= error })
      const ownerLeft = await db.query('SELECT 1 FROM actors WHERE id = $1 AND kind = $2', [ownerId, 'human']).catch(error => { failure ||= error; return { rowCount: 1 } })
      if (ownerLeft.rowCount) failure ||= new Error('Temporary owner account cleanup could not be verified.')
    }
    cleanupVerified = Boolean((!topicId || !(await db.query('SELECT 1 FROM topics WHERE id = $1', [topicId])).rowCount)
      && (!agentId || !(await db.query('SELECT 1 FROM actors WHERE id = $1', [agentId])).rowCount)
      && (!ownerId || !(await db.query('SELECT 1 FROM actors WHERE id = $1', [ownerId])).rowCount)
      && !(await db.query('SELECT 1 FROM sources WHERE canonical_url = $1', [sourceUrl])).rowCount)
    await db.end().catch(error => { failure ||= error })
  } else {
    await db.end().catch(() => {})
  }
  if (failure) console.error(`Live test cleanup verified=${cleanupVerified}: ${failure.message}`)
}

if (failure) throw failure
if (!cleanupVerified) throw new Error('Live acceptance did not verify cleanup of its temporary owner, agent, article, and source.')
console.log('PASS live test cleanup: temporary owner, agent, article, and unique source deleted and verified')
console.log('Repeatable test source retained in tests/integration/live-agent-mcp.mjs.')
