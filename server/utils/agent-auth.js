import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import { createError } from 'h3'
import { getDatabase, queryDatabase } from './database.js'
import { clientIpForEvent } from './access-control.js'
import { refreshAvatarSources } from './avatar-sources.js'

const AGENT_TOKEN_PREFIX = 'aiki_agent_'
const TOKEN_PATTERN = /^aiki_agent_[A-Za-z0-9_-]{43}$/

export function createAgentApiKey() {
  const secret = randomBytes(32).toString('base64url')
  return `${AGENT_TOKEN_PREFIX}${secret}`
}

export function hashAgentApiKey(token) {
  return createHash('sha256').update(String(token)).digest('hex')
}

export function agentApiKeyPrefix(token) {
  return String(token).slice(0, AGENT_TOKEN_PREFIX.length + 8)
}

export function safeEqualAgentHash(actual, expected) {
  if (typeof actual !== 'string' || typeof expected !== 'string' || !/^[a-f0-9]{64}$/i.test(actual) || !/^[a-f0-9]{64}$/i.test(expected)) return false
  return timingSafeEqual(Buffer.from(actual, 'hex'), Buffer.from(expected, 'hex'))
}

export function extractAgentApiKey(authorization) {
  if (typeof authorization !== 'string') return null
  const match = /^Bearer\s+(.+)$/i.exec(authorization)
  return match?.[1]?.trim() || null
}

export async function getAgentActorByApiKey(token) {
  if (!token || !TOKEN_PATTERN.test(token)) return null

  const result = await queryDatabase(
    `SELECT id, node_id, kind, username, email, agent_name, agent_model, federation_enabled,
            role, account_status, created_at, api_key_hash
       FROM actors
      WHERE kind = 'agent'
        AND account_status = 'active'
        AND api_key_prefix = $1
        AND api_key_revoked_at IS NULL
      LIMIT 2`,
    [agentApiKeyPrefix(token)],
  )
  const tokenHash = hashAgentApiKey(token)
  const actor = result.rowCount === 1 && safeEqualAgentHash(result.rows[0].api_key_hash, tokenHash)
    ? result.rows[0]
    : null
  if (!actor) return null
  await queryDatabase(
    'UPDATE actors SET api_key_last_used_at = now() WHERE id = $1 AND api_key_revoked_at IS NULL AND api_key_hash = $2',
    [actor.id, tokenHash],
  )
  delete actor.api_key_hash
  return actor
}

export async function getAgentActor(event) {
  const actor = await getAgentActorByApiKey(extractAgentApiKey(event.node.req.headers.authorization))
  if (actor) refreshAvatarSources(getDatabase(), actor, clientIpForEvent(event))
  return actor
}

export async function requireAgentActor(event) {
  const actor = await getAgentActor(event)
  if (!actor) throw createError({ statusCode: 401, statusMessage: 'A valid active agent API key is required.' })
  return actor
}
