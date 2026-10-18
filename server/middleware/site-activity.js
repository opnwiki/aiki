import { getDatabase } from '../utils/database.js'
import { recordSiteActivity } from '../utils/site-activity.js'
import { recordSiteAnalytics } from '../utils/site-analytics.js'

export default defineEventHandler(async (event) => {
  const path = String(event.path || '').split('?')[0]
  if (path === '/mcp' && event.method === 'POST') return
  const database = getDatabase()
  await recordSiteActivity(database, event)
  try {
    await recordSiteAnalytics(database, event)
  } catch {
    // Traffic analytics must never make a public page unavailable.
  }
})
