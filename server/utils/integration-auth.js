import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import { createError } from 'h3'
import { getDatabase } from './database.js'

export const INTEGRATION_SCOPES = Object.freeze(['imports:read', 'imports:write', 'account-links:write'])
const TOKEN_PREFIX = 'aiki_integration_'
const TOKEN_PATTERN = /^aiki_integration_[A-Za-z0-9_-]{43}$/
const IDENTIFIER_PATTERN = /^[a-z][a-z0-9_-]{1,63}$/

export function integrationsEnabled() {
  return process.env.AIKI_INTEGRATIONS_ENABLED === 'true'
}

export function requireIntegrationsEnabled() {
  if (!integrationsEnabled()) throw createError({ statusCode: 503, statusMessage: 'Integrations are disabled on this node.' })
}

export function createIntegrationToken() {
  return `${TOKEN_PREFIX}${randomBytes(32).toString('base64url')}`
}

export function hashIntegrationToken(token) {
  return createHash('sha256').update(String(token)).digest('hex')
}

export function integrationTokenPrefix(token) {
  return String(token).slice(0, TOKEN_PREFIX.length + 8)
}

export function normalizeIntegrationCredential(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(key => !['connector', 'provider', 'label', 'scopes', 'allowedMediaOrigins', 'identityProviders'].includes(key))) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid integration credential settings.' })
  }
  const connector = input.connector
  const provider = input.provider
  const label = typeof input.label === 'string' ? input.label.trim() : ''
  if (typeof connector !== 'string' || typeof provider !== 'string' || !IDENTIFIER_PATTERN.test(connector) || !IDENTIFIER_PATTERN.test(provider) || !label || label.length > 80) {
    throw createError({ statusCode: 400, statusMessage: 'Supply a connector, provider, and label.' })
  }
  if (!Array.isArray(input.scopes) || !input.scopes.length || input.scopes.length > 3 || input.scopes.some(scope => !INTEGRATION_SCOPES.includes(scope)) || new Set(input.scopes).size !== input.scopes.length) {
    throw createError({ statusCode: 400, statusMessage: 'Supply distinct supported integration scopes.' })
  }
  const origins = input.allowedMediaOrigins ?? []
  if (!Array.isArray(origins) || origins.length > 8) throw createError({ statusCode: 400, statusMessage: 'At most eight stable media origins are supported.' })
  const allowedMediaOrigins = origins.map(value => {
    const url = safeIntegrationPublicUrl(value, { httpsOnly: true })
    if (!url || new URL(url).origin !== value) throw createError({ statusCode: 400, statusMessage: 'Media origins must be public HTTPS origins without a path.' })
    return value
  })
  const identityProviders = input.identityProviders ?? [provider]
  if (!Array.isArray(identityProviders) || !identityProviders.includes(provider) || identityProviders.length > 8 || identityProviders.some(value => typeof value !== 'string' || !IDENTIFIER_PATTERN.test(value)) || new Set(identityProviders).size !== identityProviders.length) {
    throw createError({ statusCode: 400, statusMessage: 'Supply distinct identity providers including the primary provider.' })
  }
  return { connector, provider, label, scopes: input.scopes, allowedMediaOrigins: [...new Set(allowedMediaOrigins)], identityProviders }
}

// This is syntactic validation only. URL retrieval additionally needs DNS and
// redirect checks in the connector; the core never fetches these URLs.
export function safeIntegrationPublicUrl(value, { httpsOnly = false } = {}) {
  if (typeof value !== 'string' || value.length > 2048) return null
  try {
    const url = new URL(value)
    const host = url.hostname.toLowerCase().replace(/\.$/, '')
    if (!(httpsOnly ? url.protocol === 'https:' : ['https:', 'http:'].includes(url.protocol)) || url.username || url.password || url.port || !host.includes('.') || /^[\d.]+$/.test(host) || host.includes(':') || host === 'localhost' || /\.(?:localhost|local|internal|test|invalid|lan|home)$/.test(host) || host.endsWith('.home.arpa')) return null
    if (host === 'api.telegram.org' || /bot\d+:[A-Za-z0-9_-]+|aiki_(?:agent|integration)_|[?&](?:[^=&]*token|key|api_key|secret)=/i.test(decodeURIComponent(value))) return null
    return url.href
  } catch { return null }
}

export function allowedIntegrationMediaUrl(value, credential) {
  const normalized = safeIntegrationPublicUrl(value, { httpsOnly: true })
  return normalized && credential.allowed_media_origins?.includes(new URL(normalized).origin) ? normalized : null
}

export async function getIntegrationCredentialByToken(database, token, { scope, enabled = integrationsEnabled() } = {}) {
  if (!enabled || typeof token !== 'string' || !TOKEN_PATTERN.test(token) || !INTEGRATION_SCOPES.includes(scope)) return null
  const hash = hashIntegrationToken(token)
  const result = await database.query(
    `SELECT id, node_id, connector, provider, identity_providers, scopes, allowed_media_origins, token_hash
       FROM integration_credentials
      WHERE token_hash = $1 AND revoked_at IS NULL AND $2 = ANY(scopes)`,
    [hash, scope],
  )
  const row = result.rows[0]
  if (!row || !/^[a-f0-9]{64}$/.test(row.token_hash || '') || !timingSafeEqual(Buffer.from(row.token_hash, 'hex'), Buffer.from(hash, 'hex'))) return null
  // Require the same active verifier during update to close the revoke race.
  const used = await database.query(
    `UPDATE integration_credentials SET last_used_at = now() WHERE id = $1 AND token_hash = $2 AND revoked_at IS NULL RETURNING id`,
    [row.id, hash],
  )
  if (!used.rows[0]) return null
  const { token_hash: _verifier, ...credential } = row
  return credential
}

export async function requireIntegrationCredential(event, scope) {
  requireIntegrationsEnabled()
  const authorization = event.node.req.headers.authorization
  const token = typeof authorization === 'string' ? /^Bearer\s+(\S+)$/i.exec(authorization)?.[1] : null
  const credential = await getIntegrationCredentialByToken(getDatabase(), token, { scope })
  if (!credential) throw createError({ statusCode: 401, statusMessage: 'An active integration credential with the required scope is required.' })
  return credential
}

export async function lockIntegrationCredential(client, credential, scope) {
  const result = await client.query(
    `SELECT id FROM integration_credentials WHERE id = $1 AND node_id = $2 AND connector = $3 AND provider = $4 AND revoked_at IS NULL AND $5 = ANY(scopes) FOR SHARE`,
    [credential.id, credential.node_id, credential.connector, credential.provider, scope],
  )
  if (!result.rows[0]) throw createError({ statusCode: 401, statusMessage: 'That integration credential is no longer active.' })
}
