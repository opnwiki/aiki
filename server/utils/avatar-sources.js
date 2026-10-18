import { createHash, createHmac } from 'node:crypto'
import { compressUploadedAvatar, MAX_AVATAR_BYTES } from './avatar.js'
import { lookupStaticaProfile } from './site-analytics.js'

// Statica and Gravatar pictures never reach a browser or a Fediverse server
// from their own hosts: the Statica URL carries an ID tied to the visitor's IP
// and the Gravatar URL carries an email hash. AIKI downloads the picture,
// re-encodes it (dropping metadata) and serves it from
// /api/actors/<publicId>/avatar. The stored source_key is an HMAC of the
// Statica image ID, or Gravatar's own email hash (as the schema requires);
// never an IP, an email address or a provider URL.
const STATICA_IMAGE_URL = /^https:\/\/statica\.me\/s\/([A-Za-z0-9_-]{1,128})\.png$/
const REFRESH_DAYS = 7
const FETCH_TIMEOUT_MS = 5_000
// Skip the database check for an hour once the cache is known to be fresh.
const CHECKED_MS = 60 * 60_000
const RETRY_MS = 10 * 60_000
// Someone without a Gravatar is asked again a day later, not on every request.
const NO_GRAVATAR_MS = 24 * 60 * 60_000
const pending = new Set()
const retryAfter = new Map()

function remember(key, ms) {
  if (retryAfter.size > 10_000) retryAfter.clear()
  retryAfter.set(key, Date.now() + ms)
}

function busy(key) {
  return pending.has(key) || (retryAfter.get(key) || 0) > Date.now()
}

export function staticaImageUrl(payload) {
  const anonical = payload?.anonical
  if (!anonical || typeof anonical !== 'object' || anonical.render_ok === false) return null
  const link = typeof anonical.link === 'string' ? anonical.link.trim() : ''
  return STATICA_IMAGE_URL.test(link) ? link : null
}

export function staticaSourceKey(imageUrl, secret = hmacSecret()) {
  const id = STATICA_IMAGE_URL.exec(imageUrl)?.[1]
  return id ? createHmac('sha256', String(secret)).update(`statica-avatar\0${id}`).digest('hex') : null
}

// Gravatar's own key: MD5 of the trimmed, lower-cased address.
export function gravatarHash(email) {
  const normalized = typeof email === 'string' ? email.trim().toLowerCase() : ''
  return normalized.includes('@') ? createHash('md5').update(normalized).digest('hex') : null
}

export function gravatarImageUrl(hash) {
  return /^[0-9a-f]{32}$/.test(hash || '') ? `https://www.gravatar.com/avatar/${hash}?s=512&d=404` : null
}

function isPublicIp(ip) {
  const value = String(ip || '').toLowerCase().replace(/^::ffff:/, '')
  if (!value) return false
  return !/^(127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|169\.254\.|0\.)/.test(value)
    && !/^(::1?$|fc|fd|fe80:)/.test(value)
}

function hmacSecret() {
  return process.env.READ_HMAC_SECRET || process.env.RATE_LIMIT_SECRET || 'local-development-only-change-me'
}

// Returns the bytes, or null when the provider says there is no picture (404).
async function downloadImage(url, fetchImpl) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
  try {
    const response = await fetchImpl(url, { redirect: 'error', signal: controller.signal, headers: { accept: 'image/png,image/jpeg,image/webp,image/*' } })
    if (response.status === 404) return null
    if (!response.ok) throw new Error(`Avatar provider returned ${response.status}`)
    if (Number(response.headers.get('content-length') || 0) > MAX_AVATAR_BYTES) throw new Error('Avatar image is too large')
    const bytes = Buffer.from(await response.arrayBuffer())
    if (bytes.length > MAX_AVATAR_BYTES) throw new Error('Avatar image is too large')
    return bytes
  } finally {
    clearTimeout(timer)
  }
}

