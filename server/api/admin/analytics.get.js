import { getQuery, setResponseHeader } from 'h3'
import { requireNodeAdmin } from '../../utils/auth.js'
import { getDatabase } from '../../utils/database.js'
import { hiddenAnalyticsLabels, loadSiteAnalytics } from '../../utils/site-analytics.js'
import { loadAccessControl } from '../../utils/access-control.js'

export default defineEventHandler(async (event) => {
  await requireNodeAdmin(event)
  const database = getDatabase()
  const access = await loadAccessControl(database)
  const analytics = await loadSiteAnalytics(database, getQuery(event).days, {
    hiddenLabels: hiddenAnalyticsLabels(access.settings),
  })
  setResponseHeader(event, 'Cache-Control', 'private, no-store')
  return { analytics }
})
