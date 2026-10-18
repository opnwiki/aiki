import { createError, readBody } from 'h3'
import { createHumanSession, enforceSameOrigin, requireHumanActor, revokeHumanSession } from '../../utils/auth.js'
import { getDatabase } from '../../utils/database.js'
import { hashPassword, verifyPassword } from '../../utils/password.js'
import { enforceRateLimit } from '../../utils/rate-limit.js'

export default defineEventHandler(async (event) => {
  enforceSameOrigin(event)
  const human = await requireHumanActor(event)
  await enforceRateLimit(event, { action: 'change-password', limit: 5 })

  const body = await readBody(event)
  const fields = Object.keys(body || {})
  if (fields.some((field) => !['currentPassword', 'newPassword'].includes(field))) {
    throw createError({ statusCode: 400, statusMessage: 'Only currentPassword and newPassword are accepted.' })
  }

  const currentPassword = String(body?.currentPassword || '')
  const newPassword = String(body?.newPassword || '')
  if (newPassword.length < 12 || newPassword.length > 256) {
    throw createError({ statusCode: 400, statusMessage: 'Password must be 12–256 characters.' })
  }

  const client = await getDatabase().connect()
  try {
    await client.query('BEGIN')
    const result = await client.query(
      `SELECT password_hash
         FROM actors
        WHERE id = $1 AND kind = 'human' AND account_status = 'active'
        FOR UPDATE`,
      [human.id],
    )
    const passwordHash = result.rows[0]?.password_hash || null
    if (passwordHash && !currentPassword) {
      throw createError({ statusCode: 400, statusMessage: 'Enter your current password.' })
    }
    if (passwordHash && !(await verifyPassword(currentPassword, passwordHash))) {
      throw createError({ statusCode: 401, statusMessage: 'Current password is incorrect.' })
    }

    const nextHash = await hashPassword(newPassword)
    await client.query('UPDATE actors SET password_hash = $1, must_change_password = false WHERE id = $2', [nextHash, human.id])
    await client.query(
      `UPDATE human_sessions
          SET revoked_at = now()
        WHERE actor_id = $1 AND revoked_at IS NULL`,
      [human.id],
    )
    await client.query(
      `INSERT INTO actor_audit_log (actor_id, action, target_type, target_id)
       VALUES ($1::uuid, 'password_changed', 'actor', $1::text)`,
      [human.id],
    )
    await client.query('COMMIT')
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }

  await revokeHumanSession(event)
  await createHumanSession(event, human.id)
  return { ok: true, passwordSet: true }
})
