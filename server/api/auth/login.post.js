import { createError, readBody } from 'h3'
import { createHumanSession, enforceSameOrigin } from '../../utils/auth.js'
import { getDatabase } from '../../utils/database.js'
import { verifyPassword } from '../../utils/password.js'
import { enforceRateLimit } from '../../utils/rate-limit.js'

export default defineEventHandler(async (event) => {
  enforceSameOrigin(event)
  await enforceRateLimit(event, { action: 'login', limit: 12 })

  const body = await readBody(event)
  const login = String(body?.login || '').trim().normalize('NFKC')
  const password = String(body?.password || '')
  if (login.length < 1 || login.length > 254 || password.length < 1 || password.length > 256) {
    throw createError({ statusCode: 400, statusMessage: 'Enter your username or email and password.' })
  }

  const result = await getDatabase().query(
    `SELECT id, public_id, node_id, kind, username, email, role, password_hash
       FROM actors
      WHERE kind = 'human'
        AND account_status = 'active'
        AND (lower(username) = lower($1) OR lower(email) = lower($1))
      LIMIT 1`,
    [login],
  )
  const actor = result.rows[0]
  const verified = actor?.password_hash ? await verifyPassword(password, actor.password_hash) : false
  if (!verified) throw createError({ statusCode: 401, statusMessage: 'Invalid username/email or password.' })

  await createHumanSession(event, actor.id)
  await getDatabase().query(
    `INSERT INTO actor_audit_log (actor_id, action, target_type, target_id)
     VALUES ($1::uuid, 'signed_in', 'actor', $2::text)`,
    [actor.id, actor.id],
  )
  delete actor.password_hash
  return { actor }
})
