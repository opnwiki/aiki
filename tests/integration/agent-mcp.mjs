import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import pg from 'pg'
import { promoteDisposableOwner } from '../support/disposable-owner.mjs'

const base = (process.env.AIKI_TEST_BASE_URL || '').replace(/\/$/, '')
if (!base) throw new Error('Set AIKI_TEST_BASE_URL to an isolated test server URL')
const origin = new URL(base).origin
const suffix = randomBytes(5).toString('hex')
const password = `AIKI-agent-${randomBytes(18).toString('base64url')}`
const ownerName = `mcp-owner-${suffix}`
const agentName = `mcp-agent-${suffix}`
const memberName = `mcp-member-${suffix}`
let ownerId
let memberId
let agentId
let topicId
let agentKey

async function request(path, { method = 'GET', body, cookie, bearer } = {}) {
  const headers = { accept: 'application/json' }
  if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(method.toUpperCase())) headers.origin = origin
  if (body !== undefined) headers['content-type'] = 'application/json'
  if (cookie) headers.cookie = cookie
  if (bearer) headers.authorization = `Bearer ${bearer}`
  const response = await fetch(`${base}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), redirect: 'manual' })
  const text = await response.text()
  let data = null
  try { data = text ? JSON.parse(text) : null } catch { data = text }
  return { response, data }
}

const db = new pg.Client({ connectionString: process.env.DATABASE_URL })
try {
  await db.connect()
  const registration = await request('/api/auth/register', {
    method: 'POST',
    body: { username: ownerName, email: `${ownerName}@example.org`, password },
  })
  assert.equal(registration.response.status, 201, JSON.stringify(registration.data))
  const token = (registration.response.headers.get('set-cookie') || '').match(/(?:^|,\s*)aiki_session=([^;,]+)/)?.[1]
  assert.ok(token)
  const ownerCookie = `aiki_session=${token}`
  ownerId = registration.data.actor.id
  const memberRegistration = await request('/api/auth/register', {
    method: 'POST', body: { username: memberName, email: `${memberName}@example.org`, password },
  })
  assert.equal(memberRegistration.response.status, 201, JSON.stringify(memberRegistration.data))
  memberId = memberRegistration.data.actor.id
  const memberToken = (memberRegistration.response.headers.get('set-cookie') || '').match(/(?:^|,\s*)aiki_session=([^;,]+)/)?.[1]
  assert.ok(memberToken)
  const memberCookie = `aiki_session=${memberToken}`
  if (!['owner', 'admin'].includes(registration.data.actor.role)) {
    await promoteDisposableOwner(ownerId, db)
  }

  const enrollment = await request('/api/agents', {
    method: 'POST',
    body: { name: 'MCP test agent', model: 'MCP test model 1.0', username: agentName, email: `${agentName}@example.org` },
  })
  assert.equal(enrollment.response.status, 201, JSON.stringify(enrollment.data))
  assert.match(enrollment.data.api_key, /^aiki_agent_[A-Za-z0-9_-]{43}$/)
  assert.equal(enrollment.data.actor.kind, 'agent')
  assert.equal(enrollment.data.actor.role, 'member')
  assert.equal(enrollment.data.actor.agent_name, 'MCP test agent')
  assert.equal(enrollment.data.actor.agent_model, 'MCP test model 1.0')
  agentId = enrollment.data.actor.id
  agentKey = enrollment.data.api_key

  const missingKey = await request('/mcp', { method: 'POST', body: { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} } })
  assert.equal(missingKey.response.status, 401, 'MCP requests without a key must fail')
  const invalidKey = await request('/mcp', { method: 'POST', bearer: 'aiki_agent_invalid', body: { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} } })
  assert.equal(invalidKey.response.status, 401, 'malformed or unknown MCP keys must fail')
  const deniedListing = await request('/api/agents', { cookie: memberCookie })
  assert.equal(deniedListing.response.status, 403, 'ordinary members must not list agents')
  const deniedRotation = await request(`/api/agents/${agentId}/key`, { method: 'POST', cookie: memberCookie, body: {} })
  assert.equal(deniedRotation.response.status, 403, 'ordinary members must not rotate agent keys')
  const deniedRevocation = await request(`/api/agents/${agentId}`, { method: 'DELETE', cookie: memberCookie })
  assert.equal(deniedRevocation.response.status, 403, 'ordinary members must not revoke agent keys')

  const initialize = await request('/mcp', { method: 'POST', bearer: agentKey, body: { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'test-agent', version: '1' } } } })
  assert.equal(initialize.response.status, 200, JSON.stringify(initialize.data))
  assert.equal(initialize.data.result.serverInfo.name, 'aiki-agent-api')
  const status = await request('/mcp', { method: 'POST', bearer: agentKey, body: { jsonrpc: '2.0', id: 7, method: 'tools/call', params: { name: 'aiki_status', arguments: {} } } })
  assert.equal(status.data.result.structuredContent.actor.id, agentId)

  const tools = await request('/mcp', { method: 'POST', bearer: agentKey, body: { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} } })
  assert.equal(tools.response.status, 200)
  const createTool = tools.data.result.tools.find(tool => tool.name === 'aiki_create_article')
  assert.ok(createTool)
  assert.equal(createTool.inputSchema.required.includes('modelName'), false, 'modelName must be conditional for human-only writing')
  assert.ok(createTool.inputSchema.properties.modelName.description.includes('omit for human_only'))
  assert.ok(tools.data.result.tools.find(tool => tool.name === 'aiki_search_articles').inputSchema.properties.locale)
  assert.ok(tools.data.result.tools.find(tool => tool.name === 'aiki_get_article').inputSchema.properties.locale)
  assert.ok(tools.data.result.tools.find(tool => tool.name === 'aiki_propose_article_edit'))
  const replyTool = tools.data.result.tools.find(tool => tool.name === 'aiki_create_reply')
  assert.ok(replyTool)
  assert.ok(replyTool.inputSchema.properties.source.properties.url)
    assert.equal(replyTool.inputSchema.required.includes('locale'), true, 'reply locale must be required so the reply language is known and federated')
  assert.ok(status.data.result.structuredContent.capabilities.includes('propose_article_edit'))
  assert.ok(status.data.result.structuredContent.capabilities.includes('create_reply'))

  const created = await request('/mcp', {
    method: 'POST', bearer: agentKey,
    body: {
      jsonrpc: '2.0', id: 3, method: 'tools/call',
      params: { name: 'aiki_create_article', arguments: {
        title: `MCP Article ${suffix}`,
        body: 'This is a sufficiently detailed article body created through the authenticated AIKI Model Context Protocol tool for an isolated test.',
        summary: 'MCP publishing integration fixture.',
        locale: 'en',
        authorshipMode: 'ai_generated_human_reviewed',
        modelName: 'MCP test model 1.0',
        rulesConsent: true,
        sources: [{ url: `https://example.org/mcp-${suffix}`, title: 'MCP test source', publisher: 'Example' }],
      } },
    },
  })
  assert.equal(created.response.status, 200, JSON.stringify(created.data))
  assert.equal(created.data.result.isError, false)
  const article = created.data.result.structuredContent
  assert.equal(article.kind, 'article')
  assert.match(article.canonical_path, /^\/\d+$/)
  assert.equal(article.revision.locale, 'en')
  assert.equal(article.revision.model_name, 'MCP test model 1.0')
  assert.equal(article.revision.authorship_mode, 'ai_generated_human_reviewed')
  topicId = article.id

  const readTool = await request('/mcp', { method: 'POST', bearer: agentKey, body: { jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'aiki_get_article', arguments: { slug: article.slug, locale: 'en' } } } })
  assert.equal(readTool.response.status, 200)
  assert.equal(readTool.data.result.structuredContent.author, agentName)
  assert.equal(readTool.data.result.structuredContent.locale, 'en')
  assert.equal(readTool.data.result.structuredContent.authorship_mode, 'ai_generated_human_reviewed')
  assert.equal(readTool.data.result.structuredContent.model_name, 'MCP test model 1.0')
  assert.equal(readTool.data.result.structuredContent.citations.length, 1)

  const publicPage = await request(`/api/topics/${encodeURIComponent(article.slug)}`)
  assert.equal(publicPage.response.status, 200)
  assert.equal(publicPage.data.access, 'public')
  assert.equal(publicPage.data.author, agentName)
  assert.equal(publicPage.data.authorship_mode, 'ai_generated_human_reviewed')
  assert.equal(publicPage.data.model_name, 'MCP test model 1.0')
  assert.equal(publicPage.data.citations.length, 1)

  const proposedBody = 'An agent proposal adds a carefully qualified paragraph and cites the evidence already reviewed by the current article author.'
  const proposalResponse = await request('/mcp', {
    method: 'POST', bearer: agentKey,
    body: { jsonrpc: '2.0', id: 13, method: 'tools/call', params: { name: 'aiki_propose_article_edit', arguments: {
      slug: article.slug,
      baseRevisionId: article.revision.id,
      locale: 'en',
      proposedBody,
      rationale: 'Clarify a limitation using evidence already included with the article.',
    } } },
  })
  assert.equal(proposalResponse.response.status, 200, JSON.stringify(proposalResponse.data))
  assert.equal(proposalResponse.data.result.isError, false, JSON.stringify(proposalResponse.data))
  const proposal = proposalResponse.data.result.structuredContent.proposal
  assert.equal(proposal.status, 'open')
  assert.equal(proposal.author_id, agentId)
  assert.equal(proposal.base_revision_id, article.revision.id)
  const reviewPath = proposalResponse.data.result.structuredContent.review_path
  assert.equal(reviewPath.toLowerCase(), `/${article.slug}`.toLowerCase(), 'page codes resolve without regard to letter case')
  const reviewPage = await request(`/api/topics/${encodeURIComponent(reviewPath.slice(1))}`)
  assert.equal(reviewPage.response.status, 200)
  assert.equal(reviewPage.data.id, article.id, 'the returned review address must resolve to the original article')
  const visibleProposals = await request(`/api/topics/${encodeURIComponent(article.slug)}/proposals`)
  assert.equal(visibleProposals.response.status, 200)
  assert.equal(visibleProposals.data.items.some(item => item.id === proposal.id && item.author === agentName), true)
  const pageAfterProposal = await request(`/api/topics/${encodeURIComponent(article.slug)}`)
  assert.equal(pageAfterProposal.data.revision_id, article.revision.id, 'a proposal must not directly edit the published article')

  const replyResponse = await request('/mcp', {
    method: 'POST', bearer: agentKey,
    body: { jsonrpc: '2.0', id: 16, method: 'tools/call', params: { name: 'aiki_create_reply', arguments: {
      slug: article.slug,
      body: `Agent discussion reply ${suffix}: explains a useful implication and points readers to the cited source.`,
      locale: 'en',
      source: { url: `https://example.org/reply-${suffix}`, title: 'Agent reply source', publisher: 'Example', locator: 'section 2' },
    } } },
  })
  assert.equal(replyResponse.response.status, 200, JSON.stringify(replyResponse.data))
  assert.equal(replyResponse.data.result.isError, false, JSON.stringify(replyResponse.data))
  const createdReply = replyResponse.data.result.structuredContent.reply
  assert.equal(createdReply.author_id, agentId)
  assert.equal(createdReply.topic_id, article.id)
  assert.equal(createdReply.locale, 'en')
  assert.equal(replyResponse.data.result.structuredContent.citation_attached, true)
  const publicPageAfterReply = await request(`/api/topics/${encodeURIComponent(article.slug)}`)
  assert.equal(publicPageAfterReply.response.status, 200)
  const publicReply = publicPageAfterReply.data.replies.find(reply => reply.id === createdReply.id)
  assert.equal(Boolean(publicReply && publicReply.author === agentName), true)
  assert.equal(publicReply.citations.length, 1)
  assert.equal(publicReply.citations[0].canonical_url, `https://example.org/reply-${suffix}`)
  const readAfterReply = await request('/mcp', { method: 'POST', bearer: agentKey, body: { jsonrpc: '2.0', id: 19, method: 'tools/call', params: { name: 'aiki_get_article', arguments: { slug: article.slug, locale: 'en' } } } })
  assert.equal(readAfterReply.response.status, 200)
  const agentReply = readAfterReply.data.result.structuredContent.replies.find(reply => reply.id === createdReply.id)
  assert.equal(agentReply.citations.length, 1)
  assert.equal(agentReply.citations[0].canonical_url, `https://example.org/reply-${suffix}`)
  const replyCitation = await db.query(
    `SELECT count(*)::int AS count
       FROM citations c JOIN sources s ON s.id = c.source_id
      WHERE c.reply_id = $1 AND s.canonical_url = $2`,
    [createdReply.id, `https://example.org/reply-${suffix}`],
  )
  assert.equal(replyCitation.rows[0].count, 1, 'reply citation must be committed with the reply')

  const missingTopicReply = await request('/mcp', {
    method: 'POST', bearer: agentKey,
    body: { jsonrpc: '2.0', id: 17, method: 'tools/call', params: { name: 'aiki_create_reply', arguments: {
      slug: `missing-${suffix}`, body: 'A reply to a topic slug that does not exist should not be inserted.', locale: 'en',
    } } },
  })
  assert.equal(missingTopicReply.data.result.isError, true)
  const spoofedReply = await request('/mcp', {
    method: 'POST', bearer: agentKey,
    body: { jsonrpc: '2.0', id: 18, method: 'tools/call', params: { name: 'aiki_create_reply', arguments: {
      slug: article.slug, body: 'A reply cannot assign itself to a different actor.', locale: 'en', actorId: ownerId,
    } } },
  })
  assert.equal(spoofedReply.data.result.isError, true, 'reply author identity must not be caller-controlled')
  const invalidReplySource = await request('/mcp', {
    method: 'POST', bearer: agentKey,
    body: { jsonrpc: '2.0', id: 19, method: 'tools/call', params: { name: 'aiki_create_reply', arguments: {
      slug: article.slug, body: 'A reply with a private-network citation URL must be rejected.', locale: 'en', source: { url: 'http://127.0.0.1/private' },
    } } },
  })
  assert.equal(invalidReplySource.data.result.isError, true, 'reply source URLs must pass public HTTP(S) citation validation')

  const staleProposal = await request('/mcp', {
    method: 'POST', bearer: agentKey,
    body: { jsonrpc: '2.0', id: 14, method: 'tools/call', params: { name: 'aiki_propose_article_edit', arguments: {
      slug: article.slug,
      baseRevisionId: '00000000-0000-4000-8000-000000000000',
      locale: 'en',
      proposedBody,
      rationale: 'Exercise fail-closed stale revision handling.',
    } } },
  })
  assert.equal(staleProposal.response.status, 200)
  assert.equal(staleProposal.data.result.isError, true, 'a stale or unknown base revision must not create a proposal')

  const fakeProposalActor = await request('/mcp', {
    method: 'POST', bearer: agentKey,
    body: { jsonrpc: '2.0', id: 15, method: 'tools/call', params: { name: 'aiki_propose_article_edit', arguments: {
      slug: article.slug,
      baseRevisionId: article.revision.id,
      locale: 'en',
      proposedBody,
      rationale: 'The proposal must be attributed to the authenticated agent only.',
      actorId: ownerId,
    } } },
  })
  assert.equal(fakeProposalActor.data.result.isError, true, 'proposal actor identity must not be caller-controlled')

  const alternateRevision = await db.query(
    `INSERT INTO revisions (topic_id, source_revision_id, author_id, locale, title, body_markdown, authorship_mode, model_name)
     VALUES ($1, $2, $3, 'ru', 'MCP локализованная статья', 'Localized article content stored for testing locale-aware MCP access.', 'ai_generated_human_reviewed', 'MCP test model 1.0')
     RETURNING id`,
    [article.id, article.revision.id, agentId],
  )
  await db.query('INSERT INTO topic_current_revisions (topic_id, locale, revision_id) VALUES ($1, $2, $3)', [article.id, 'ru', alternateRevision.rows[0].id])
  const localizedRead = await request('/mcp', { method: 'POST', bearer: agentKey, body: { jsonrpc: '2.0', id: 10, method: 'tools/call', params: { name: 'aiki_get_article', arguments: { slug: article.slug, locale: 'ru' } } } })
  assert.equal(localizedRead.response.status, 200)
  assert.equal(localizedRead.data.result.structuredContent.locale, 'ru')
  assert.equal(localizedRead.data.result.structuredContent.title, 'MCP локализованная статья')
  // MCP articles start by link; public search needs an explicitly public fixture.
  await db.query("UPDATE topics SET status = 'published' WHERE id = $1", [article.id])
  const localizedSearch = await request('/mcp', { method: 'POST', bearer: agentKey, body: { jsonrpc: '2.0', id: 12, method: 'tools/call', params: { name: 'aiki_search_articles', arguments: { query: 'Localized article content', locale: 'ru' } } } })
  assert.equal(localizedSearch.response.status, 200)
  assert.equal(localizedSearch.data.result.structuredContent.items.some(item => item.slug === article.slug), true)
  const invalidLocale = await request('/mcp', { method: 'POST', bearer: agentKey, body: { jsonrpc: '2.0', id: 11, method: 'tools/call', params: { name: 'aiki_get_article', arguments: { slug: article.slug, locale: 'xx' } } } })
  assert.equal(invalidLocale.data.result.isError, true, 'unsupported locales must not silently fall back')

  const humanOnly = await request('/mcp', {
    method: 'POST', bearer: agentKey,
    body: { jsonrpc: '2.0', id: 8, method: 'tools/call', params: { name: 'aiki_create_article', arguments: {
      title: `Human-only Article ${suffix}`,
      body: 'This isolated article is declared to have been authored entirely by a human, with an AI agent carrying the request to the API.',
      locale: 'en',
      authorshipMode: 'human_only',
      humanContribution: 'Written entirely by a human author; the agent only transmitted the supplied text.',
      rulesConsent: true,
      sources: [{ url: `https://example.org/human-${suffix}`, title: 'Human article source' }],
    } } },
  })
  assert.equal(humanOnly.response.status, 200)
  assert.equal(humanOnly.data.result.isError, false, JSON.stringify(humanOnly.data))
  const humanArticle = humanOnly.data.result.structuredContent
  assert.equal(humanArticle.revision.authorship_mode, 'human_only')
  assert.equal(humanArticle.revision.model_name, null)
  await db.query('DELETE FROM topics WHERE id = $1', [humanArticle.id])

  const fakeActorId = await request('/mcp', {
    method: 'POST', bearer: agentKey,
    body: { jsonrpc: '2.0', id: 9, method: 'tools/call', params: { name: 'aiki_create_article', arguments: {
      title: `Spoofed Actor Article ${suffix}`,
      body: 'An invalid attempt to submit an agent actor identifier inside MCP arguments must be rejected by strict schema validation.',
      locale: 'en', authorshipMode: 'ai_generated_unreviewed', modelName: 'Test model 1',
      sources: [{ url: `https://example.org/spoof-${suffix}` }], actorId: ownerId,
    } } },
  })
  assert.equal(fakeActorId.data.result.isError, true, 'MCP caller-provided actor identifiers must not be accepted')

  const list = await request('/api/agents', { cookie: ownerCookie })
  assert.equal(list.response.status, 200)
  const listedAgent = list.data.agents.find(item => item.id === agentId)
  assert.ok(listedAgent)
  assert.equal(Object.hasOwn(listedAgent, 'api_key'), false, 'agent listing must never return a key')
  assert.equal(listedAgent.api_key_last_used_at !== null, true, 'successful MCP usage must update last-used metadata')

  const rotation = await request(`/api/agents/${agentId}/key`, { method: 'POST', cookie: ownerCookie, body: {} })
  assert.equal(rotation.response.status, 201, JSON.stringify(rotation.data))
  assert.match(rotation.data.api_key, /^aiki_agent_[A-Za-z0-9_-]{43}$/)
  assert.equal(rotation.data.agent.id, agentId, 'rotation must preserve stable agent identity')
  const oldKeyCall = await request('/mcp', { method: 'POST', bearer: agentKey, body: { jsonrpc: '2.0', id: 5, method: 'tools/list', params: {} } })
  assert.equal(oldKeyCall.response.status, 401, 'rotation must immediately invalidate the previous key')
  agentKey = rotation.data.api_key

  const selfRotation = await request('/mcp', {
    method: 'POST', bearer: agentKey,
    body: { jsonrpc: '2.0', id: 20, method: 'tools/call', params: { name: 'aiki_rotate_key', arguments: {} } },
  })
  assert.equal(selfRotation.response.status, 200, JSON.stringify(selfRotation.data))
  assert.equal(selfRotation.data.result.isError, false, JSON.stringify(selfRotation.data))
  assert.match(selfRotation.data.result.structuredContent.api_key, /^aiki_agent_[A-Za-z0-9_-]{43}$/)
  assert.equal(selfRotation.data.result.structuredContent.agent.id, agentId)
  const selfOldKeyCall = await request('/mcp', { method: 'POST', bearer: agentKey, body: { jsonrpc: '2.0', id: 21, method: 'tools/list', params: {} } })
  assert.equal(selfOldKeyCall.response.status, 401, 'agent self-rotation must immediately invalidate the previous key')
  agentKey = selfRotation.data.result.structuredContent.api_key
  const selfNewKeyCall = await request('/mcp', { method: 'POST', bearer: agentKey, body: { jsonrpc: '2.0', id: 22, method: 'tools/list', params: {} } })
  assert.equal(selfNewKeyCall.response.status, 200, JSON.stringify(selfNewKeyCall.data))

  const revoke = await request(`/api/agents/${agentId}`, { method: 'DELETE', cookie: ownerCookie })
  assert.equal(revoke.response.status, 200, JSON.stringify(revoke.data))
  const revokedCall = await request('/mcp', { method: 'POST', bearer: agentKey, body: { jsonrpc: '2.0', id: 6, method: 'tools/list', params: {} } })
  assert.equal(revokedCall.response.status, 401, 'revoked keys must stop authenticating')
  console.log(`PASS isolated agent/MCP integration: public registration, one-time key, MCP initialize/tools, article/source publishing, slug reading, metadata listing, key rotation and revocation (${article.slug})`)
} finally {
  if (topicId) await db.query('DELETE FROM topics WHERE id = $1', [topicId]).catch(() => {})
  if (agentId) await db.query('DELETE FROM actors WHERE id = $1', [agentId]).catch(() => {})
  if (memberId) await db.query('DELETE FROM actors WHERE id = $1', [memberId]).catch(() => {})
  if (ownerId) await db.query('DELETE FROM actors WHERE id = $1', [ownerId]).catch(() => {})
  await db.end().catch(() => {})
}
