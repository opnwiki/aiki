import { getHumanActor } from '../../utils/auth.js'

export default defineEventHandler(async (event) => {
  const actor = await getHumanActor(event)
  return {
    actor: actor
      ? {
          ...actor,
          publicId: actor.public_id,
          displayName: actor.display_name || null,
          avatarPreference: actor.avatar_preference || 'statica',
          showAuthor: actor.show_author !== false,
          federationEnabled: actor.federation_enabled === true,
        }
      : null,
  }
})
