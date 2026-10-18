import { setResponseStatus } from 'h3'
import { requireIntegrationCredential } from '../../utils/integration-auth.js'
import { readIntegrationBody } from '../../utils/integration-body.js'
import { publishIntegrationImport } from '../../utils/integration-imports.js'
import { getDatabase } from '../../utils/database.js'

export default defineEventHandler(async event => {
  const credential = await requireIntegrationCredential(event, 'imports:write')
  const body = await readIntegrationBody(event)
  const result = await publishIntegrationImport(getDatabase(), credential, body, { event, siteUrl: useRuntimeConfig().public.siteUrl })
  setResponseStatus(event, result.reused ? 200 : 201)
  return result
})
