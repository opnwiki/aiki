import { createError, getCookie, setResponseHeader } from 'h3'
import { enforceSameOrigin, getHumanActor, hashSecret, setHumanSession } from '../../utils/auth.js'
import { getDatabase } from '../../utils/database.js'
import { requireIntegrationsEnabled } from '../../utils/integration-auth.js'
import { redeemIntegrationAccountLink } from '../../utils/integration-identity.js'
import { enforceRateLimit } from '../../utils/rate-limit.js'
import { readIntegrationBody } from '../../utils/integration-body.js'

export default defineEventHandler(async (event) => {
  requireIntegrationsEnabled()
  enforceSameOrigin(event)
  await enforceRateLimit(event, { action: 'integration-login-redeem', limit: 12 })
  const body = await readIntegrationBody(event)
  if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some(key => key !== 'token')) throw createError({ statusCode: 400, statusMessage: 'Invalid account link confirmation.' })
  const human = await getHumanActor(event)
  const browserSessionHash = human ? hashSecret(getCookie(event, 'aiki_session')) : null
  const client = await getDatabase().connect()
  let result
  try {
    await client.query('BEGIN')
    result = await redeemIntegrationAccountLink(client, body.token, { human, browserSessionHash })
    await client.query('COMMIT')
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally { client.release() }
  if (result.sessionToken) setHumanSession(event, result.sessionToken)
  setResponseHeader(event, 'Cache-Control', 'no-store')
  return { actor: result.actor, purpose: result.purpose }
})
