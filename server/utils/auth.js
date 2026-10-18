import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import { createError, deleteCookie, getCookie, getRequestURL, setCookie } from 'h3'
import { getDatabase, queryDatabase } from './database.js'
import { clientIpForEvent } from './access-control.js'
import { refreshAvatarSources } from './avatar-sources.js'

const SESSION_COOKIE = 'aiki_session'
const SESSION_LIFETIME_SECONDS = 60 * 60 * 24 * 14
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/

export function hashSecret(value) {
  return createHash('sha256').update(String(value)).digest('hex')
}

export function createOpaqueToken() {
  return randomBytes(32).toString('base64url')
}

export function safeEqualHex(actual, expected) {
  if (typeof actual !== 'string' || typeof expected !== 'string' || !/^[a-f0-9]{64}$/i.test(actual) || !/^[a-f0-9]{64}$/i.test(expected)) return false
  return timingSafeEqual(Buffer.from(actual, 'hex'), Buffer.from(expected, 'hex'))
}

export function setHumanSession(event, token) {
  setCookie(event, SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: SESSION_LIFETIME_SECONDS,
  })
}

export function clearHumanSession(event) {
  deleteCookie(event, SESSION_COOKIE, { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', path: '/' })
}

export async function createHumanSession(event, actorId) {
  const token = createOpaqueToken()
  await queryDatabase(
    `INSERT INTO human_sessions (actor_id, token_hash, expires_at)
     VALUES ($1, $2, now() + ($3 * interval '1 second'))`,
    [actorId, hashSecret(token), SESSION_LIFETIME_SECONDS],
  )
  setHumanSession(event, token)
}

export async function revokeHumanSession(event) {
  const token = getCookie(event, SESSION_COOKIE)
  if (token && TOKEN_PATTERN.test(token)) {
    await queryDatabase('UPDATE human_sessions SET revoked_at = now() WHERE token_hash = $1 AND revoked_at IS NULL', [hashSecret(token)])
  }
  clearHumanSession(event)
}

export async function getHumanActor(event) {
  const token = getCookie(event, SESSION_COOKIE)
  if (!token || !TOKEN_PATTERN.test(token)) return null

  const tokenHash = hashSecret(token)
  const result = await queryDatabase(
    `SELECT a.id, a.public_id, a.node_id, a.kind, a.username, a.display_name, a.email, a.role, a.avatar_preference, a.show_author, a.federation_enabled, a.created_at
       FROM human_sessions s
       JOIN actors a ON a.id = s.actor_id
      WHERE s.token_hash = $1
        AND s.revoked_at IS NULL
        AND s.expires_at > now()
        AND a.kind = 'human'
        AND a.account_status = 'active'
      LIMIT 1`,
    [tokenHash],
  )
  if (!result.rows[0]) return null

  await queryDatabase('UPDATE human_sessions SET last_seen_at = now() WHERE token_hash = $1', [tokenHash])
  // The page middleware sees the visitor's real IP; internal SSR sub-requests
  // carry a loopback address and Statica skips them.
  refreshAvatarSources(getDatabase(), result.rows[0], clientIpForEvent(event))
  return result.rows[0]
}

export async function requireHumanActor(event) {
  const actor = await getHumanActor(event)
  if (!actor) throw createError({ statusCode: 401, statusMessage: 'Sign in to continue' })
  return actor
}

export async function requireNodeAdmin(event) {
  const actor = await requireHumanActor(event)
  if (!['owner', 'admin'].includes(actor.role)) {
    throw createError({ statusCode: 403, statusMessage: 'Only a node owner or admin can change project settings.' })
  }
  return actor
}

export async function requirePageReportReviewer(event) {
  const actor = await requireHumanActor(event)
  if (!['owner', 'admin', 'moderator'].includes(actor.role)) {
    throw createError({ statusCode: 403, statusMessage: 'A moderator must review page reports.' })
  }
  return actor
}

export async function requireProposalReviewer(event, authorId) {
  const actor = await requireHumanActor(event)
  if (!['owner', 'admin', 'moderator'].includes(actor.role)) {
    throw createError({ statusCode: 403, statusMessage: 'A moderator must review this proposal.' })
  }
  if (actor.id === authorId) {
    throw createError({ statusCode: 403, statusMessage: 'You cannot review your own proposal.' })
  }
  return actor
}

export function enforceSameOrigin(event) {
  const method = event.method?.toUpperCase()
  if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) return

  const origin = event.node.req.headers.origin
  const fetchSite = event.node.req.headers['sec-fetch-site']
  if (fetchSite && fetchSite !== 'same-origin' && fetchSite !== 'same-site' && fetchSite !== 'none') {
    throw createError({ statusCode: 403, statusMessage: 'Cross-site request blocked' })
  }
  if (!origin) {
    if (fetchSite === 'same-origin') return
    throw createError({ statusCode: 403, statusMessage: 'Request origin could not be verified' })
  }

  let requestOrigin
  let suppliedOrigin
  try {
    requestOrigin = new URL(getRequestURL(event).origin)
    suppliedOrigin = new URL(origin)
  } catch {
    throw createError({ statusCode: 403, statusMessage: 'Invalid request origin' })
  }
  if (requestOrigin.origin !== suppliedOrigin.origin) {
    throw createError({ statusCode: 403, statusMessage: 'Cross-origin request blocked' })
  }
}
