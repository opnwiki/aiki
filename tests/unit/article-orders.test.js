import {
  buildStaticaUrl,
  createOrderAccessToken,
  executionErrorCode,
  fetchStaticaAssessment,
  normalizeStaticaPayload,
  orderAccessTokenHash,
  orderRequestHash,
  readBoundedResponse,
  validateOrderRequest,
} from '../../server/utils/article-orders.js'

export async function run({ assert }) {
  const body = { query: '  Ada Lovelace  ', locale: 'en' }
  assert.deepEqual(validateOrderRequest(body), { ok: true, value: { query: 'Ada Lovelace', locale: 'en', context: [], launchAgent: false, createOnly: false } })
  assert.equal(validateOrderRequest({ query: 'Ada Lovelace', locale: 'en', launchAgent: true }).value.launchAgent, true)
  assert.equal(validateOrderRequest({ query: 'Ada Lovelace', createOnly: true }).value.createOnly, true)
  assert.equal(validateOrderRequest({ query: 'Ada Lovelace', launchAgent: true, createOnly: true }).ok, false)
  assert.equal(validateOrderRequest({ query: 'Ada Lovelace', locale: 'en', launchAgent: 'yes' }).ok, false)
  assert.equal(validateOrderRequest({ query: 'x'.repeat(161) }).ok, false)
  assert.equal(validateOrderRequest({ query: 'A valid query', locale: 'xx' }).ok, false)
  assert.equal(validateOrderRequest({ query: 'A valid query', extra: 'forged Statica result' }).ok, false)
  assert.equal(validateOrderRequest(null).ok, false)
  assert.equal(validateOrderRequest([]).ok, false)

  assert.deepEqual(normalizeStaticaPayload({ security: { is_clean: true }, details: { source: 'test' } }), {
    isClean: true,
    response: { security: { is_clean: true }, details: { source: 'test' } },
  })
  assert.equal(normalizeStaticaPayload({ security: { is_clean: false } }).isClean, false)
  assert.equal(normalizeStaticaPayload({ is_clean: true }), null, 'legacy top-level flag is intentionally not accepted')
  assert.equal(normalizeStaticaPayload({ security: { is_clean: 'true' } }), null)
  assert.equal(normalizeStaticaPayload({ security: null }), null)
  assert.equal(normalizeStaticaPayload([]), null)

  assert.equal(buildStaticaUrl('198.51.100.7'), 'https://statica.me/user/198.51.100.7?full')
  assert.equal(buildStaticaUrl('2001:db8::7'), 'https://statica.me/user/2001%3Adb8%3A%3A7?full')
  assert.throws(() => buildStaticaUrl('not-an-ip'), /normalized client IP/)

  const one = createOrderAccessToken()
  const two = createOrderAccessToken()
  assert.match(one, /^[A-Za-z0-9_-]{43}$/)
  assert.notEqual(one, two)
  assert.equal(orderAccessTokenHash(one), orderAccessTokenHash(one))
  assert.notEqual(orderAccessTokenHash(one), orderAccessTokenHash(two))
  assert.equal(orderRequestHash('ignored', one), orderRequestHash('ignored', one))
  assert.equal(executionErrorCode({ status: 400 }), 'executor_invalid_request')
  assert.equal(executionErrorCode({ status: 404 }), 'executor_not_found')
  assert.equal(executionErrorCode({ status: 422 }), 'executor_invalid_response')

  const tooLarge = new Response('12345', { headers: { 'content-length': '5' } })
  await assert.rejects(() => readBoundedResponse(tooLarge, 4), /too large/)
  assert.equal(await readBoundedResponse(new Response('{"ok":true}'), 100), '{"ok":true}')

  const captured = {}
  const clean = await fetchStaticaAssessment('198.51.100.7', async (url, options) => {
    captured.url = url
    captured.options = options
    return new Response(JSON.stringify({ security: { is_clean: true }, profile: { risk: 'low' } }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })
  })
  assert.equal(clean.isClean, true)
  assert.deepEqual(clean.response.security, { is_clean: true })
  assert.match(captured.url, /\?full$/)
  assert.equal(captured.options.method, 'GET')
  const unclean = await fetchStaticaAssessment('198.51.100.7', async () => new Response(
    JSON.stringify({ security: { is_clean: false } }), { status: 200 },
  ))
  assert.equal(unclean.isClean, false, 'a valid false verdict must be preserved for rejection by the API')
  assert.equal(captured.options.headers.accept, 'application/json')
  assert.equal(captured.options.redirect, 'error')
  assert.ok(captured.options.signal instanceof AbortSignal)

  for (const [label, fetchImpl, expectedStatus] of [
    ['HTTP failure', async () => new Response('upstream details', { status: 502 }), 503],
    ['network failure', async () => { throw new Error('private network detail') }, 503],
    ['redirect failure', async (_url, options) => {
      assert.equal(options.redirect, 'error')
      throw new TypeError('redirect rejected')
    }, 503],
    ['malformed JSON', async () => new Response('{"security":', { status: 200 }), 503],
    ['missing nested field', async () => new Response('{"is_clean":true}', { status: 200 }), 503],
    ['non-boolean nested field', async () => new Response('{"security":{"is_clean":"true"}}', { status: 200 }), 503],
    ['oversized response', async () => new Response('x'.repeat(256 * 1024 + 1), { status: 200 }), 503],
    ['timeout', async (_url, options) => new Promise((resolve, reject) => {
      options.signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), { once: true })
    }), 503],
  ]) {
    await assert.rejects(
      () => fetchStaticaAssessment('198.51.100.7', fetchImpl, label === 'timeout' ? 5 : 100),
      error => {
        assert.equal(error.statusCode, expectedStatus, `${label} should return a service-unavailable API error`)
        assert.equal(error.statusMessage, 'Free order eligibility could not be checked. Please try again later.')
        assert.equal(JSON.stringify(error).includes('private network detail'), false, 'provider/network details must not leak')
        return true
      },
      label,
    )
  }
}
