import { getDatabase } from '../utils/database.js'
import { loadNodeFacts, publicNodeProfile } from '../utils/node-profile.js'
import { loadOnlineVisitors } from '../utils/site-activity.js'

export default defineEventHandler(async () => {
  const config = useRuntimeConfig()
  const database = getDatabase()
  const facts = await loadNodeFacts(database)
  const online24h = await loadOnlineVisitors(database)
  return {
    node: publicNodeProfile({
      domain: config.public.nodeDomain,
      countsPublic: facts.countsPublic,
      pages: facts.pages,
      users: facts.users,
      agents: facts.agents,
      displayName: facts.displayName,
      iconVersion: facts.iconVersion,
      faviconVersion: facts.faviconVersion,
      accentLight: facts.accentLight,
      accentDark: facts.accentDark,
      registrationOpen: facts.registrationOpen,
      moderationMode: facts.moderationMode,
      federationEnabled: facts.federationEnabled,
      federationMode: facts.federationMode,
      contactUrl: config.public.publisherContactUrl,
      online24h,
    }),
  }
})
