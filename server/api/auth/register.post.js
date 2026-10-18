import { createError, readBody, setResponseStatus } from 'h3'
import { createHumanSession, enforceSameOrigin } from '../../utils/auth.js'
import { getDatabase } from '../../utils/database.js'
import { hashPassword } from '../../utils/password.js'
import { enforceRateLimit } from '../../utils/rate-limit.js'
import { FEDERATION_RESERVED_HANDLES, federationHandleTakenSql, pageSlugTakenSql, generateUsernameCandidate, validateUsername } from '../../utils/usernames.js'

export default defineEventHandler(async (event) => {
  enforceSameOrigin(event)
  await enforceRateLimit(event, { action: 'register', limit: 5 })

  const input = await readBody(event)
  const displayName = String(input?.username || '').normalize('NFKC').trim()
  const email = String(input?.email || '').trim().toLowerCase()
  const password = String(input?.password || '')

  if (displayName && !validateUsername(displayName).ok) {
    throw createError({ statusCode: 400, statusMessage: 'Username must be 3–32 letters, numbers, underscores, or hyphens.' })
  }
  if (displayName && FEDERATION_RESERVED_HANDLES.has(displayName.toLowerCase())) {
    throw createError({ statusCode: 400, statusMessage: 'That username is reserved for an AIKI Fediverse channel.' })
  }
  if (email && (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))) {
    throw createError({ statusCode: 400, statusMessage: 'Email address is invalid.' })
  }
  if (password.length < 12 || password.length > 256) {
    throw createError({ statusCode: 400, statusMessage: 'Password must be 12–256 characters.' })
  }

  const passwordHash = await hashPassword(password)
  const pool = getDatabase()
  const client = await pool.connect()
  let actor

  try {
    await client.query('BEGIN')
    await client.query('LOCK TABLE actors IN SHARE ROW EXCLUSIVE MODE')
    const existing = await client.query('SELECT id FROM actors WHERE kind = $1 LIMIT 1', ['human'])
    const registration = await client.query('SELECT registration_open FROM nodes WHERE is_home LIMIT 1')
    if (existing.rowCount > 0 && registration.rows[0]?.registration_open === false) {
      throw createError({ statusCode: 403, statusMessage: 'Registration is closed on this node.' })
    }
    const role = existing.rowCount === 0 ? 'owner' : 'member'
    const nodeResult = await client.query('SELECT id FROM nodes WHERE is_home = true LIMIT 1')
    const nodeId = nodeResult.rows[0]?.id || null
    const username = await selectUsername(client, nodeId, displayName)
    const inserted = await client.query(
      `INSERT INTO actors (node_id, kind, username, email, password_hash, role)
       VALUES ($1, 'human', $2, NULLIF($3::text, ''), $4, $5)
       RETURNING id, public_id, node_id, kind, username, email, role, created_at`,
      [nodeId, username, email, passwordHash, role],
    )
    actor = inserted.rows[0]
    await client.query(
      `INSERT INTO actor_audit_log (actor_id, action, target_type, target_id, details)
       VALUES ($1::uuid, 'account_registered', 'actor', $2::text, jsonb_build_object('role', $3::text, 'public_id', $4::text))`,
      [actor.id, actor.id, role, String(actor.public_id)],
    )
    await client.query('COMMIT')
  } catch (error) {
    await client.query('ROLLBACK')
    if (error.code === '23505') throw createError({ statusCode: 409, statusMessage: 'Account details are already in use.' })
    throw error
  } finally {
    client.release()
  }

  await createHumanSession(event, actor.id)
  setResponseStatus(event, 201)
  return { actor }
})

async function selectUsername(client, nodeId, requested) {
  if (requested) {
    const result = await client.query(
      `SELECT 1 FROM actors WHERE node_id IS NOT DISTINCT FROM $1 AND lower(username) = lower($2)
       UNION ALL ${federationHandleTakenSql('$2')}
       UNION ALL ${pageSlugTakenSql('$2')} LIMIT 1`,
      [nodeId, requested],
    )
    if (result.rowCount === 0 && !FEDERATION_RESERVED_HANDLES.has(requested.toLowerCase())) return requested
  }

  for (let attempt = 0; attempt < 20; attempt += 1) {
    const base = generateUsernameCandidate()
    const candidate = attempt < 10 ? base : `${base}-${attempt - 9}`
    const result = await client.query('SELECT 1 FROM actors WHERE lower(username) = lower($1) LIMIT 1', [candidate])
    if (result.rowCount === 0) return candidate
  }
  throw createError({ statusCode: 503, statusMessage: 'Could not assign a username right now.' })
}
