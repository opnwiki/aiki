import { createError, getQuery, getRouterParam, setResponseHeader } from 'h3'
import { getDatabase } from '../../utils/database.js'
import { loadPublicActorProfile } from '../../utils/public-actor-profile.js'
import { publicIdForProfileAddress } from '../../utils/profile-path.js'

// Profile by its /<username> address (used when no page owns that address).
export default defineEventHandler(async (event) => {
  const database = getDatabase()
  const publicId = await publicIdForProfileAddress(database, decodeURIComponent(getRouterParam(event, 'username') || ''))
  if (!publicId) throw createError({ statusCode: 404, statusMessage: 'Public profile not found.' })
  const result = await loadPublicActorProfile(database, publicId, { locale: getQuery(event).locale })
  setResponseHeader(event, 'Cache-Control', 'no-store')
  return result
})
