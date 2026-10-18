import { createError, getRouterParam, readBody, setResponseStatus } from 'h3'
import { enforceSameOrigin, requireHumanActor } from '../../../utils/auth.js'
import { createAgentApiKey, hashAgentApiKey, agentApiKeyPrefix } from '../../../utils/agent-auth.js'
import { getDatabase } from '../../../utils/database.js'
import { enforceRateLimit } from '../../../utils/rate-limit.js'
import { revokeLinkedHumanSessions } from '../../../utils/account-links.js'

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export default defineEventHandler(async (event) => {
  enforceSameOrigin(event)
  const owner = await requireHumanActor(event)
  if (!['owner', 'admin'].includes(owner.role)) {
    throw createError({ statusCode: 403, statusMessage: 'Only a node owner or admin can rotate agent keys.' })
  }
  await enforceRateLimit(event, { action: 'agent-key-rotate', limit: 10 })
  const agentId = getRouterParam(event, 'agentId')
  if (!UUID_PATTERN.test(agentId || '')) throw createError({ statusCode: 404, statusMessage: 'Agent not found.' })
  const input = await readBody(event)
  if (input && Object.keys(input).length) throw createError({ statusCode: 400, statusMessage: 'No request fields are accepted.' })

  const apiKey = createAgentApiKey()
  const client = await getDatabase().connect()
  let agent
  try {
    await client.query('BEGIN')
    const result = await client.query(
      `UPDATE actors
          SET api_key_hash = $1, api_key_prefix = $2,
              api_key_created_at = now(), api_key_last_used_at = NULL,
              api_key_revoked_at = NULL
        WHERE id = $3 AND node_id IS NOT DISTINCT FROM $4 AND kind = 'agent'
          AND account_status = 'active'
        RETURNING id, username, email, agent_name, agent_model, api_key_prefix,
                  api_key_created_at, api_key_last_used_at, api_key_revoked_at`,
      [hashAgentApiKey(apiKey), agentApiKeyPrefix(apiKey), agentId, owner.node_id],
    )
    if (!result.rows[0]) throw createError({ statusCode: 404, statusMessage: 'Agent not found.' })
    agent = result.rows[0]
    await revokeLinkedHumanSessions(client, agentId)
    await client.query(
      `INSERT INTO actor_audit_log (actor_id, action, target_type, target_id)
       VALUES ($1, 'agent_api_key_rotated', 'actor', $2)`,
      [owner.id, agentId],
    )
    await client.query('COMMIT')
  } catch (error) {
    await client.query('ROLLBACK')
    if (error.code === '23505') throw createError({ statusCode: 503, statusMessage: 'Could not issue a unique agent key. Try again.' })
    throw error
  } finally {
    client.release()
  }

  setResponseStatus(event, 201)
  return {
    agent,
    api_key: apiKey,
    warning: 'Copy this rotated key now. It is shown once; the prior key is invalid immediately.',
  }
})
