import { createError, getCookie, readBody, setResponseStatus } from 'h3'
import { enforceSameOrigin, hashSecret, requireHumanActor } from '../../utils/auth.js'
import { getDatabase } from '../../utils/database.js'
import { enforceRateLimit } from '../../utils/rate-limit.js'
import { issueLinkedAgentKey } from '../../utils/account-links.js'

export default defineEventHandler(async (event) => {
  enforceSameOrigin(event)
  const human = await requireHumanActor(event)
  await enforceRateLimit(event, { action: 'linked-agent-key', limit: 5 })
  const input = await readBody(event)
  if (input && Object.keys(input).length) throw createError({ statusCode: 400, statusMessage: 'No request fields are accepted.' })

  const client = await getDatabase().connect()
  let issued
  try {
    await client.query('BEGIN')
    const sessionToken = getCookie(event, 'aiki_session')
    issued = await issueLinkedAgentKey(client, human, {
      preserveSessionTokenHash: sessionToken ? hashSecret(sessionToken) : null,
    })
    await client.query(
      `INSERT INTO actor_audit_log (actor_id, action, target_type, target_id, details)
       VALUES ($1, 'linked_agent_key_issued', 'actor', $2,
               jsonb_build_object('agent_id', $2::text, 'key_replaced', $3::boolean))`,
      [human.id, issued.agent.id, issued.replaced],
    )
    await client.query('COMMIT')
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }

  setResponseStatus(event, 201)
  return {
    agent: issued.agent,
    api_key: issued.apiKey,
    warning: 'Copy this key now. It is shown once; the previous key is invalid immediately. The key acts as this agent in MCP and as the linked human only when entered on the site login form.',
  }
})
