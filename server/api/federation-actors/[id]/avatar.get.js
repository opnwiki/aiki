import { createError, getRouterParam, setHeader, setResponseStatus } from 'h3'
import { queryDatabase } from '../../../utils/database.js'

// Avatars of Fediverse people, downloaded and re-encoded by AIKI so readers
// never contact the remote server.
export default defineEventHandler(async (event) => {
  const id = String(getRouterParam(event, 'id') || '')
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw createError({ statusCode: 404, statusMessage: 'Avatar not found.' })
  const result = await queryDatabase(
    `SELECT cache.bytes, cache.media_type, cache.sha256
       FROM federation_avatar_cache cache
       JOIN federation_actors actor ON actor.id = cache.federation_actor_id AND actor.is_local = false AND actor.status = 'active'
      WHERE cache.federation_actor_id = $1::uuid AND cache.bytes IS NOT NULL AND cache.state = 'ready'`,
    [id],
  )
  const avatar = result.rows[0]
  if (!avatar) throw createError({ statusCode: 404, statusMessage: 'Avatar not found.' })
  const etag = `"${avatar.sha256}"`
  setHeader(event, 'Cache-Control', 'public, max-age=3600, stale-while-revalidate=86400')
  setHeader(event, 'ETag', etag)
  setHeader(event, 'Content-Type', avatar.media_type)
  setHeader(event, 'X-Content-Type-Options', 'nosniff')
  if (event.node.req.headers['if-none-match'] === etag) {
    setResponseStatus(event, 304)
    return null
  }
  return avatar.bytes
})