async function storeAvatar(database, actorId, source, bytes, sourceKey) {
  const compressed = await compressUploadedAvatar(bytes)
  if (!compressed.ok) throw new Error('Avatar image is not a valid picture')
  await database.query(
    `INSERT INTO actor_avatars (actor_id, source, bytes, media_type, sha256, source_key, checked_at, expires_at, last_error)
     VALUES ($1, $2, $3::bytea, $4, $5, $6, now(), now() + make_interval(days => $7), NULL)
     ON CONFLICT (actor_id, source) DO UPDATE
       SET bytes = EXCLUDED.bytes, media_type = EXCLUDED.media_type, sha256 = EXCLUDED.sha256,
           source_key = EXCLUDED.source_key, checked_at = EXCLUDED.checked_at,
           expires_at = EXCLUDED.expires_at, last_error = NULL, updated_at = now()`,
    [actorId, source, compressed.bytes, compressed.mediaType, compressed.sha256, sourceKey, REFRESH_DAYS],
  )
}

async function recordFailure(database, actorId, source, error) {
  // Keep the previous picture; the row is retried after an hour.
  await database.query(
    `UPDATE actor_avatars SET last_error = $3, checked_at = now(), expires_at = now() + interval '1 hour', updated_at = now()
      WHERE actor_id = $1 AND source = $2`,
    [actorId, source, String(error instanceof Error ? error.message : error).slice(0, 200)],
  ).catch(() => {})
}

async function cachedRow(database, actorId, source) {
  const result = await database.query(
    'SELECT source_key, expires_at FROM actor_avatars WHERE actor_id = $1 AND source = $2',
    [actorId, source],
  )
  const row = result.rows[0]
  return row ? { sourceKey: row.source_key, fresh: Boolean(row.expires_at) && new Date(row.expires_at).getTime() > Date.now() } : null
}

export async function refreshStaticaAvatar(database, actorId, ip, { fetchImpl = fetch, lookupProfile = lookupStaticaProfile } = {}) {
  const key = `statica:${actorId}`
  if (!actorId || !isPublicIp(ip) || busy(key)) return false
  pending.add(key)
  try {
    if ((await cachedRow(database, actorId, 'statica'))?.fresh) {
      remember(key, CHECKED_MS)
      return false
    }
    await lookupProfile(ip)
    const stored = await database.query('SELECT payload FROM ip_statica_profiles WHERE ip = $1::inet', [ip])
    const imageUrl = staticaImageUrl(stored.rows[0]?.payload)
    if (!imageUrl) return false
    const bytes = await downloadImage(imageUrl, fetchImpl)
    if (!bytes) throw new Error('Statica image is missing')
    await storeAvatar(database, actorId, 'statica', bytes, staticaSourceKey(imageUrl))
    remember(key, CHECKED_MS)
    return true
  } catch (error) {
    remember(key, RETRY_MS)
    await recordFailure(database, actorId, 'statica', error)
    return false
  } finally {
    pending.delete(key)
  }
}

export async function refreshGravatarAvatar(database, actorId, email, { fetchImpl = fetch } = {}) {
  const key = `gravatar:${actorId}`
  if (!actorId || busy(key)) return false
  pending.add(key)
  try {
    const hash = gravatarHash(email)
    const current = await cachedRow(database, actorId, 'gravatar')
    if (!hash) {
      // The address was removed: drop the picture it pointed to.
      if (current) await database.query(`DELETE FROM actor_avatars WHERE actor_id = $1 AND source = 'gravatar'`, [actorId])
      remember(key, NO_GRAVATAR_MS)
      return false
    }
    // A changed address invalidates the cached picture at once.
    if (current?.fresh && current.sourceKey === hash) {
      remember(key, CHECKED_MS)
      return false
    }
    const bytes = await downloadImage(gravatarImageUrl(hash), fetchImpl)
    if (!bytes) {
      if (current) await database.query(`DELETE FROM actor_avatars WHERE actor_id = $1 AND source = 'gravatar'`, [actorId])
      remember(key, NO_GRAVATAR_MS)
      return false
    }
    await storeAvatar(database, actorId, 'gravatar', bytes, hash)
    remember(key, CHECKED_MS)
    return true
  } catch (error) {
    remember(key, RETRY_MS)
    await recordFailure(database, actorId, 'gravatar', error)
    return false
  } finally {
    pending.delete(key)
  }
}

// Fire-and-forget from request handlers; never fails the request.
export function refreshAvatarSources(database, actor, ip) {
  if (!actor?.id) return
  void refreshStaticaAvatar(database, actor.id, ip).catch(() => {})
  void refreshGravatarAvatar(database, actor.id, actor.email).catch(() => {})
}
