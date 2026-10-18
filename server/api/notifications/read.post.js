import { readBody } from 'h3'
import { enforceSameOrigin, requireHumanActor } from '../../utils/auth.js'
import { queryDatabase } from '../../utils/database.js'
import { markNotificationsRead } from '../../utils/notifications.js'

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export default defineEventHandler(async (event) => {
  enforceSameOrigin(event)
  const actor = await requireHumanActor(event)
  const body = await readBody(event).catch(() => ({}))
  const ids = Array.isArray(body?.ids)
    ? body.ids.map(id => String(id || '').toLowerCase()).filter(id => UUID_PATTERN.test(id)).slice(0, 100)
    : null
  await markNotificationsRead({ query: queryDatabase }, actor.id, ids)
  return { ok: true }
})
