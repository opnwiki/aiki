import { createError, getRouterParam } from 'h3'
import { requireIntegrationCredential } from '../../../utils/integration-auth.js'
import { getIntegrationImport } from '../../../utils/integration-imports.js'
import { getDatabase } from '../../../utils/database.js'

export default defineEventHandler(async event => {
  const credential = await requireIntegrationCredential(event, 'imports:read')
  const id = getRouterParam(event, 'id')
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id || '')) throw createError({ statusCode: 404, statusMessage: 'Import not found.' })
  return getIntegrationImport(getDatabase(), credential, id, { siteUrl: useRuntimeConfig().public.siteUrl })
})
