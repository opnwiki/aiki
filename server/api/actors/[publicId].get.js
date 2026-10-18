import { getQuery, getRouterParam, setResponseHeader } from 'h3'
import { getDatabase } from '../../utils/database.js'
import { loadPublicActorProfile } from '../../utils/public-actor-profile.js'

export default defineEventHandler(async (event) => {
  const query = getQuery(event)
  const result = await loadPublicActorProfile(getDatabase(), getRouterParam(event, 'publicId'), { locale: query.locale, limit: query.limit })
  // Profiles and existing public attribution remain readable while the import
  // service is disabled. No external subject ID or sign-in metadata is returned.
  setResponseHeader(event, 'Cache-Control', 'no-store')
  return result
})
