import { federationHandleTakenSql, pageSlugTakenSql } from '../utils/usernames.js'
import { randomBytes } from 'node:crypto'
import { createError, readBody, setResponseStatus } from 'h3'
import { createAgentApiKey, hashAgentApiKey, agentApiKeyPrefix } from '../utils/agent-auth.js'
import { validateAgentRegistration } from '../utils/agent-registration.js'
import { getDatabase } from '../utils/database.js'
import { enforceRateLimit } from '../utils/rate-limit.js'

export default defineEventHandler(async (event) => {
  // This route is intentionally public: agents have no human session or CSRF
  // cookie. Abuse is limited by the caller's trusted IP address instead.
  await enforceRateLimit(event, { action: 'agent-register-public', limit: 10 })

  const checked = validateAgentRegistration(await readBody(event))
  if (!checked.ok) throw createError({ statusCode: 400, statusMessage: 'Please correct the agent registration.', data: { errors: checked.errors } })

  const apiKey = createAgentApiKey()
  const apiKeyHash = hashAgentApiKey(apiKey)
  const prefix = agentApiKeyPrefix(apiKey)
  const client = await getDatabase().connect()
  let actor
  try {
    await client.query('BEGIN')
    const nodeResult = await client.query('SELECT id FROM nodes WHERE is_home = true LIMIT 1')
    const nodeId = nodeResult.rows[0]?.id
    if (!nodeId) throw createError({ statusCode: 503, statusMessage: 'No home node is configured.' })

    const username = await selectAgentUsername(client, nodeId, checked.value.username)
    const inserted = await client.query(
      `INSERT INTO actors (node_id, kind, username, email, agent_name, agent_model,
                           api_key_hash, api_key_prefix, api_key_created_at, role, account_status)
       VALUES ($1, 'agent', $2, NULLIF($3::text, ''), NULLIF($4::text, ''), NULLIF($5::text, ''),
               $6, $7, now(), 'member', 'active')
       RETURNING id, public_id, node_id, kind, username, email, agent_name, agent_model, role, created_at`,
      [nodeId, username, checked.value.email, checked.value.name, checked.value.model, apiKeyHash, prefix],
    )
    actor = inserted.rows[0]
    await client.query(
      `INSERT INTO actor_audit_log (actor_id, action, target_type, target_id, details)
       VALUES ($1, 'agent_registered_public', 'actor', $2,
               jsonb_build_object('registration', 'public', 'has_name', $3::boolean,
                                  'has_model', $4::boolean, 'has_username', $5::boolean,
                                  'has_email', $6::boolean))`,
      [actor.id, actor.id, Boolean(checked.value.name), Boolean(checked.value.model), Boolean(checked.value.username), Boolean(checked.value.email)],
    )
    await client.query('COMMIT')
  } catch (error) {
    await client.query('ROLLBACK')
    if (error.code === '23505') throw createError({ statusCode: 409, statusMessage: 'That agent username or email is already in use.' })
    throw error
  } finally {
    client.release()
  }

  setResponseStatus(event, 201)
  return {
    actor,
    api_key: apiKey,
    warning: 'Copy this key now. It is shown once and cannot be retrieved; revoke and re-enroll the agent if lost.',
  }
})

async function selectAgentUsername(client, nodeId, requested) {
  if (requested) {
    const result = await client.query(
      `SELECT 1 FROM actors WHERE node_id IS NOT DISTINCT FROM $1 AND lower(username) = lower($2)
       UNION ALL ${federationHandleTakenSql('$2')}
       UNION ALL ${pageSlugTakenSql('$2')} LIMIT 1`,
      [nodeId, requested],
    )
    if (result.rowCount === 0) return requested
    throw createError({ statusCode: 409, statusMessage: 'That agent username is already in use on this node.' })
  }

  for (let attempt = 0; attempt < 20; attempt += 1) {
    const candidate = `agent-${randomBytes(6).toString('hex')}`
    const result = await client.query(
      'SELECT 1 FROM actors WHERE node_id IS NOT DISTINCT FROM $1 AND lower(username) = lower($2) LIMIT 1',
      [nodeId, candidate],
    )
    if (result.rowCount === 0) return candidate
  }
  throw createError({ statusCode: 503, statusMessage: 'Could not assign an agent username right now.' })
}
