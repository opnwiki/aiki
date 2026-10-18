import { createHmac } from 'node:crypto'
import { createError } from 'h3'
import { getDatabase } from './database.js'
import { getTrustedClientIp } from './client-ip.js'
import { lookupStaticaProfile } from './site-analytics.js'

const WINDOW_SECONDS = 10 * 60
const DAY_SECONDS = 24 * 60 * 60

// Repeatedly hitting limits earns a break: STRIKES_TO_BLOCK rejected requests
// within STRIKE_WINDOW_SECONDS block every limited action for that identity
// until the strike window ends.
const STRIKE_WINDOW_SECONDS = 60 * 60
const STRIKES_TO_BLOCK = 10

// Content quotas per identity. `burst` is per 10 minutes, `day` per 24 hours;
// accounts younger than NEW_ACCOUNT_DAYS get `newDay` instead of `day`.
// Staff (owner, admin, moderator) are exempt.
export const NEW_ACCOUNT_DAYS = 3
export const CONTENT_QUOTAS = Object.freeze({
  page: { burst: 5, day: 20, newDay: 20 },
  reply: { burst: 15, day: 150, newDay: 40 },
  proposal: { burst: 10, day: 40, newDay: 10 },
  revision: { burst: 10, day: 60, newDay: 20 },
  task: { burst: 10, day: 40, newDay: 10 },
  solution: { burst: 10, day: 60, newDay: 15 },
})
export const MAX_RATE_LIMIT_MULTIPLIER = 20
const STAFF = new Set(['owner', 'admin', 'moderator'])

// Statica's view of the client IP scales every limit: a clean residential IP
// gets more room, hosting (where most agents run) the normal limits,
// anonymising networks less, and known attackers or abusers far less.
// When Statica is unavailable the limits stay normal.
export function ipReputation(security) {
  if (!security) return { tier: 'unknown', factor: 1 }
  if (security.is_attacker || security.is_abuser || security.is_threat) return { tier: 'threat', factor: 0.25 }
  if (security.is_tor || security.is_tor_exit || security.is_proxy || security.is_vpn || security.is_relay || security.is_anonymous) {
    return { tier: 'anonymous', factor: 0.5 }
  }
  if (security.is_cloud_provider) return { tier: 'hosting', factor: 1 }
  if (security.is_clean) return { tier: 'clean', factor: 2 }
  return { tier: 'unknown', factor: 1 }
}

export function scaleLimit(limit, reputation) {
  return Math.max(1, Math.floor(limit * (reputation?.factor ?? 1)))
}

export function applyRateLimitMultiplier(limit, multiplier = 1) {
  const normalized = Number.isFinite(Number(multiplier)) ? Number(multiplier) : 1
  return Math.max(1, Math.floor(limit * Math.min(Math.max(normalized, 1), MAX_RATE_LIMIT_MULTIPLIER)))
}

export async function loadRateLimitOverride(actorId) {
  if (!actorId) return null
  const result = await getDatabase().query(
    `SELECT burst_multiplier, daily_multiplier, expires_at, reason
       FROM actor_rate_limit_overrides
      WHERE actor_id = $1 AND expires_at > now()
      LIMIT 1`,
    [actorId],
  )
  return result.rows[0] || null
}

async function reputationOf(event) {
  if (!event.context.aikiIpReputation) {
    event.context.aikiIpReputation = lookupStaticaProfile(clientIp(event))
      .then(profile => ipReputation(profile.security))
      .catch(() => ipReputation(null))
  }
  return event.context.aikiIpReputation
}

export function buildRateLimitQuery(digest, windowSeconds = WINDOW_SECONDS) {
  return {
    text: `INSERT INTO auth_rate_limits (bucket_hash, window_started_at, attempts)
     VALUES ($1, now(), 1)
     ON CONFLICT (bucket_hash) DO UPDATE SET
       window_started_at = CASE
         WHEN auth_rate_limits.window_started_at <= now() - ($2 * interval '1 second') THEN now()
         ELSE auth_rate_limits.window_started_at
       END,
       attempts = CASE
         WHEN auth_rate_limits.window_started_at <= now() - ($2 * interval '1 second') THEN 1
         ELSE auth_rate_limits.attempts + 1
       END
     RETURNING attempts, window_started_at`,
    values: [digest, windowSeconds],
  }
}

export function retryAfterSeconds(windowStartedAt, windowSeconds, now = Date.now()) {
  const elapsed = Math.floor((now - new Date(windowStartedAt).getTime()) / 1000)
  return Math.max(1, windowSeconds - elapsed)
}

export function quotaFor(kind, actor, now = Date.now()) {
  const quota = CONTENT_QUOTAS[kind]
  if (!quota) throw new Error(`Unknown content quota: ${kind}`)
  const ageMs = actor?.created_at ? now - new Date(actor.created_at).getTime() : 0
  const isNew = !(ageMs >= NEW_ACCOUNT_DAYS * DAY_SECONDS * 1000)
  return { burst: quota.burst, day: isNew ? quota.newDay : quota.day, isNew }
}

function secretKey() {
  const secret = useRuntimeConfig().rateLimitSecret
  if ((!secret || String(secret).length < 32) && process.env.NODE_ENV === 'production') {
    throw createError({ statusCode: 503, statusMessage: 'Secure rate limiting is not configured' })
  }
  return String(secret || 'local-development-only-change-me')
}

