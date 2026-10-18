import { requireNodeAdmin } from '../../utils/auth.js'
import { getDatabase } from '../../utils/database.js'
import { loadNodeFacts, presentNodeSettings } from '../../utils/node-profile.js'
import { loadAccessControl, presentAccessSettings } from '../../utils/access-control.js'

export default defineEventHandler(async (event) => {
  await requireNodeAdmin(event)
  const database = getDatabase()
  const facts = await loadNodeFacts(database)
  const access = await loadAccessControl(database)
  return {
    settings: { ...presentNodeSettings(facts, useRuntimeConfig()), accessControl: presentAccessSettings(access) },
  }
})
