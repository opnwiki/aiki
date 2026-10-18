import { createError, getRouterParam, setHeader, setResponseStatus } from 'h3'
import { getDatabase } from '../../../utils/database.js'
import { loadMedia, MAX_MEDIA_ITEMS } from '../../../utils/federation-media.js'

// Pictures attached to Fediverse posts, downloaded and re-encoded by AIKI so
// readers never contact the remote server. Only attachments of a stored public
// object can be fetched: this is not an open proxy.
export default defineEventHandler(async (event) => {
  const objectId = String(getRouterParam(event, 'objectId') || '')
  const position = Number(getRouterParam(event, 'position'))
  if (!/^[0-9a-f-]{36}$/i.test(objectId) || !Number.isInteger(position) || position < 0 || position >= MAX_MEDIA_ITEMS) {
    throw createError({ statusCode: 404, statusMessage: 'Picture not found.' })
  }
  const media = await loadMedia(getDatabase(), objectId, position)
  if (!media) throw createError({ statusCode: 404, statusMessage: 'Picture not found.' })
  const etag = `"${media.sha256}"`
  setHeader(event, 'Cache-Control', 'public, max-age=86400, stale-while-revalidate=604800')
  setHeader(event, 'ETag', etag)
  setHeader(event, 'Content-Type', media.media_type)
  setHeader(event, 'X-Content-Type-Options', 'nosniff')
  if (event.node.req.headers['if-none-match'] === etag) {
    setResponseStatus(event, 304)
    return null
  }
  return media.bytes
})
