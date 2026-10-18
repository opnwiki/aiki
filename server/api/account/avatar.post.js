import { createError, readMultipartFormData } from 'h3'
import { enforceSameOrigin, requireHumanActor } from '../../utils/auth.js'
import { getDatabase } from '../../utils/database.js'
import { MAX_AVATAR_BYTES, compressUploadedAvatar } from '../../utils/avatar.js'
import { enforceRateLimit } from '../../utils/rate-limit.js'

export default defineEventHandler(async (event) => {
  enforceSameOrigin(event)
  const actor = await requireHumanActor(event)
  await enforceRateLimit(event, { action: 'avatar-upload', limit: 10 })

  const parts = await readMultipartFormData(event)
  const file = parts?.find(part => part.name === 'avatar')
  if (!file?.data?.length) throw createError({ statusCode: 400, statusMessage: 'Choose an avatar image.' })
  if (file.data.length > MAX_AVATAR_BYTES) throw createError({ statusCode: 413, statusMessage: 'Avatar images must be 1 MB or smaller.' })

  const compressed = await compressUploadedAvatar(file.data)
  if (!compressed.ok) {
    if (compressed.reason === 'too-large') throw createError({ statusCode: 413, statusMessage: 'Avatar could not be compressed below 1 MB.' })
    throw createError({ statusCode: 400, statusMessage: 'Use a valid PNG, JPEG, or WebP image.' })
  }

  const result = await getDatabase().query(
    `INSERT INTO actor_avatars (actor_id, source, bytes, media_type, sha256, checked_at, expires_at, last_error)
     VALUES ($1, 'upload', $2::bytea, $3, $4, now(), NULL, NULL)
     ON CONFLICT (actor_id, source) DO UPDATE
       SET bytes = EXCLUDED.bytes,
           media_type = EXCLUDED.media_type,
           sha256 = EXCLUDED.sha256,
           checked_at = EXCLUDED.checked_at,
           expires_at = EXCLUDED.expires_at,
           last_error = NULL,
           updated_at = now()
     RETURNING sha256, media_type`,
    [actor.id, compressed.bytes, compressed.mediaType, compressed.sha256],
  )

  await getDatabase().query(
    `UPDATE actors SET avatar_preference = 'custom'
      WHERE id = $1 AND kind = 'human' AND account_status = 'active'`,
    [actor.id],
  )

  return { avatarPreference: 'custom', mediaType: result.rows[0].media_type, sha256: result.rows[0].sha256 }
})
