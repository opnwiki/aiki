import { setResponseHeader } from 'h3'
import { getDatabase } from '../utils/database.js'
import { loadNodeArchive } from '../utils/archive.js'
import { enforceRateLimit } from '../utils/rate-limit.js'

export default defineEventHandler(async (event) => {
  await enforceRateLimit(event, { action: 'node-archive', limit: 20 })
  const config = useRuntimeConfig()
  const archive = await loadNodeArchive(getDatabase(), {
    domain: config.public.nodeDomain,
    origin: config.public.siteUrl,
  })
  setResponseHeader(event, 'Content-Type', 'application/json; charset=utf-8')
  setResponseHeader(event, 'Content-Disposition', 'attachment; filename="aiki-node-public-archive.json"')
  setResponseHeader(event, 'Cache-Control', 'no-store')
  setResponseHeader(event, 'X-Content-Type-Options', 'nosniff')
  return archive
})
