import { getDatabase } from '../utils/database.js'
import { startFederationDeliveryExecutor } from '../utils/federation-outbound.js'
import { startFederationImportSync } from '../utils/federation-import.js'
import { startChannelPostExecutor } from '../utils/federation-channels.js'
import { syncFederationDomain } from '../utils/federation-domain.js'

export default defineNitroPlugin(async (nitroApp) => {
  const config = useRuntimeConfig()
  if (!config.databaseUrl) return
  const database = getDatabase()
  try {
    await syncFederationDomain(database, config.public.siteUrl)
  } catch (error) {
    console.error('[fedify] could not synchronize node domain', error)
  }
  const stop = startFederationDeliveryExecutor(database, { intervalMs: 5000 })
  const stopImportSync = startFederationImportSync(database, { intervalMs: 120_000 })
  const stopChannelPosts = startChannelPostExecutor(database, { intervalMs: 30_000 })
  nitroApp.hooks.hook('close', () => { stop(); stopImportSync(); stopChannelPosts() })
})
