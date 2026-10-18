import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { readSuggestedTags, parseTopicAiResult } from '../../server/utils/topic-ai.js'
import { loadAgentProvider, normalizeAgentProviderConfig, presentAgentProviderConfig } from '../../server/utils/agent-provider.js'
import { parseCloudBilling, readAgentProviderBilling } from '../../server/utils/agent-provider-billing.js'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')

export async function run({ assert }) {
  assert.deepEqual(normalizeAgentProviderConfig({ mode: 'disabled' }).value, { mode: 'disabled' })
  const direct = normalizeAgentProviderConfig({ mode: 'neron', endpoint: 'http://127.0.0.1:4040', apiKey: 'loopback-secret' })
  assert.equal(direct.ok, true)
  assert.equal(direct.value.format, 'task_json')
  const splitModels = normalizeAgentProviderConfig({ mode: 'neron', endpoint: 'http://127.0.0.1:4040', apiKey: 'loopback-secret', model: 'neron-agent', fastModel: 'openai/gpt-6-luna' })
  assert.equal(splitModels.value.model, 'neron-agent')
  assert.equal(splitModels.value.fastModel, 'openai/gpt-6-luna')
  const cloud = normalizeAgentProviderConfig({ mode: 'aiki_cloud', serviceToken: 'legacy-cloud-secret' })
  assert.equal(cloud.ok, true)
  assert.deepEqual(cloud.value, { mode: 'aiki_cloud' })
  assert.deepEqual(normalizeAgentProviderConfig({ mode: 'aiki_cloud' }).value, { mode: 'aiki_cloud' })
  const custom = normalizeAgentProviderConfig({ mode: 'custom', endpoint: 'https://ai.example.test/v1', apiKey: 'custom-secret', model: 'writer-1', fastModel: 'fast-1', format: 'openai_chat' })
  assert.equal(custom.ok, true)
  assert.equal(custom.value.model, 'writer-1')
  assert.equal(custom.value.fastModel, 'fast-1')
  assert.equal(normalizeAgentProviderConfig({ mode: 'custom', endpoint: 'http://127.0.0.1:4040', apiKey: 'custom-secret', model: 'writer-1', format: 'unknown' }).ok, false)
  assert.equal(normalizeAgentProviderConfig({ mode: 'neron', endpoint: 'https://example.test', apiKey: '' }, direct.value).value.apiKey, 'loopback-secret')
  assert.equal(normalizeAgentProviderConfig({ mode: 'neron', endpoint: 'http://169.254.169.254', apiKey: 'loopback-secret' }).ok, false)

  const presented = presentAgentProviderConfig(custom.value)
  assert.equal(presented.keySet, true)
  assert.equal(presented.fastModel, 'fast-1')
  assert.equal('apiKey' in presented, false)
  assert.equal('serviceToken' in presentAgentProviderConfig(cloud.value), false)

  const requests = []
  const provider = await loadAgentProvider({
    async query() {
      return { rows: [{ agent_provider_config: custom.value }] }
    },
  }, {}, async (url, options) => {
    requests.push({ url, options })
    return new Response(JSON.stringify({ choices: [{ message: { content: '{"kind":"article"}' } }] }), { status: 200 })
  })
  const task = await provider.start({ prompt: 'write', requestId: 'request-1' })
  assert.equal(task.status, 'completed')
  assert.deepEqual(task.result, { kind: 'article' })
  assert.deepEqual(task.providerResponse, { choices: [{ message: { content: '{"kind":"article"}' } }] })
  assert.equal(requests[0].url, 'https://ai.example.test/v1/chat/completions')
  assert.equal(requests[0].options.headers.authorization, 'Bearer custom-secret')
  assert.equal(requests[0].options.body.includes('"model":"writer-1"'), true)
  await provider.start({ prompt: 'classify', requestId: 'request-2', requestType: 'classify_page' })
  assert.equal(requests[1].options.body.includes('"model":"fast-1"'), true)
  const repaired = await provider.repairJson({ value: 'malformed answer', schema: '{"kind":"article"}', requestId: 'repair-1' })
  assert.deepEqual(repaired, { kind: 'article' })
  assert.equal(JSON.parse(requests[2].options.body).response_format.type, 'json_object')

  const invalidJsonProvider = await loadAgentProvider({
    async query() {
      return { rows: [{ agent_provider_config: custom.value }] }
    },
  }, {}, async () => new Response('provider body was not JSON', { status: 200 }))
  await assert.rejects(
    invalidJsonProvider.start({ prompt: 'write', requestId: 'invalid-json-request' }),
    (error) => {
      assert.equal(error.status, 502)
      assert.deepEqual(error.providerResponse, { status: 200, body: 'provider body was not JSON' })
      return true
    },
  )

  const invalidResultProvider = await loadAgentProvider({
    async query() {
      return { rows: [{ agent_provider_config: custom.value }] }
    },
  }, {}, async () => new Response(JSON.stringify({ choices: [{ message: { content: 'not valid result JSON' } }] }), { status: 200 }))
  await assert.rejects(
    invalidResultProvider.start({ prompt: 'write', requestId: 'invalid-result-request' }),
    (error) => {
      assert.equal(error.status, 422)
      assert.deepEqual(error.providerResponse, { choices: [{ message: { content: 'not valid result JSON' } }] })
      return true
    },
  )

  // Neron runs only its agent through /tasks; the fast model is a chat call.
  const neronRequests = []
  const neron = await loadAgentProvider({
    async query() {
      return { rows: [{ agent_provider_config: { mode: 'neron', endpoint: 'https://neron.example/api/neron/v1', apiKey: 'neron-secret', format: 'task_json', model: 'neron-agent', fastModel: 'openai/gpt-6-luna' } }] }
    },
  }, {}, async (url, options) => {
    neronRequests.push({ url, options })
    return url.endsWith('/tasks')
      ? new Response(JSON.stringify({ task: { id: 'task-1', status: 'queued' } }), { status: 202 })
      : new Response(JSON.stringify({ choices: [{ message: { content: '```json\n{"kind":"question"}\n```' } }] }), { status: 200 })
  })
  const classified = await neron.start({ prompt: 'classify', requestId: 'request-3', requestType: 'classify_page' })
  assert.equal(neronRequests[0].url, 'https://neron.example/api/neron/v1/chat/completions')
  assert.equal(neronRequests[0].options.body.includes('"model":"openai/gpt-6-luna"'), true)
  assert.equal(classified.status, 'completed')
  assert.deepEqual(classified.result, { kind: 'question' })
  const agentTask = await neron.start({ prompt: 'write', requestId: 'request-4', requestType: 'research' })
  assert.equal(neronRequests[1].url, 'https://neron.example/api/neron/v1/tasks')
  assert.equal(neronRequests[1].options.body.includes('"model":"neron-agent"'), true)
  assert.equal(agentTask.status, 'queued')

  assert.deepEqual(parseCloudBilling({ balance: { amount: '7', ticker: 'WPG' }, topUpUrl: 'https://aiki.wiki/billing/invoice/1' }), {
    ticker: 'WPG', balance: 7, status: 'available', topUpUrl: 'https://aiki.wiki/billing/invoice/1',
  })
  assert.equal(parseCloudBilling({ balance: 7, topUpUrl: 'http://unsafe.example.test/top-up' }).topUpUrl, undefined)
  assert.deepEqual(parseCloudBilling({ balance: 7, ticker: 'NAI' }), { ticker: 'WPG', balance: null, status: 'unavailable' })
  const billingRequests = []
  const cloudBilling = await readAgentProviderBilling({
    async query() {
      return { rows: [{ agent_provider_config: { mode: 'aiki_cloud' } }] }
    },
  }, { aikiCloudApiBase: 'https://aiki.wiki/api/aiki-cloud/v1', public: { nodeDomain: 'node.example', siteUrl: 'https://node.example' } }, async (url, options) => {
    billingRequests.push({ url, options })
    return new Response(JSON.stringify({ balance: { amount: 12, ticker: 'WPG' }, topUpUrl: 'https://aiki.wiki/top-up' }), { status: 200 })
  })
  assert.deepEqual(cloudBilling, { mode: 'aiki_cloud', ticker: 'WPG', balance: 12, status: 'available', topUpUrl: 'https://aiki.wiki/top-up' })
  assert.equal(billingRequests[0].url, 'https://aiki.wiki/api/aiki-cloud/v1/billing')
  assert.equal(billingRequests[0].options.headers['x-aiki-node-domain'], 'node.example')
  assert.deepEqual(await readAgentProviderBilling({
    async query() { return { rows: [{ agent_provider_config: { mode: 'neron', endpoint: 'https://neron.example', apiKey: 'secret' } }] } },
  }), { mode: 'neron', ticker: 'NAI', balance: null, status: 'not_configured' })

  const cloudRequests = []
  const cloudProvider = await loadAgentProvider({
    async query() {
      return { rows: [{ agent_provider_config: { mode: 'aiki_cloud', serviceToken: 'legacy-cloud-secret' } }] }
    },
  }, { public: { nodeDomain: 'node.example', siteUrl: 'https://node.example' } }, async (url, options) => {
    cloudRequests.push({ url, options })
    return new Response(JSON.stringify({ task: { id: 'cloud-task', status: 'queued' } }), { status: 200 })
  })
  await cloudProvider.start({ prompt: 'write', requestId: 'cloud-request' })
  assert.equal(cloudRequests[0].options.headers.authorization, undefined)
  assert.equal(cloudRequests[0].options.headers['x-aiki-node-domain'], 'node.example')
  assert.equal(cloudRequests[0].options.headers['x-aiki-node-url'], 'https://node.example')

  const migration = await readFile(path.join(root, 'database/migrations/052_agent_provider_config.sql'), 'utf8')
  assert.match(migration, /agent_provider_config JSONB/)
  assert.match(migration, /provider_result JSONB/)
  const providerResponseMigration = await readFile(path.join(root, 'database/migrations/073_provider_responses.sql'), 'utf8')
  assert.match(providerResponseMigration, /topic_ai_requests[\s\S]*provider_response JSONB/)
  assert.match(providerResponseMigration, /article_order_submissions[\s\S]*provider_response JSONB/)
  assert.match(providerResponseMigration, /writing_task_agent_runs[\s\S]*provider_response JSONB/)
  const admin = await readFile(path.join(root, 'app/pages/admin.vue'), 'utf8')
  assert.match(admin, /data-testid="admin-agent-provider"/)
  assert.match(admin, /data-testid="admin-ai-settings"/)
  assert.match(admin, /data-testid="agent-provider-mode"/)
  assert.match(admin, /data-testid="agent-provider-fast-model"/)
  assert.doesNotMatch(admin, /agentProviderServiceToken/)
  assert.doesNotMatch(admin, /serviceToken:/)
  const migration055 = await readFile(path.join(root, 'database/migrations/055_agent_cloud_identity.sql'), 'utf8')
  assert.match(migration055, /agent_provider_config - 'serviceToken'/)
  const executor = await readFile(path.join(root, 'server/utils/article-order-executor.js'), 'utf8')
  assert.match(executor, /loadAgentProvider/)
  assert.match(executor, /provider_result/)
  assert.match(executor, /requestType: 'article'/)
  const writingExecutor = await readFile(path.join(root, 'server/utils/writing-task-agent-executor.js'), 'utf8')
  assert.match(writingExecutor, /requestType: 'agent_task'/)
  assert.match(writingExecutor, /VALUES \(\$1, NULLIF\(\$2::text, ''\), NULLIF\(\$3::text, ''\), 'external', \$4::date\)/)
  assert.doesNotMatch(writingExecutor, /\$6::date/)
  const topicExecutor = await readFile(path.join(root, 'server/utils/topic-ai-request-executor.js'), 'utf8')
  assert.match(topicExecutor, /requestType: request\.request_type/)

  // The fast model also suggests tags; bad ones are dropped, never fatal.
  const classifiedPage = parseTopicAiResult({ reply: '{"kind":"question","reason":"asks","tags":["мемы","#Интернет-культура","мемы","",42]}' }, 'classify_page')
  assert.deepEqual(classifiedPage.tags.map(tag => tag.label), ['мемы', 'Интернет-культура'])
  assert.deepEqual(readSuggestedTags(classifiedPage.tags).map(tag => tag.slug), ['мемы', 'интернет-культура'], 'parsed tags survive a second pass')
  assert.equal(readSuggestedTags(['a', 'b', 'c', 'd', 'e', 'f', 'g']).length, 6)
  assert.deepEqual(parseTopicAiResult({ reply: '{"kind":"article"}' }, 'classify_page').tags, [])
}
