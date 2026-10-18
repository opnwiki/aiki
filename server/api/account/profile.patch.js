import { createError, readBody } from 'h3'
import { enforceSameOrigin, requireHumanActor } from '../../utils/auth.js'
import { getDatabase } from '../../utils/database.js'
import { normalizeAvatarPreference } from '../../utils/avatar.js'
import { validateFederationUsername } from '../../utils/usernames.js'

export default defineEventHandler(async (event) => {
  enforceSameOrigin(event)
  const actor = await requireHumanActor(event)
  const body = await readBody(event)
  const fields = Object.keys(body || {})
  if (fields.some(field => !['displayName', 'avatarPreference', 'showAuthor', 'federationEnabled'].includes(field))) {
    throw createError({ statusCode: 400, statusMessage: 'Only displayName, avatarPreference, showAuthor, and federationEnabled are accepted.' })
  }

  const hasDisplayName = Object.prototype.hasOwnProperty.call(body || {}, 'displayName')
  const raw = body?.displayName
  if (raw !== undefined && raw !== null && typeof raw !== 'string') {
    throw createError({ statusCode: 400, statusMessage: 'Display name must be text.' })
  }
  const displayName = typeof raw === 'string' ? raw.normalize('NFKC').replace(/\s+/g, ' ').trim() : ''
  if (hasDisplayName && (displayName.length > 80 || /[\u0000-\u001f\u007f]/.test(displayName))) {
    throw createError({ statusCode: 400, statusMessage: 'Display name must be at most 80 characters.' })
  }

  const avatarPreference = body?.avatarPreference === undefined
    ? null
    : normalizeAvatarPreference(body.avatarPreference)
  if (body?.avatarPreference !== undefined && !avatarPreference) {
    throw createError({ statusCode: 400, statusMessage: 'Choose custom, statica, or gravatar for the avatar.' })
  }
  const showAuthor = body?.showAuthor === undefined ? null : body.showAuthor
  if (showAuthor !== null && typeof showAuthor !== 'boolean') {
    throw createError({ statusCode: 400, statusMessage: 'Choose whether your name is shown on pages by default.' })
  }
  const federationEnabled = body?.federationEnabled === undefined ? null : body.federationEnabled
  if (federationEnabled !== null && typeof federationEnabled !== 'boolean') {
    throw createError({ statusCode: 400, statusMessage: 'Choose whether your public actor is enabled.' })
  }
  // Only turning the actor on needs a Fediverse-compatible username; resaving an
  // already-on profile with another username keeps working (the actor is just not served).
  if (federationEnabled === true && actor.federation_enabled !== true) {
    const checkedUsername = validateFederationUsername(actor.username)
    if (!checkedUsername.ok) throw createError({ statusCode: 400, statusMessage: checkedUsername.error })
  }

  const updated = await getDatabase().query(
    `UPDATE actors
        SET display_name = CASE WHEN $1::boolean THEN NULLIF($2::text, '') ELSE display_name END,
            avatar_preference = COALESCE($3::text, avatar_preference),
            show_author = COALESCE($4::boolean, show_author),
            federation_enabled = COALESCE($5::boolean, federation_enabled)
      WHERE id = $6 AND kind = 'human' AND account_status = 'active'
      RETURNING display_name, avatar_preference, show_author, federation_enabled`,
    [hasDisplayName, displayName, avatarPreference, showAuthor, federationEnabled, actor.id],
  )
  if (!updated.rows[0]) throw createError({ statusCode: 404, statusMessage: 'Account not found.' })
  return {
    displayName: updated.rows[0].display_name || null,
    avatarPreference: updated.rows[0].avatar_preference,
    showAuthor: updated.rows[0].show_author !== false,
    federationEnabled: updated.rows[0].federation_enabled === true,
  }
})
