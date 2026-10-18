import { getHumanActor } from '../../utils/auth.js'
import { queryDatabase } from '../../utils/database.js'
import { countUnreadNotifications } from '../../utils/notifications.js'

export default defineEventHandler(async (event) => {
  const actor = await getHumanActor(event)
  if (!actor) return { unread: 0 }
  const unread = await countUnreadNotifications({ query: queryDatabase }, actor.id)
  return { unread }
})
