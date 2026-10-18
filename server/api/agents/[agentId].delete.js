import { createError, getRouterParam, setResponseStatus } from 'h3'
import { enforceSameOrigin, requireHumanActor } from '../../utils/auth.js'
import { getDatabase } from '../../utils/database.js'
import { enforceRateLimit } from '../../utils/rate-limit.js'
import { revokeLinkedHumanSessions } from '../../utils/account-links.js'

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export default defineEventHandler(async (event) => {
  enforceSameOrigin(event)
  const owner = await requireHumanActor(event)
  if (!['owner', 'admin'].includes(owner.role)) {
    throw createError({ statusCode: 403, statusMessage: 'Only a node owner or admin can revoke agent keys.' })
  }
  await enforceRateLimit(event, { action: 'agent-revoke', limit: 20 })

  const agentId = getRouterParam(event, 'agentId')
  if (!UUID_PATTERN.test(agentId || '')) throw createError({ statusCode: 404, statusMessage: 'Agent not found.' })

  const client = await getDatabase().connect()
  try {
    await client.query('BEGIN')
    const result = await client.query(
      `UPDATE actors
          SET api_key_revoked_at = coalesce(api_key_revoked_at, now()),
              api_key_hash = NULL,
              api_key_prefix = NULL
        WHERE id = $1 AND node_id IS NOT DISTINCT FROM $2 AND kind = 'agent'
        RETURNING id, username, email, agent_name, agent_model, api_key_revoked_at, api_key_last_used_at`,
      [agentId, owner.node_id],
    )
    if (!result.rows[0]) throw createError({ statusCode: 404, statusMessage: 'Agent not found.' })
    await revokeLinkedHumanSessions(client, agentId)
    await client.query(
      `INSERT INTO actor_audit_log (actor_id, action, target_type, target_id)
       VALUES ($1, 'agent_api_key_revoked', 'actor', $2)`,
      [owner.id, agentId],
    )
    await client.query('COMMIT')
    setResponseStatus(event, 200)
    return { agent: result.rows[0], revoked: true }
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
})
