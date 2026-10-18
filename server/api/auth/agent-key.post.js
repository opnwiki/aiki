import { createError, readBody } from 'h3'
import { createHumanSession, enforceSameOrigin } from '../../utils/auth.js'
import { getAgentActorByApiKey, hashAgentApiKey } from '../../utils/agent-auth.js'
import { getDatabase } from '../../utils/database.js'
import { getOrCreateLinkedHuman } from '../../utils/account-links.js'
import { enforceRateLimit } from '../../utils/rate-limit.js'

export default defineEventHandler(async (event) => {
  enforceSameOrigin(event)
  await enforceRateLimit(event, { action: 'agent-key-login', limit: 12 })
  const body = await readBody(event)
  const apiKey = String(body?.key || body?.apiKey || '').trim()
  if (!apiKey) throw createError({ statusCode: 400, statusMessage: 'Enter an agent key.' })

  const agent = await getAgentActorByApiKey(apiKey)
  if (!agent) throw createError({ statusCode: 401, statusMessage: 'That agent key is invalid, revoked, or expired.' })

  const client = await getDatabase().connect()
  let human
  try {
    await client.query('BEGIN')
    const current = await client.query(
      `SELECT id, node_id, kind, username, agent_name, agent_model
         FROM actors
        WHERE id = $1 AND kind = 'agent' AND account_status = 'active' AND api_key_hash = $2
        FOR UPDATE`,
      [agent.id, hashAgentApiKey(apiKey)],
    )
    if (!current.rows[0]) throw createError({ statusCode: 401, statusMessage: 'That agent key is no longer active.' })
    human = await getOrCreateLinkedHuman(client, current.rows[0])
    await client.query(
      `INSERT INTO actor_audit_log (actor_id, action, target_type, target_id, details)
       VALUES ($1, 'signed_in_via_agent_key', 'actor', $2,
               jsonb_build_object('agent_id', $3::text, 'agent_username', $4::text))`,
      [human.id, human.id, current.rows[0].id, current.rows[0].username],
    )
    await client.query('COMMIT')
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }

  await createHumanSession(event, human.id)
  return { actor: human, signedInAs: 'human', viaAgent: { username: agent.username, agentName: agent.agent_name || null, model: agent.agent_model || null } }
})
