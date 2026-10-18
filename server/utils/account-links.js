import { randomBytes } from 'node:crypto'
import { createAgentApiKey, hashAgentApiKey, agentApiKeyPrefix } from './agent-auth.js'

export async function issueLinkedAgentKey(client, human, { preserveSessionTokenHash = null } = {}) {
  const link = await client.query(
    `SELECT agent.id, agent.username, agent.public_id, agent.node_id, agent.kind,
            agent.agent_name, agent.agent_model, agent.account_status,
            agent.api_key_prefix, agent.api_key_created_at, agent.api_key_last_used_at,
            agent.api_key_revoked_at
       FROM actor_account_links links
       JOIN actors agent ON agent.id = links.agent_actor_id
      WHERE links.human_actor_id = $1
      FOR UPDATE OF links, agent`,
    [human.id],
  )
  const apiKey = createAgentApiKey()
  let agent
  const replaced = Boolean(link.rows[0])
  if (link.rows[0]) {
    const result = await client.query(
      `UPDATE actors
          SET api_key_hash = $1, api_key_prefix = $2,
              api_key_created_at = now(), api_key_last_used_at = NULL,
              api_key_revoked_at = NULL
        WHERE id = $3 AND kind = 'agent' AND account_status = 'active'
        RETURNING id, public_id, node_id, kind, username, email, agent_name, agent_model,
                  account_status, api_key_prefix, api_key_created_at, api_key_last_used_at, api_key_revoked_at`,
      [hashAgentApiKey(apiKey), agentApiKeyPrefix(apiKey), link.rows[0].id],
    )
    agent = result.rows[0]
    if (!agent) throw new Error('The linked agent account is not active.')
    await revokeLinkedHumanSessions(client, link.rows[0].id, preserveSessionTokenHash)
  } else {
    const username = await uniqueUsername(client, human.node_id)
    const result = await client.query(
      `INSERT INTO actors (node_id, kind, username, agent_name, api_key_hash, api_key_prefix,
                           api_key_created_at, role, account_status)
       VALUES ($1, 'agent', $2, $3, $4, $5, now(), 'member', 'active')
       RETURNING id, public_id, node_id, kind, username, email, agent_name, agent_model,
                 account_status, api_key_prefix, api_key_created_at, api_key_last_used_at, api_key_revoked_at`,
      [human.node_id, username, `${human.username}'s agent`, hashAgentApiKey(apiKey), agentApiKeyPrefix(apiKey)],
    )
    agent = result.rows[0]
    await client.query(
      `INSERT INTO actor_account_links (human_actor_id, agent_actor_id) VALUES ($1, $2)`,
      [human.id, agent.id],
    )
  }
  return { agent, apiKey, replaced }
}

export async function getOrCreateLinkedHuman(client, agent) {
  const existing = await client.query(
    `SELECT human.id, human.public_id, human.node_id, human.kind, human.username,
            human.email, human.role
       FROM actor_account_links links
       JOIN actors human ON human.id = links.human_actor_id
      WHERE links.agent_actor_id = $1
      FOR UPDATE OF links, human`,
    [agent.id],
  )
  if (existing.rows[0]) return existing.rows[0]

  const username = await uniqueUsername(client, agent.node_id)
  const created = await client.query(
    `INSERT INTO actors (node_id, kind, username, role, account_status)
     VALUES ($1, 'human', $2, 'member', 'active')
     RETURNING id, public_id, node_id, kind, username, email, role`,
    [agent.node_id, username],
  )
  const human = created.rows[0]
  await client.query(
    `INSERT INTO actor_account_links (human_actor_id, agent_actor_id) VALUES ($1, $2)`,
    [human.id, agent.id],
  )
  return human
}

export async function revokeLinkedHumanSessions(client, agentId, preserveSessionTokenHash = null) {
  await client.query(
    `UPDATE human_sessions sessions
        SET revoked_at = now()
       FROM actor_account_links links
      WHERE sessions.actor_id = links.human_actor_id
        AND links.agent_actor_id = $1
        AND sessions.revoked_at IS NULL
        AND ($2::text IS NULL OR sessions.token_hash <> $2::text)`,
    [agentId, preserveSessionTokenHash],
  )
}

async function uniqueUsername(client, nodeId) {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const username = `linked-${randomBytes(6).toString('hex')}`
    const result = await client.query(
      'SELECT 1 FROM actors WHERE node_id IS NOT DISTINCT FROM $1 AND lower(username) = lower($2) LIMIT 1',
      [nodeId, username],
    )
    if (!result.rows[0]) return username
  }
  throw new Error('Could not assign a linked account username.')
}
