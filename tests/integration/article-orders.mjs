import assert from 'node:assert/strict'
import { createHash, randomBytes } from 'node:crypto'
import { buildStaticaUrl, normalizeStaticaPayload, orderAccessTokenHash, orderRequestHash, validateOrderRequest } from '../../server/utils/article-orders.js'
import { getTrustedClientIp } from '../../server/utils/client-ip.js'

const base = (process.env.AIKI_TEST_BASE_URL || '').replace(/\/$/, '')
if (!base) throw new Error('Set AIKI_TEST_BASE_URL to an isolated loopback test server URL')
const baseUrl = new URL(base)
if (!['127.0.0.1', 'localhost', '::1'].includes(baseUrl.hostname)) throw new Error('Article-order integration is restricted to loopback')

const suffix = randomBytes(32).toString('base64url')
const second = randomBytes(32).toString('base64url')
const accepted = { security: { is_clean: true }, static_assessment_id: `integration-${suffix}`, risk: { category: 'test' } }

assert.equal(getTrustedClientIp({ 'x-real-ip': '198.51.100.12', 'x-forwarded-for': '203.0.113.99' }, '127.0.0.1'), '198.51.100.12')
assert.equal(getTrustedClientIp({ 'x-real-ip': '198.51.100.12' }, '203.0.113.4'), '203.0.113.4', 'direct remote peers must not override their trusted socket address')
assert.match(buildStaticaUrl('198.51.100.12'), /^https:\/\/statica\.me\/user\/198\.51\.100\.12\?full$/)
assert.equal(normalizeStaticaPayload(accepted).isClean, true)
assert.equal(normalizeStaticaPayload({ security: { is_clean: false } }).isClean, false)
assert.equal(normalizeStaticaPayload({ security: { is_clean: 'true' } }), null)
assert.equal(normalizeStaticaPayload({ is_clean: true }), null)
assert.equal(normalizeStaticaPayload({ security: null }), null)
assert.equal(validateOrderRequest({ query: `test ${suffix}`, locale: 'en' }).ok, true)
assert.equal(validateOrderRequest({ query: `test ${suffix}`, locale: 'en', statica: accepted }).ok, false, 'the client cannot submit its own provider verdict')
assert.equal(validateOrderRequest({ query: 'x'.repeat(161), locale: 'en' }).ok, false)
assert.equal(validateOrderRequest({ query: 'valid length', locale: 'xx' }).ok, false)
assert.notEqual(orderAccessTokenHash(suffix), orderAccessTokenHash(second))
assert.notEqual(orderRequestHash('', suffix), orderRequestHash('', second))

console.log(`PASS isolated article-order guard checks at ${baseUrl.origin} (${accepted.static_assessment_id})`)
