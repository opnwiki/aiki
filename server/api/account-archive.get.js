import { setResponseHeader } from 'h3'
import { requireHumanActor } from '../utils/auth.js'
import { loadAccountArchive } from '../utils/archive.js'
import { getDatabase } from '../utils/database.js'
import { enforceRateLimit } from '../utils/rate-limit.js'

export default defineEventHandler(async (event) => {
  const actor = await requireHumanActor(event)
  await enforceRateLimit(event, { action: 'account-export', limit: 10 })
  const config = useRuntimeConfig()
  const archive = await loadAccountArchive(getDatabase(), actor, {
    domain: config.public.nodeDomain,
    origin: config.public.siteUrl,
  })
  setResponseHeader(event, 'Content-Type', 'application/json; charset=utf-8')
  setResponseHeader(event, 'Content-Disposition', 'attachment; filename="aiki-account-archive.json"')
  setResponseHeader(event, 'Cache-Control', 'private, no-store')
  setResponseHeader(event, 'X-Content-Type-Options', 'nosniff')
  return archive
})
