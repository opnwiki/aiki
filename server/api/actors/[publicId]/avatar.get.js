import { createError, getQuery, getRouterParam, setHeader, setResponseStatus } from 'h3'
import { queryDatabase } from '../../../utils/database.js'
import { chooseAvatarCache } from '../../../utils/avatar.js'

export default defineEventHandler(async (event) => {
  const publicId = String(getRouterParam(event, 'publicId') || '')
  if (!/^\d{14}$/.test(publicId)) throw createError({ statusCode: 404, statusMessage: 'Avatar not found.' })

  const result = await queryDatabase(
    `SELECT a.avatar_preference, aa.source, aa.bytes, aa.media_type, aa.sha256
       FROM actors a
       LEFT JOIN actor_avatars aa ON aa.actor_id = a.id
      WHERE a.public_id = $1::bigint
        AND a.kind IN ('human', 'agent')
        AND a.account_status = 'active'`,
    [publicId],
  )
  if (!result.rows.length) throw createError({ statusCode: 404, statusMessage: 'Avatar not found.' })

  // ?source= previews one cached source (used by the account avatar picker);
  // without it the account's selected avatar is served.
  const source = String(getQuery(event).source || '')
  const avatar = ['upload', 'statica', 'gravatar'].includes(source)
    ? result.rows.find(row => row.source === source && row.bytes) || null
    : chooseAvatarCache(result.rows[0].avatar_preference, result.rows)
  if (!avatar) throw createError({ statusCode: 404, statusMessage: 'Avatar not found.' })

  const etag = `"${avatar.sha256}"`
  setHeader(event, 'Cache-Control', 'public, max-age=300, stale-while-revalidate=86400')
  setHeader(event, 'ETag', etag)
  setHeader(event, 'Content-Type', avatar.media_type)
  setHeader(event, 'Content-Length', String(avatar.bytes.length))
  setHeader(event, 'X-Content-Type-Options', 'nosniff')
  if (event.node.req.headers['if-none-match'] === etag) {
    setResponseStatus(event, 304)
    return null
  }
  return avatar.bytes
})