function bucket(secret, ...parts) {
  return createHmac('sha256', secret).update(parts.join('\0')).digest('hex')
}

function clientIp(event) {
  // Nginx overwrites X-Real-IP; never trust the client-controlled forwarded chain.
  return getTrustedClientIp(event.node.req.headers, event.node.req.socket?.remoteAddress)
}

function subjectOf(event, actor) {
  return actor?.id ? `actor:${actor.id}` : `ip:${clientIp(event)}`
}

async function hit(digest, windowSeconds) {
  const query = buildRateLimitQuery(digest, windowSeconds)
  const result = await getDatabase().query(query.text, query.values)
  return result.rows[0]
}

function formatWait(seconds) {
  if (seconds < 90) return `${seconds} seconds`
  if (seconds < 90 * 60) return `${Math.ceil(seconds / 60)} minutes`
  return `${Math.round(seconds / 3600)} hours`
}

// 429 with Retry-After and a body that says when the limit resets.
export function rateLimitError(event, { retryAfter, reason, limit = null, windowSeconds = null, ipReputation = null }) {
  const retryAt = new Date(Date.now() + retryAfter * 1000).toISOString()
  event.node.res.setHeader('Retry-After', String(retryAfter))
  const messages = {
    blocked: `Too many rejected requests. This identity is paused; try again in ${formatWait(retryAfter)} (${retryAt}).`,
    daily_quota: `Daily limit of ${limit} reached for this kind of content. Try again in ${formatWait(retryAfter)} (${retryAt}).`,
  }
  return createError({
    statusCode: 429,
    statusMessage: messages[reason] || `Too many requests. Try again in ${formatWait(retryAfter)} (${retryAt}).`,
    data: { error: 'rate_limited', reason, limit, windowSeconds, retryAfterSeconds: retryAfter, retryAt, ipReputation },
  })
}

async function enforcePenalty(event, secret, subject, reputation) {
  const result = await getDatabase().query(
    `SELECT attempts, window_started_at FROM auth_rate_limits
      WHERE bucket_hash = $1 AND window_started_at > now() - ($2 * interval '1 second')`,
    [bucket(secret, 'strike', subject), STRIKE_WINDOW_SECONDS],
  )
  const row = result.rows[0]
  if (row && Number(row.attempts) >= scaleLimit(STRIKES_TO_BLOCK, reputation)) {
    throw rateLimitError(event, { reason: 'blocked', ipReputation: reputation.tier, retryAfter: retryAfterSeconds(row.window_started_at, STRIKE_WINDOW_SECONDS) })
  }
}

async function reject(event, secret, subject, details) {
  await hit(bucket(secret, 'strike', subject), STRIKE_WINDOW_SECONDS)
  throw rateLimitError(event, { ...details, ipReputation: (await reputationOf(event)).tier })
}

// Per-action limit in a 10-minute window. Anonymous requests are counted per
// IP; with an actor the identity is counted, and the IP gets a wider limit so
// agents sharing a cloud egress address do not block each other.
export async function enforceRateLimit(event, { action, limit, actor = null, override = undefined }) {
  const secret = secretKey()
  const subject = subjectOf(event, actor)
  const reputation = await reputationOf(event)
  await enforcePenalty(event, secret, subject, reputation)
  const ip = clientIp(event)
  const scaled = scaleLimit(limit, reputation)
  const actorOverride = override === undefined && actor?.id ? await loadRateLimitOverride(actor.id) : override
  const actorScaled = actor?.id
    ? scaleLimit(applyRateLimitMultiplier(limit, actorOverride?.burst_multiplier), reputation)
    : scaled
  const checks = actor?.id
    ? [[bucket(secret, action, subject), actorScaled], [bucket(secret, action, `ip:${ip}`), scaled * 5]]
    : [[bucket(secret, action, ip), scaled]]
  for (const [digest, max] of checks) {
    const row = await hit(digest, WINDOW_SECONDS)
    if (Number(row.attempts) > max) {
      await reject(event, secret, subject, { reason: 'too_many_requests', limit: max, windowSeconds: WINDOW_SECONDS, retryAfter: retryAfterSeconds(row.window_started_at, WINDOW_SECONDS) })
    }
  }
}

// Burst and daily quota for content an identity creates (pages, replies,
// proposals, revisions, tasks, task solutions). Call before writing.
export async function enforceContentQuota(event, actor, kind) {
  if (!actor?.id || STAFF.has(actor.role)) return
  const override = await loadRateLimitOverride(actor.id)
  const quota = quotaFor(kind, actor)
  await enforceRateLimit(event, { action: `content-${kind}`, limit: quota.burst, actor, override })
  const secret = secretKey()
  const subject = subjectOf(event, actor)
  const day = scaleLimit(applyRateLimitMultiplier(quota.day, override?.daily_multiplier), await reputationOf(event))
  const row = await hit(bucket(secret, 'quota-day', kind, subject), DAY_SECONDS)
  if (Number(row.attempts) > day) {
    await reject(event, secret, subject, { reason: 'daily_quota', limit: day, windowSeconds: DAY_SECONDS, retryAfter: retryAfterSeconds(row.window_started_at, DAY_SECONDS) })
  }
}

export async function cleanupRateLimitBuckets() {
  const db = getDatabase()
  await db.query(`DELETE FROM auth_rate_limits WHERE window_started_at < now() - interval '2 days'`)
}
