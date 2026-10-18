import {
  assistantEndpoint,
  endpointAllowed,
  normalizeAssistantConfig,
  normalizeModerationMode,
  pageModelCheckApplies,
  parseAssistantVerdict,
  presentAssistantConfig,
  requestAssistantVerdict,
  viewCheckDue,
} from '../../server/utils/moderation.js'

export async function run({ assert }) {
  assert.equal(normalizeModerationMode('community').value, 'community')
  assert.equal(normalizeModerationMode('manual').value, 'manual')
  assert.equal(normalizeModerationMode('assistant').ok, false)

  const openrouter = normalizeAssistantConfig({
    enabled: true,
    provider: 'openrouter',
    model: 'openai/gpt-test',
    onFail: 'hidden',
    trigger: 'views',
    viewThreshold: 100,
    apiKey: 'test-key-1234',
  })
  assert.equal(openrouter.ok, true)
  assert.equal(openrouter.value.baseUrl, 'https://openrouter.ai/api/v1')
  assert.equal(presentAssistantConfig(openrouter.value).keySet, true)
  assert.equal('apiKey' in presentAssistantConfig(openrouter.value), false)
  assert.equal(normalizeAssistantConfig({ enabled: false }, openrouter.value).value, null)

  const neron = normalizeAssistantConfig({
    enabled: true,
    provider: 'neron',
    model: 'neron-moderator',
    onFail: 'unlisted',
    trigger: 'publish',
    apiKey: 'neron-key-1234',
  })
  assert.equal(neron.ok, true)
  assert.equal(neron.value.baseUrl, 'https://neron.one/api/neron/v1')
  assert.equal(assistantEndpoint(neron.value).url, 'https://neron.one/api/neron/v1/tasks')

  const kept = normalizeAssistantConfig({
    enabled: true,
    provider: 'openai',
    model: 'gpt-test',
    onFail: 'unlisted',
    trigger: 'publish',
    apiKey: '',
  }, openrouter.value)
  assert.equal(kept.value.apiKey, 'test-key-1234')
  assert.equal(endpointAllowed('https://api.openai.com/v1'), true)
  assert.equal(endpointAllowed('http://127.0.0.1:9/v1'), true)
  assert.equal(endpointAllowed('http://169.254.169.254/latest'), false)
  assert.equal(endpointAllowed('https://10.0.0.5/v1'), false)
  assert.equal(endpointAllowed('http://example.com/v1'), false)
  assert.equal(assistantEndpoint({ baseUrl: 'https://openrouter.ai/api/v1' }).url, 'https://openrouter.ai/api/v1/chat/completions')

  assert.deepEqual(parseAssistantVerdict('{"ok":false,"reason":"secret"}'), { ok: false, reason: 'secret' })
  assert.deepEqual(parseAssistantVerdict({ ok: true }), { ok: true, reason: '' })
  assert.equal(parseAssistantVerdict('not json'), null)
  assert.equal(viewCheckDue({ reads: 99, threshold: 100, statuses: [] }), false)
  assert.equal(viewCheckDue({ reads: 100, threshold: 100, statuses: [] }), true)
  assert.equal(viewCheckDue({ reads: 100, threshold: 100, statuses: ['failed'] }), true)
  assert.equal(viewCheckDue({ reads: 1000, threshold: 100, statuses: ['clear'] }), false)
  const nodeOn = { enabled: true }
  assert.equal(pageModelCheckApplies(nodeOn, { assistant_check: true, status: 'published' }), true)
  assert.equal(pageModelCheckApplies(nodeOn, { assistant_check: true, status: 'unlisted' }), true)
  assert.equal(pageModelCheckApplies(nodeOn, { assistant_check: false, status: 'published' }), false)
  assert.equal(pageModelCheckApplies(nodeOn, { assistantCheck: false, status: 'unlisted' }), false)
  assert.equal(pageModelCheckApplies(null, { assistant_check: true, status: 'published' }), false)
  assert.equal(pageModelCheckApplies(nodeOn, { assistant_check: true, status: 'pending' }), false)

  const called = []
  const verdict = await requestAssistantVerdict(openrouter.value, {
    title: 'Held page',
    body: 'HOLD-THIS page is long enough.',
  }, async (url, options) => {
    called.push(url)
    assert.equal(options.redirect, 'error')
    assert.equal(options.headers.authorization, 'Bearer test-key-1234')
    return {
      ok: true,
      async json() {
        return { choices: [{ message: { content: '{"ok":false,"reason":"held by the test model"}' } }] }
      },
    }
  })
  assert.equal(verdict.status, 'held')
  assert.equal(called[0], 'https://openrouter.ai/api/v1/chat/completions')

  const neronCalls = []
  const neronVerdict = await requestAssistantVerdict(neron.value, {
    title: 'Clear page',
    body: 'This page is long enough for the moderation task.',
  }, async (url, options) => {
    neronCalls.push(url)
    assert.equal(options.headers.authorization, 'Bearer neron-key-1234')
    const isStart = url.endsWith('/tasks')
    return {
      ok: true,
      status: isStart ? 202 : 200,
      headers: { get: () => null },
      body: null,
      text: async () => JSON.stringify(isStart
        ? { task: { id: 'moderation-task-1', status: 'queued' } }
        : { task: { id: 'moderation-task-1', status: 'completed', result: '{"ok":true}' } }),
    }
  })
  assert.deepEqual(neronVerdict, { status: 'clear', reason: '' })
  assert.deepEqual(neronCalls, [
    'https://neron.one/api/neron/v1/tasks',
    'https://neron.one/api/neron/v1/tasks/moderation-task-1',
  ])
}
