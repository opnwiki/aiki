/**
 * Return the stable secret used to anonymize reader identities.
 *
 * READ_HMAC_SECRET is preferred. RATE_LIMIT_SECRET is a backwards-compatible
 * fallback for deployments that were configured before the reader-specific
 * secret was introduced. The value is only used as an HMAC key; raw client
 * addresses are never persisted.
 */
export function getReadHmacSecret(config = {}) {
  for (const candidate of [config.readHmacSecret, config.rateLimitSecret]) {
    if (typeof candidate === 'string' && candidate.length >= 32) return candidate
  }
  return null
}
