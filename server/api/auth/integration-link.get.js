import { getHeader, setResponseHeader } from 'h3'
import { getDatabase } from '../../utils/database.js'
import { requireIntegrationsEnabled } from '../../utils/integration-auth.js'
import { inspectIntegrationAccountLink } from '../../utils/integration-identity.js'
import { enforceRateLimit } from '../../utils/rate-limit.js'

export default defineEventHandler(async (event) => {
  requireIntegrationsEnabled()
  await enforceRateLimit(event, { action: 'integration-login-inspect', limit: 30 })
  setResponseHeader(event, 'Cache-Control', 'no-store')
  // The secret stays in the browser fragment and this request header, never in
  // request URL/access logs. Inspecting a link does not create a session.
  return await inspectIntegrationAccountLink(getDatabase(), getHeader(event, 'x-aiki-account-token'))
})
