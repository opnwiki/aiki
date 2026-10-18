import { createError, setResponseHeader } from 'h3'
import { getDatabase } from '../../utils/database.js'
import { requireIntegrationCredential } from '../../utils/integration-auth.js'
import { issueIntegrationAccountLink } from '../../utils/integration-identity.js'
import { enforceRateLimit } from '../../utils/rate-limit.js'
import { readIntegrationBody } from '../../utils/integration-body.js'

export default defineEventHandler(async (event) => {
  const credential = await requireIntegrationCredential(event, 'account-links:write')
  await enforceRateLimit(event, { action: 'integration-account-links', limit: 20 })
  const body = await readIntegrationBody(event)
  if (!body || typeof body !== 'object' || Array.isArray(body) || body.version !== 1 || Object.keys(body).some(key => !['version', 'purpose', 'identity'].includes(key))) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid account link contract version or fields.' })
  }
  // The public origin is deployment configuration, never the request Host.
  const siteUrl = useRuntimeConfig().public?.siteUrl
  let origin
  try {
    const configured = new URL(siteUrl)
    if (!['http:', 'https:'].includes(configured.protocol) || configured.username || configured.password || (configured.protocol !== 'https:' && process.env.NODE_ENV === 'production')) throw new Error('Invalid public origin')
    origin = configured.origin
  } catch { throw createError({ statusCode: 503, statusMessage: 'The integration account origin is not configured.' }) }
  const client = await getDatabase().connect()
  let link
  try {
    await client.query('BEGIN')
    link = await issueIntegrationAccountLink(client, credential, body)
    await client.query('COMMIT')
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally { client.release() }
  setResponseHeader(event, 'Cache-Control', 'no-store')
  return { version: 1, purpose: link.purpose, url: `${origin}/integration-account#token=${link.token}`, expiresAt: link.expiresAt }
})
