import { createHmac } from 'node:crypto'
import { classifyPageClient } from './page-visitors.js'
import { buildStaticaUrl, readBoundedResponse } from './article-orders.js'
import { getTrustedClientIp, isTrustedProxyPeer, normalizeIpAddress } from './client-ip.js'
import { getReadHmacSecret } from './read-secret.js'
import { getDatabase } from './database.js'

const ANALYTICS_RETENTION_DAYS = 30
const MAX_RECENT_ROWS = 100
const STATICA_TIMEOUT_MS = 2_500
const STATICA_REFRESH_MS = 24 * 60 * 60 * 1_000
const STATICA_FAILURE_CACHE_TTL_MS = 5 * 60 * 1_000
const MAX_STATICA_CACHE_ENTRIES = 4_096

const staticaCountryCache = new Map()
const staticaCountryRequests = new Map()

const BROWSER_PATTERNS = [
  ['Edge', /Edg\//i],
  ['Opera', /OPR\//i],
  ['Samsung Internet', /SamsungBrowser\//i],
  ['Android WebView', /; wv\)/i],
  ['Chrome', /Chrome\//i],
  ['Firefox', /Firefox\//i],
  ['Safari', /Safari\//i],
]

const OS_PATTERNS = [
  ['ChromeOS', /CrOS/i],
  ['Windows', /Windows NT/i],
  ['iOS', /iPhone|iPad|iPod/i],
  ['macOS', /Macintosh|Mac OS X/i],
  ['Android', /Android/i],
  ['Linux', /Linux/i],
]

export function classifyBrowser(userAgent) {
  const value = String(userAgent || '').slice(0, 512)
  return BROWSER_PATTERNS.find(([, pattern]) => pattern.test(value))?.[0] || 'Other'
}

export function classifyOperatingSystem(userAgent) {
  const value = String(userAgent || '').slice(0, 512)
  return OS_PATTERNS.find(([, pattern]) => pattern.test(value))?.[0] || 'Other'
}

export function classifyDevice(userAgent) {
  const value = String(userAgent || '').slice(0, 512)
  if (/iPad|Tablet|Android(?!.*Mobile)/i.test(value)) return 'tablet'
  if (/Mobile|iPhone|iPod|Android/i.test(value)) return 'mobile'
  return 'desktop'
}

export function trustedCountryCode(headers = {}, socketAddress = '') {
  if (!isTrustedProxyPeer(normalizeIpAddress(socketAddress))) return null

  const value = headers['cf-ipcountry'] || headers['x-country-code'] || headers['x-geo-country']
  const country = String(value || '').trim().toUpperCase()
  return /^[A-Z]{2}$/.test(country) && country !== 'XX' ? country : null
}

export function normalizeStaticaCountry(value) {
  const country = String(value || '').trim().toUpperCase()
  return /^[A-Z]{2}$/.test(country) && country !== 'XX' ? country : null
}

export function parseStaticaCountry(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null
  return normalizeStaticaCountry(payload.country)
}

const SECURITY_FLAGS = [
  'is_clean', 'is_cloud_provider', 'is_vpn', 'is_proxy', 'is_tor', 'is_tor_exit',
  'is_relay', 'is_anonymous', 'is_attacker', 'is_abuser', 'is_threat', 'is_bogon',
]

export function parseStaticaSecurity(payload) {
  const security = payload && typeof payload === 'object' && !Array.isArray(payload) ? payload.security : null
  if (!security || typeof security !== 'object' || Array.isArray(security)) return null
  const flags = {}
  for (const flag of SECURITY_FLAGS) flags[flag] = security[flag] === true
  return flags
}

function rememberStaticaProfile(ip, profile, ttlMs) {
  if (staticaCountryCache.size >= MAX_STATICA_CACHE_ENTRIES && !staticaCountryCache.has(ip)) {
    const oldest = staticaCountryCache.keys().next().value
    if (oldest) staticaCountryCache.delete(oldest)
  }
  staticaCountryCache.delete(ip)
  staticaCountryCache.set(ip, { profile, expiresAt: Date.now() + ttlMs })
}

// Profiles are stored permanently in ip_statica_profiles. Database errors
// (or no database, as in unit tests) only disable the store, never the lookup.
async function readStoredStaticaProfile(ip) {
  try {
    const result = await getDatabase().query(
      'SELECT country, security, fetched_at FROM ip_statica_profiles WHERE ip = $1::inet',
      [ip],
    )
    const row = result.rows[0]
    return row ? { profile: { country: row.country, security: row.security }, fetchedAt: new Date(row.fetched_at).getTime() } : null
  } catch {
    return null
  }
}

async function storeStaticaProfile(ip, profile, payload) {
  try {
    await getDatabase().query(
      `INSERT INTO ip_statica_profiles (ip, country, security, payload, fetched_at)
       VALUES ($1::inet, $2, $3::jsonb, $4::jsonb, now())
       ON CONFLICT (ip) DO UPDATE SET
         country = EXCLUDED.country, security = EXCLUDED.security,
         payload = EXCLUDED.payload, fetched_at = EXCLUDED.fetched_at`,
      [ip, profile.country, profile.security ? JSON.stringify(profile.security) : null, JSON.stringify(payload)],
    )
  } catch {}
}

async function fetchStaticaProfile(ip, fetchImpl, timeoutMs) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetchImpl(buildStaticaUrl(ip), {
      method: 'GET',
      headers: { accept: 'application/json' },
      redirect: 'error',
      signal: controller.signal,
    })
    if (!response.ok) throw new Error('Statica service unavailable')
    const text = await readBoundedResponse(response)
    let payload
    try { payload = JSON.parse(text) } catch { throw new Error('Invalid Statica response') }
    const profile = { country: parseStaticaCountry(payload), security: parseStaticaSecurity(payload) }
    if (!profile.country && !profile.security) throw new Error('Empty Statica response')
    await storeStaticaProfile(ip, profile, payload)
    rememberStaticaProfile(ip, profile, STATICA_REFRESH_MS)
    return profile
  } catch {
    return null
  } finally {
    clearTimeout(timeout)
  }
}

// One Statica profile per IP serves both analytics (country) and rate limits
// (security flags). Order: memory, then the stored profile, then Statica.
// A stored profile older than a day is still used right away while a fresh
// one is fetched in the background; if Statica is down the last known
// profile stays in use. With nothing known, a failed lookup returns nulls.
export async function lookupStaticaProfile(ip, fetchImpl = fetch, timeoutMs = STATICA_TIMEOUT_MS) {
  const empty = { country: null, security: null }
  const normalized = normalizeIpAddress(ip)
  if (!normalized) return empty

  const cached = staticaCountryCache.get(normalized)
  if (cached) {
    if (cached.expiresAt > Date.now()) return cached.profile
    staticaCountryCache.delete(normalized)
  }

  const pending = staticaCountryRequests.get(normalized)
  if (pending) return pending

  const request = (async () => {
    const stored = await readStoredStaticaProfile(normalized)
    const age = stored ? Date.now() - stored.fetchedAt : Infinity
    if (stored && age < STATICA_REFRESH_MS) {
      rememberStaticaProfile(normalized, stored.profile, STATICA_REFRESH_MS - age)
      return stored.profile
    }
    if (stored) {
      rememberStaticaProfile(normalized, stored.profile, STATICA_FAILURE_CACHE_TTL_MS)
      void fetchStaticaProfile(normalized, fetchImpl, timeoutMs)
      return stored.profile
    }
    const fresh = await fetchStaticaProfile(normalized, fetchImpl, timeoutMs)
    if (fresh) return fresh
    rememberStaticaProfile(normalized, empty, STATICA_FAILURE_CACHE_TTL_MS)
    return empty
  })()

  staticaCountryRequests.set(normalized, request)
  try {
    return await request
  } finally {
    staticaCountryRequests.delete(normalized)
  }
}

export async function lookupStaticaCountry(ip, fetchImpl = fetch, timeoutMs = STATICA_TIMEOUT_MS) {
  return (await lookupStaticaProfile(ip, fetchImpl, timeoutMs)).country
}

export function analyticsPath(event) {
  const method = String(event?.method || '').toUpperCase()
  if (!['GET', 'HEAD'].includes(method)) return null

  const path = String(event?.path || '').split('?')[0] || '/'
  if (path.startsWith('/api') || path.startsWith('/_nuxt/') || path === '/mcp') return null
  if (/^\/(?:favicon|robots|sitemap|apple-touch-icon|aiki-)/i.test(path)) return null
  if (/\.(?:css|gif|ico|jpeg|jpg|js|json|map|png|svg|txt|webp|xml)$/i.test(path)) return null
  return path.slice(0, 512)
}

// Vulnerability scanners send ordinary browser User-Agents, so the path is
// what gives them away: CMS logins, PHP files, secrets and VCS metadata.
const PROBE_PATH = /(?:^|\/)(?:wp-(?:admin|login|content|includes|json|config|cron|signup|trackback|mail)[^/]*|wordpress|xmlrpc\.php|phpmyadmin|pma|cgi-bin|vendor\/phpunit|boaform|hnap1|actuator|\.env[^/]*|\.git|\.svn|\.hg|\.aws|\.ssh|\.ds_store|\.htaccess|\.htpasswd|credentials|config\.(?:json|ya?ml|php)|server-status|server-info|adminer|_profiler|phpinfo|containers|xwiki|reportserver|admingui|airflow|albatross)(?:\/|$)|(?:docker-compose|secrets|database|aws|parameters|application|settings|config)[^/]*\.ya?ml$|\.(?:php\d?|asp|aspx|jsp|cgi|env|ini|bak|sql|old|swp)$/i

export function isProbePath(path) {
  return PROBE_PATH.test(String(path || ''))
}

// A browser User-Agent from a datacenter or a known attack source is almost
// always a crawler or a headless scanner, not a person.
export function botLabelFromStatica(security) {
  if (!security) return null
  if (security.is_attacker || security.is_abuser || security.is_threat) return 'Threat'
  if (security.is_cloud_provider && !security.is_vpn) return 'Datacenter'
  return null
}

function visitorDigest(secret, ip) {
  return createHmac('sha256', String(secret)).update(`analytics\0${ip}`).digest('hex')
}

export async function recordSiteAnalytics(database, event) {
  const path = analyticsPath(event)
  if (!path) return null

  const config = useRuntimeConfig()
  const secret = getReadHmacSecret(config)
  const socketAddress = event?.node?.req?.socket?.remoteAddress || ''
  const headers = event?.node?.req?.headers || {}
  const ip = getTrustedClientIp(headers, socketAddress)
  if (!secret || ip === 'unknown') return null

  const userAgent = headers['user-agent'] || ''
  const client = classifyPageClient(userAgent)
  const staticaProfilePromise = lookupStaticaProfile(ip)
  const topicMatch = path.match(/^\/([^/]+)(?:\/(?:en|zh|ru|es|ja|de|fr|ar))?$/)
  let topicId = null
  if (topicMatch) {
    let topicKey = topicMatch[1]
    try {
      topicKey = decodeURIComponent(topicKey)
    } catch {
      topicKey = topicMatch[1]
    }
    const result = await database.query(
      `SELECT id FROM topics WHERE status = 'published' AND (page_number::text = $1 OR slug = $1) LIMIT 1`,
      [topicKey],
    )
    topicId = result.rows[0]?.id || null
  }

  const countryCode = trustedCountryCode(headers, socketAddress)
  const visitorHash = visitorDigest(secret, ip)
  const probe = isProbePath(path)
  if (probe) {
    client.kind = 'bot'
    client.label = 'Scanner'
  } else if (client.kind === 'human') {
    const known = await database.query(
      `SELECT client_label FROM site_visit_analytics
        WHERE visitor_date = CURRENT_DATE AND visitor_hash = $1
          AND client_label IN ('Scanner', 'Threat', 'Datacenter')
        LIMIT 1`,
      [visitorHash],
    )
    if (known.rows[0]) {
      client.kind = 'bot'
      client.label = known.rows[0].client_label
    }
  }

  await database.query(
    `INSERT INTO site_visit_analytics (
       visitor_date, visitor_hash, ip_address, visitor_kind, client_label,
       country_code, device_type, os_family, browser_family, topic_id, path,
       hits, first_seen_at, last_seen_at
     ) VALUES (CURRENT_DATE, $1, $2::inet, $3, $4, $5, $6, $7, $8, $9, $10, 1, now(), now())
     ON CONFLICT (visitor_date, visitor_hash, path) DO UPDATE SET
       ip_address = EXCLUDED.ip_address,
       visitor_kind = EXCLUDED.visitor_kind,
       client_label = EXCLUDED.client_label,
       country_code = COALESCE(EXCLUDED.country_code, site_visit_analytics.country_code),
       device_type = EXCLUDED.device_type,
       os_family = EXCLUDED.os_family,
       browser_family = EXCLUDED.browser_family,
       topic_id = COALESCE(EXCLUDED.topic_id, site_visit_analytics.topic_id),
       hits = site_visit_analytics.hits + 1,
       last_seen_at = now()` ,
    [
      visitorHash,
      ip,
      client.kind,
      client.label,
      countryCode,
      classifyDevice(userAgent),
      classifyOperatingSystem(userAgent),
      classifyBrowser(userAgent),
      topicId,
      path,
    ],
  )

  if (probe) await markVisitorAsBot(database, visitorHash, 'Scanner')

  staticaProfilePromise.then(async ({ country, security }) => {
    if (!countryCode && country) {
      await database.query(
        `UPDATE site_visit_analytics
            SET country_code = COALESCE(country_code, $1)
          WHERE visitor_date = CURRENT_DATE AND visitor_hash = $2 AND path = $3`,
        [country, visitorHash, path],
      )
    }
    const label = client.kind === 'human' ? botLabelFromStatica(security) : null
    if (label) await markVisitorAsBot(database, visitorHash, label)
  }).catch(() => {})

  await database.query(
    `DELETE FROM site_visit_analytics
      WHERE last_seen_at < now() - ($1::int * interval '1 day')`,
    [ANALYTICS_RETENTION_DAYS],
  )
  return { path, topicId, kind: client.kind, label: client.label }
}

// Reclassify every visit of this visitor today, including earlier ones that
// looked like a browser.
async function markVisitorAsBot(database, visitorHash, label) {
  await database.query(
    `UPDATE site_visit_analytics
        SET visitor_kind = 'bot', client_label = $2
      WHERE visitor_date = CURRENT_DATE AND visitor_hash = $1
        AND (visitor_kind = 'human' OR client_label = 'Other')`,
    [visitorHash, label],
  )
}

function boundedDays(value) {
  const days = Number.parseInt(String(value || '7'), 10)
  return [1, 7, 30].includes(days) ? days : 7
}

export function hiddenAnalyticsLabels(accessSettings = {}) {
  const labels = []
  if (accessSettings.threat === true) labels.push('Threat')
  if (accessSettings.datacenter === true) labels.push('Datacenter')
  if (accessSettings.scanner === true) labels.push('Scanner')
  return labels
}

export async function loadSiteAnalytics(database, daysInput = 7, { hiddenLabels = [] } = {}) {
  const days = boundedDays(daysInput)
  const params = [days]
  const labels = [...new Set(hiddenLabels.filter(label => ['Threat', 'Datacenter', 'Scanner'].includes(label)))]
  const visibilityWhere = labels.length
    ? ` AND coalesce(client_label, '') NOT IN (${labels.map((_, index) => `$${index + 2}`).join(', ')})`
    : ''
  params.push(...labels)
  const windowWhere = `last_seen_at >= now() - ($1::int * interval '1 day')${visibilityWhere}`

  const [summary, groups, topPages, recent] = await Promise.all([
    database.query(
      `SELECT count(DISTINCT visitor_hash)::int AS unique_visitors,
              coalesce(sum(hits), 0)::int AS page_views,
              count(DISTINCT visitor_hash) FILTER (WHERE visitor_kind = 'human')::int AS human_visitors,
              count(DISTINCT visitor_hash) FILTER (WHERE visitor_kind = 'bot')::int AS bot_visitors,
              max(last_seen_at) AS last_seen_at
         FROM site_visit_analytics
        WHERE ${windowWhere}`,
      params,
    ),
    database.query(
      `SELECT 'country' AS group_type, coalesce(nullif(country_code, ''), 'Unknown') AS label,
              count(DISTINCT visitor_hash)::int AS unique_visitors, coalesce(sum(hits), 0)::int AS hits
         FROM site_visit_analytics
        WHERE ${windowWhere}
        GROUP BY 2
       UNION ALL
       SELECT 'device', device_type, count(DISTINCT visitor_hash)::int, coalesce(sum(hits), 0)::int
         FROM site_visit_analytics
        WHERE ${windowWhere} AND visitor_kind = 'human'
        GROUP BY device_type
       UNION ALL
       SELECT 'browser', browser_family, count(DISTINCT visitor_hash)::int, coalesce(sum(hits), 0)::int
         FROM site_visit_analytics
        WHERE ${windowWhere} AND visitor_kind = 'human'
        GROUP BY browser_family
       UNION ALL
       SELECT 'bot', client_label, count(DISTINCT visitor_hash)::int, coalesce(sum(hits), 0)::int
         FROM site_visit_analytics
        WHERE ${windowWhere} AND visitor_kind = 'bot'
        GROUP BY client_label
        ORDER BY 1, 3 DESC, 4 DESC, 2
        LIMIT 100`,
      params,
    ),
    database.query(
      `SELECT s.path, t.page_number, t.slug,
              coalesce(current_revision.title, t.slug) AS title,
              count(DISTINCT s.visitor_hash)::int AS unique_visitors,
              coalesce(sum(s.hits), 0)::int AS hits
         FROM site_visit_analytics s
         JOIN topics t ON t.id = s.topic_id
         LEFT JOIN LATERAL (
           SELECT r.title
             FROM topic_current_revisions current_revision
             JOIN revisions r ON r.id = current_revision.revision_id
            WHERE current_revision.topic_id = t.id
            ORDER BY (current_revision.locale = 'en') DESC, r.created_at DESC
            LIMIT 1
         ) current_revision ON true
        WHERE ${windowWhere} AND s.topic_id IS NOT NULL
        GROUP BY s.path, t.page_number, t.slug, current_revision.title
        ORDER BY unique_visitors DESC, hits DESC, t.page_number DESC
        LIMIT 20`,
      params,
    ),
    database.query(
      `SELECT ip_address::text AS ip, coalesce(nullif(country_code, ''), 'Unknown') AS country,
              visitor_kind, client_label, device_type, os_family, browser_family,
              path, hits, last_seen_at
         FROM site_visit_analytics
        WHERE ${windowWhere}
        ORDER BY last_seen_at DESC
        LIMIT ${MAX_RECENT_ROWS}`,
      params,
    ),
  ])

  const grouped = { country: [], device: [], browser: [], bot: [] }
  for (const row of groups.rows) {
    if (grouped[row.group_type]) grouped[row.group_type].push({
      label: row.label,
      uniqueVisitors: Number(row.unique_visitors) || 0,
      hits: Number(row.hits) || 0,
    })
  }
  return {
    days,
    retentionDays: ANALYTICS_RETENTION_DAYS,
    summary: {
      uniqueVisitors: Number(summary.rows[0]?.unique_visitors) || 0,
      pageViews: Number(summary.rows[0]?.page_views) || 0,
      humanVisitors: Number(summary.rows[0]?.human_visitors) || 0,
      botVisitors: Number(summary.rows[0]?.bot_visitors) || 0,
      lastSeenAt: summary.rows[0]?.last_seen_at || null,
    },
    groups: grouped,
    topPages: topPages.rows.map(row => ({
      path: row.path,
      pageNumber: row.page_number,
      slug: row.slug,
      title: row.title,
      uniqueVisitors: Number(row.unique_visitors) || 0,
      hits: Number(row.hits) || 0,
    })),
    recent: recent.rows.map(row => ({
      ip: row.ip,
      country: row.country,
      kind: row.visitor_kind,
      label: row.client_label,
      device: row.device_type,
      os: row.os_family,
      browser: row.browser_family,
      path: row.path,
      hits: Number(row.hits) || 0,
      lastSeenAt: row.last_seen_at,
    })),
  }
}
