import { applyRateLimitMultiplier, buildRateLimitQuery, CONTENT_QUOTAS, ipReputation, quotaFor, rateLimitError, retryAfterSeconds, scaleLimit } from '../../server/utils/rate-limit.js'
import { lookupStaticaProfile, parseStaticaSecurity } from '../../server/utils/site-analytics.js'
import { getReadIdentity, getTrustedClientIp, isTrustedProxyPeer, parseTrustedProxies } from '../../server/utils/client-ip.js'

export async function run({ assert }) {
  const query = buildRateLimitQuery('a'.repeat(64))
  assert.deepEqual(query.values, ['a'.repeat(64), 600])
  assert.match(query.text, /window_started_at <= now\(\) - \(\$2 \* interval '1 second'\)/)
  assert.match(query.text, /attempts = CASE/)
  assert.match(query.text, /RETURNING attempts, window_started_at/)
  assert.doesNotMatch(query.text, /\$3/)

  const headers = { 'x-forwarded-for': '203.0.113.12, 10.0.0.1' }
  assert.equal(getTrustedClientIp(headers, '127.0.0.1'), '127.0.0.1', 'X-Forwarded-For is never trusted')
  assert.equal(getTrustedClientIp({ ...headers, 'x-real-ip': '198.51.100.7' }, '127.0.0.1'), '198.51.100.7', 'loopback reverse proxy may supply X-Real-IP')
  assert.equal(getTrustedClientIp({ 'x-real-ip': 'forged-value' }, '127.0.0.1'), '127.0.0.1', 'invalid proxy value falls back to the peer')
  assert.equal(getTrustedClientIp({ 'x-real-ip': '198.51.100.7' }, '203.0.113.20'), '203.0.113.20', 'remote peers cannot override their address')
  assert.equal(getTrustedClientIp({ 'x-real-ip': '198.51.100.7, 203.0.113.4' }, '127.0.0.1'), '127.0.0.1', 'lists of addresses are rejected')
  assert.equal(getTrustedClientIp({}, 'invalid-socket-address'), 'unknown')
  assert.equal(getTrustedClientIp({}, '::ffff:127.0.0.1'), '127.0.0.1')

  assert.deepEqual(
    getReadIdentity({ 'x-real-ip': '198.51.100.9', 'x-aiki-agent-id': 'spoofed-agent' }, '127.0.0.1'),
    { readerType: 'web', identity: '198.51.100.9' },
  )
  assert.deepEqual(
    getReadIdentity({ 'x-forwarded-for': '203.0.113.4', 'x-aiki-agent-id': 'claimed-agent' }, '203.0.113.20'),
    { readerType: 'web', identity: '203.0.113.20' },
  )
  assert.equal(getTrustedClientIp({}, '2001:0db8:0:0:0:0:0:1'), '2001:db8::1')
  assert.equal(getTrustedClientIp({}, '::ffff:192.0.2.33'), '192.0.2.33')

  const dockerProxies = parseTrustedProxies('172.16.0.0/12, 2001:db8::5, not-an-ip, 10.0.0.0/99')
  assert.equal(getTrustedClientIp({ 'x-real-ip': '198.51.100.7' }, '172.18.0.1', dockerProxies), '198.51.100.7', 'a configured proxy subnet may supply X-Real-IP')
  assert.equal(getTrustedClientIp({ 'x-real-ip': '198.51.100.7' }, '2001:db8::5', dockerProxies), '198.51.100.7', 'a configured proxy address may supply X-Real-IP')
  assert.equal(getTrustedClientIp({ 'x-real-ip': '198.51.100.7' }, '10.0.0.1', dockerProxies), '10.0.0.1', 'invalid ranges are ignored')
  assert.equal(getTrustedClientIp({ 'x-real-ip': '198.51.100.7' }, '172.18.0.1'), '172.18.0.1', 'no extra proxies are trusted by default')
  assert.equal(isTrustedProxyPeer('172.18.0.1', dockerProxies), true)


  const now = Date.parse('2026-10-07T12:00:00Z')
  assert.equal(retryAfterSeconds('2026-10-07T11:55:00Z', 600, now), 300)
  assert.equal(retryAfterSeconds('2026-10-07T11:40:00Z', 600, now), 1, 'an expired window still asks for at least one second')
  const fresh = quotaFor('reply', { created_at: '2026-10-06T12:00:00Z' }, now)
  const settled = quotaFor('reply', { created_at: '2026-09-01T12:00:00Z' }, now)
  assert.equal(fresh.isNew, true)
  assert.equal(fresh.day, CONTENT_QUOTAS.reply.newDay)
  assert.equal(settled.day, CONTENT_QUOTAS.reply.day)
  assert.equal(quotaFor('page', { created_at: '2026-10-06T12:00:00Z' }, now).day, CONTENT_QUOTAS.page.day)
  assert.ok(quotaFor('page', {}, now).isNew, 'unknown account age counts as new')
  for (const quota of Object.values(CONTENT_QUOTAS)) assert.ok(quota.newDay <= quota.day && quota.burst <= quota.day)

  const sentHeaders = {}
  const event = { node: { res: { setHeader: (name, value) => { sentHeaders[name] = value } } } }
  const error = rateLimitError(event, { reason: 'daily_quota', retryAfter: 3600, limit: 40, windowSeconds: 86400 })
  assert.equal(error.statusCode, 429)
  assert.equal(sentHeaders["Retry-After"], "3600")
  assert.equal(error.data.error, 'rate_limited')
  assert.equal(error.data.retryAfterSeconds, 3600)
  assert.match(error.data.retryAt, /^\d{4}-\d{2}-\d{2}T/)
  assert.match(error.statusMessage, /Daily limit of 40/)
  assert.match(error.statusMessage, /60 minutes/)

  // Real Statica shapes: Google DNS (hosting) and a Tor exit (anonymous abuser).
  const hosting = parseStaticaSecurity({ security: { is_cloud_provider: true, is_clean: false } })
  const torExit = parseStaticaSecurity({ security: { is_abuser: true, is_proxy: true, is_tor: true, is_tor_exit: true, is_anonymous: true, is_threat: true } })
  assert.equal(parseStaticaSecurity({ security: 'clean' }), null)
  assert.equal(hosting.is_vpn, false, 'missing flags default to false')
  assert.deepEqual(ipReputation(hosting), { tier: 'hosting', factor: 1 })
  assert.deepEqual(ipReputation(torExit), { tier: 'threat', factor: 0.25 })
  assert.deepEqual(ipReputation(parseStaticaSecurity({ security: { is_vpn: true } })), { tier: 'anonymous', factor: 0.5 })
  assert.deepEqual(ipReputation(parseStaticaSecurity({ security: { is_clean: true } })), { tier: 'clean', factor: 2 })
  assert.deepEqual(ipReputation(null), { tier: 'unknown', factor: 1 }, 'Statica outages keep normal limits')
  assert.equal(scaleLimit(10, ipReputation(torExit)), 2)
  assert.equal(scaleLimit(3, ipReputation(torExit)), 1, 'a limit never drops below one')
  assert.equal(scaleLimit(20, { factor: 2 }), 40)
  assert.equal(applyRateLimitMultiplier(5, 2), 10)
  assert.equal(applyRateLimitMultiplier(5, 0.5), 5, 'an operator override cannot reduce a limit')
  assert.equal(applyRateLimitMultiplier(5, 100), 100, 'operator multiplier is capped')

  const profile = await lookupStaticaProfile('198.51.100.91', async () => new Response(JSON.stringify({ country: 'de', security: { is_clean: true } }), { status: 200 }))
  assert.equal(profile.country, 'DE')
  assert.equal(profile.security.is_clean, true)
  const cachedProfile = await lookupStaticaProfile('198.51.100.91', async () => { throw new Error('should be cached') })
  assert.equal(cachedProfile.security.is_clean, true)
  const failed = await lookupStaticaProfile('198.51.100.92', async () => { throw new Error('down') })
  assert.deepEqual(failed, { country: null, security: null })
}
