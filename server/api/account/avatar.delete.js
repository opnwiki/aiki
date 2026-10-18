import { createError } from 'h3'
import { enforceSameOrigin, requireHumanActor } from '../../utils/auth.js'
import { getDatabase } from '../../utils/database.js'
import { enforceRateLimit } from '../../utils/rate-limit.js'

export default defineEventHandler(async (event) => {
  enforceSameOrigin(event)
  const actor = await requireHumanActor(event)
  await enforceRateLimit(event, { action: 'avatar-delete', limit: 10 })

  const database = getDatabase()
  const client = await database.connect()
  try {
    await client.query('BEGIN')
    const deleted = await client.query(
      `DELETE FROM actor_avatars
        WHERE actor_id = $1 AND source = 'upload'
        RETURNING actor_id`,
      [actor.id],
    )
    if (!deleted.rows[0]) throw createError({ statusCode: 404, statusMessage: 'Custom avatar not found.' })
    const updated = await client.query(
      `UPDATE actors
          SET avatar_preference = CASE WHEN avatar_preference = 'custom' THEN 'statica' ELSE avatar_preference END
        WHERE id = $1 AND kind = 'human' AND account_status = 'active'
        RETURNING avatar_preference`,
      [actor.id],
    )
    await client.query('COMMIT')
    return { avatarPreference: updated.rows[0]?.avatar_preference || 'statica' }
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
})
