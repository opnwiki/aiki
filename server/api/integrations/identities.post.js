import { createError, setResponseHeader } from 'h3'
import { getDatabase } from '../../utils/database.js'
import { lockIntegrationCredential, requireIntegrationCredential } from '../../utils/integration-auth.js'
import { resolveExternalIdentity } from '../../utils/integration-identity.js'
import { enforceRateLimit } from '../../utils/rate-limit.js'
import { readIntegrationBody } from '../../utils/integration-body.js'

export default defineEventHandler(async (event) => {
  const credential = await requireIntegrationCredential(event, 'account-links:write')
  await enforceRateLimit(event, { action: 'integration-identities', limit: 30 })
  const body = await readIntegrationBody(event)
  if (!body || typeof body !== 'object' || Array.isArray(body) || body.version !== 1 || Object.keys(body).some(key => !['version', 'identity'].includes(key))) throw createError({ statusCode: 400, statusMessage: 'Invalid verified identity contract version or fields.' })
  const client = await getDatabase().connect()
  let result
  try {
    await client.query('BEGIN')
    await lockIntegrationCredential(client, credential, 'account-links:write')
    result = await resolveExternalIdentity(client, credential, body.identity, { verifiedSender: true })
    await client.query('COMMIT')
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally { client.release() }
  setResponseHeader(event, 'Cache-Control', 'no-store')
  return { version: 1, identityId: result.identity.id, actor: { publicId: result.actor.public_id, username: result.actor.username, displayName: result.actor.display_name, kind: result.actor.kind } }
})
