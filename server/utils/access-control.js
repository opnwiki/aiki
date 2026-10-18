import { getDatabase } from './database.js'
import { getTrustedClientIp, normalizeIpAddress } from './client-ip.js'
import { isProbePath, lookupStaticaProfile } from './site-analytics.js'

const ACCESS_CONFIG_CACHE_TTL_MS = 15_000
const SCANNER_HISTORY_DAYS = 30
const ACCESS_SECURITY_FLAGS = [
  'is_attacker', 'is_abuser', 'is_threat', 'is_cloud_provider', 'is_vpn', 'is_proxy',
  'is_tor', 'is_tor_exit', 'is_relay', 'is_anonymous', 'is_bogon', 'is_clean',
]

let accessConfigCache = null

export function normalizeAccessIp(value) {
  let input = String(value || '').trim()
  // PostgreSQL renders inet host values as 203.0.113.42/32 or IPv6/128.
  // Strip only host masks so stored rows compare with the request IP; reject
  // arbitrary network ranges from the admin input.
  input = input.replace(/\/(?:32|128)$/, '')
  return normalizeIpAddress(input)
}

export function normalizeAccessReason(value) {
  const reason = String(value || '').replace(/[\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim()
  return reason ? reason.slice(0, 240) : null
}

export function normalizeAccessSettings(input, fallback = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return { ok: false, message: 'accessControl must be an object.' }
  }
  const value = {}
  for (const key of ['threat', 'datacenter', 'scanner']) {
    if (input[key] === undefined) value[key] = Boolean(fallback[key])
    else if (typeof input[key] !== 'boolean') return { ok: false, message: `accessControl.${key} must be true or false.` }
    else value[key] = input[key]
  }
  return { ok: true, value }
}

function presentSecurity(security) {
  if (!security || typeof security !== 'object' || Array.isArray(security)) return null
  const result = {}
  for (const flag of ACCESS_SECURITY_FLAGS) {
    if (security[flag] === true) result[flag] = true
  }
  return Object.keys(result).length ? result : null
}

function presentStatica(row) {
  if (!row) return null
  const country = typeof row.country === 'string' && /^[A-Z]{2}$/.test(row.country) ? row.country : null
  const security = presentSecurity(row.security)
  if (!country && !security && !row.fetched_at) return null
  return { country, security, fetchedAt: row.fetched_at || null }
}

function presentAccessBlock(row) {
  return {
    id: row.id,
    ip: row.ip,
    reason: row.reason || '',
    createdAt: row.created_at,
    statica: presentStatica(row),
  }
}

export async function loadAccessControl(database = getDatabase()) {
  if (accessConfigCache && accessConfigCache.expiresAt > Date.now()) return accessConfigCache.value

  const nodeResult = await database.query(
    `SELECT id, block_threat, block_datacenter, block_scanner
       FROM nodes
      WHERE is_home
      LIMIT 1`,
  )
  const node = nodeResult.rows[0]
  if (!node) {
    const empty = { nodeId: null, settings: { threat: false, datacenter: false, scanner: false }, blocks: [] }
    accessConfigCache = { value: empty, expiresAt: Date.now() + ACCESS_CONFIG_CACHE_TTL_MS }
    return empty
  }

  const blocks = await database.query(
    `SELECT blocks.id, host(blocks.ip) AS ip, blocks.reason, blocks.created_at,
            profiles.country, profiles.security, profiles.fetched_at
       FROM node_ip_access_blocks blocks
       LEFT JOIN ip_statica_profiles profiles ON profiles.ip = blocks.ip
      WHERE blocks.node_id = $1
      ORDER BY blocks.created_at DESC, blocks.ip::text`,
    [node.id],
  )
  const value = {
    nodeId: node.id,
    settings: {
      threat: node.block_threat === true,
      datacenter: node.block_datacenter === true,
      scanner: node.block_scanner === true,
    },
    blocks: blocks.rows.map(presentAccessBlock),
  }
  accessConfigCache = { value, expiresAt: Date.now() + ACCESS_CONFIG_CACHE_TTL_MS }
  return value
}

export function invalidateAccessControlCache() {
  accessConfigCache = null
}

export async function updateAccessSettings(database, settings) {
  await database.query(
    `UPDATE nodes
        SET block_threat = $1,
            block_datacenter = $2,
            block_scanner = $3
      WHERE is_home`,
    [settings.threat, settings.datacenter, settings.scanner],
  )
  invalidateAccessControlCache()
}

export async function listAccessBlocks(database = getDatabase()) {
  return (await loadAccessControl(database)).blocks
}

export function accessCategoryForStatica(settings, security) {
  const categories = []
  if (settings.threat && (security?.is_attacker || security?.is_abuser || security?.is_threat)) categories.push('Threat')
  if (settings.datacenter && security?.is_cloud_provider && !security?.is_vpn) categories.push('Datacenter')
  return categories
}

async function hasScannerHistory(database, ip) {
  try {
    const result = await database.query(
      `SELECT 1
         FROM site_visit_analytics
        WHERE ip_address = $1::inet
          AND client_label = 'Scanner'
          AND last_seen_at >= now() - ($2::int * interval '1 day')
        LIMIT 1`,
      [ip, SCANNER_HISTORY_DAYS],
    )
    return result.rowCount > 0
  } catch {
    return false
  }
}

export function clientIpForEvent(event) {
  return normalizeAccessIp(getTrustedClientIp(event?.node?.req?.headers || {}, event?.node?.req?.socket?.remoteAddress || ''))
}

export async function evaluateAccess(event, { path = null } = {}) {
  const database = getDatabase()
  const access = await loadAccessControl(database)
  const ip = clientIpForEvent(event)
  const requestPath = String(path || event?.path || '/').split('?')[0] || '/'
  const customBlock = ip ? access.blocks.find(block => block.ip === ip) : null
  if (customBlock) {
    const profile = await lookupStaticaProfile(ip)
    return { blocked: true, ip, categories: ['IP'], category: 'IP', reason: customBlock.reason, profile, customBlock }
  }

  const needsStatica = access.settings.threat || access.settings.datacenter
  const profile = needsStatica && ip ? await lookupStaticaProfile(ip) : { country: null, security: null }
  const categories = accessCategoryForStatica(access.settings, profile.security)
  if (access.settings.scanner && (isProbePath(requestPath) || (ip && await hasScannerHistory(database, ip)))) categories.push('Scanner')
  if (!categories.length) return { blocked: false, ip, categories: [], category: null, reason: null, profile }
  return { blocked: true, ip, categories, category: categories.join(', '), reason: null, profile }
}

export function isAccessControlExempt(event) {
  const path = String(event?.path || '').split('?')[0] || '/'
  return path === '/access-denied'
    || path === '/api/access-denied'
    || path === '/api/health'
    // Fediverse servers run in data centres; ActivityPub requests are signed
    // and rate-limited by Fedify, so category blocks must not cut them off.
    || /^\/(?:\.well-known\/(?:webfinger|nodeinfo|host-meta)|ap(?:\/|$))/i.test(path)
}

export function accessDeniedData(decision) {
  return {
    error: 'access_denied',
    category: decision.category,
    categories: decision.categories,
    reason: decision.reason,
    statica: decision.profile,
  }
}

export function presentAccessSettings(access) {
  return {
    ...access.settings,
    customBlocks: access.blocks,
  }
}
