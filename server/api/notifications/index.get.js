import { getQuery } from 'h3'
import { requireHumanActor } from '../../utils/auth.js'
import { queryDatabase } from '../../utils/database.js'
import { countUnreadNotifications, listNotifications } from '../../utils/notifications.js'

export default defineEventHandler(async (event) => {
  const actor = await requireHumanActor(event)
  const query = getQuery(event)
  const locale = String(query.locale || 'en')
  const requested = Number(query.limit)
  const limit = Number.isInteger(requested) ? Math.min(50, Math.max(1, requested)) : 50
  const database = { query: queryDatabase }
  const [items, unread] = await Promise.all([
    listNotifications(database, actor.id, { locale, limit }),
    countUnreadNotifications(database, actor.id),
  ])
  return { items, unread }
})
