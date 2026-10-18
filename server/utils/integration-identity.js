import { randomBytes } from 'node:crypto'
import { createError } from 'h3'
import { createOpaqueToken, hashSecret } from './auth.js'
import { allowedIntegrationMediaUrl, lockIntegrationCredential, safeIntegrationPublicUrl } from './integration-auth.js'

export const ACCOUNT_LINK_LIFETIME_SECONDS = 300
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/
const ACTOR_FIELDS = 'id, public_id, node_id, kind, username, display_name, role, account_status'

export function normalizeExternalIdentity(input, credential, { verifiedSender = false } = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(key => !['provider', 'subjectType', 'subjectKey', 'username', 'displayName', 'profileUrl', 'avatarUrl'].includes(key))) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid external identity.' })
  }
  const { provider, subjectType, subjectKey } = input
  const permittedProviders = credential.identity_providers || [credential.provider]
  if (!permittedProviders.includes(provider) || !['user', 'channel', 'publisher'].includes(subjectType) || typeof subjectKey !== 'string' || subjectKey.length < 1 || subjectKey.length > 256 || /[\u0000-\u001f\u007f]/.test(subjectKey) || subjectKey !== subjectKey.trim()) {
    throw createError({ statusCode: 400, statusMessage: 'Supply an immutable subject key for a permitted identity provider.' })
  }
  if (provider !== credential.provider && (provider !== 'web' || subjectType !== 'publisher')) {
    throw createError({ statusCode: 400, statusMessage: 'Secondary providers can only represent web publishers.' })
  }
  if (verifiedSender && (provider !== credential.provider || subjectType !== 'user')) {
    throw createError({ statusCode: 400, statusMessage: 'Only a privately verified user can sign in. Channel claims are unsupported.' })
  }
  if (provider === 'web' && (subjectType !== 'publisher' || safeIntegrationPublicUrl(subjectKey) !== `${subjectKey}/`)) {
    throw createError({ statusCode: 400, statusMessage: 'A web publisher key must be its canonical public HTTP(S) origin.' })
  }
  const username = optionalText(input.username, 128)
  const displayName = optionalText(input.displayName, 80)
  const profileUrl = input.profileUrl == null ? null : safeIntegrationPublicUrl(input.profileUrl)
  const avatarUrl = input.avatarUrl == null ? null : allowedIntegrationMediaUrl(input.avatarUrl, credential)
  if ((input.profileUrl != null && !profileUrl) || (input.avatarUrl != null && !avatarUrl)) throw createError({ statusCode: 400, statusMessage: 'Profile and avatar URLs must be stable public URLs; avatars require a configured media origin.' })
  return { provider, subjectType, subjectKey, username, displayName, profileUrl, avatarUrl }
}

function optionalText(value, max) {
  if (value == null) return null
  if (typeof value !== 'string' || value.length > max || /[\u0000-\u001f\u007f]/.test(value)) throw createError({ statusCode: 400, statusMessage: 'External profile metadata is invalid.' })
  return value.trim() || null
}

async function lockIdentityMappings(client, nodeId, { exclusive = false } = {}) {
  // Imports can resolve independent identities concurrently. Account rebinding
  // changes which actor those keys lock, so it waits for all such resolutions
  // and blocks new ones until commit. This also covers aliases added while an
  // account link was being inspected, which sorting a stale key list cannot do.
  const lock = exclusive ? 'pg_advisory_xact_lock' : 'pg_advisory_xact_lock_shared'
  await client.query(`SELECT ${lock}(hashtextextended($1, 0))`, [JSON.stringify(['integration-identity-mappings', nodeId])])
}

// The caller owns the transaction. A transaction advisory lock serializes first
// creation and username changes by immutable key across all connector credentials.
export async function resolveExternalIdentity(client, credential, input, { verifiedSender = false } = {}) {
  const identity = normalizeExternalIdentity(input, credential, { verifiedSender })
  await lockIdentityMappings(client, credential.node_id)
  await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [JSON.stringify([credential.node_id, identity.provider, identity.subjectType, identity.subjectKey])])
  const existing = await client.query(
    `SELECT * FROM external_identities WHERE node_id = $1 AND provider = $2 AND subject_type = $3 AND subject_key = $4 FOR UPDATE`,
    [credential.node_id, identity.provider, identity.subjectType, identity.subjectKey],
  )
  let stored = existing.rows[0]
  let actor
  if (stored) {
    const actors = await client.query(`SELECT ${ACTOR_FIELDS} FROM actors WHERE id = $1 AND node_id = $2 FOR UPDATE`, [stored.actor_id, credential.node_id])
    actor = actors.rows[0]
    if (!actor || !['external', 'human'].includes(actor.kind) || actor.account_status !== 'active') throw createError({ statusCode: 403, statusMessage: 'This external account is not active.' })
    if (actor.kind === 'external' && verifiedSender) {
      const promoted = await client.query(`UPDATE actors SET kind = 'human' WHERE id = $1 AND kind = 'external' RETURNING ${ACTOR_FIELDS}`, [actor.id])
      actor = promoted.rows[0]
      await recordAudit(client, actor.id, 'external_user_verified', stored.id, credential)
    }
    // An imported username never changes a login username, and connector metadata
    // cannot overwrite a profile edited by its linked human account.
    if (actor.kind === 'external' && identity.displayName) {
      const updated = await client.query(`UPDATE actors SET display_name = $2 WHERE id = $1 RETURNING ${ACTOR_FIELDS}`, [actor.id, identity.displayName])
      actor = updated.rows[0]
    }
    const updated = await client.query(
      `UPDATE external_identities SET username = $2, display_name = $3, profile_url = $4, avatar_url = $5,
              verified_at = CASE WHEN $6 THEN coalesce(verified_at, now()) ELSE verified_at END, updated_at = now()
        WHERE id = $1 RETURNING *`,
      [stored.id,
        input.username === undefined ? stored.username : identity.username,
        input.displayName === undefined ? stored.display_name : identity.displayName,
        input.profileUrl === undefined ? stored.profile_url : identity.profileUrl,
        input.avatarUrl === undefined ? stored.avatar_url : identity.avatarUrl,
        verifiedSender],
    )
    stored = updated.rows[0]
  } else {
    const username = `ext-${randomBytes(12).toString('hex')}`
    const created = await client.query(
      `INSERT INTO actors (node_id, kind, username, display_name, role, account_status, federation_enabled)
       VALUES ($1, $2, $3, $4, 'member', 'active', false) RETURNING ${ACTOR_FIELDS}`,
      [credential.node_id, verifiedSender ? 'human' : 'external', username, identity.displayName],
    )
    actor = created.rows[0]
    const inserted = await client.query(
      `INSERT INTO external_identities (node_id, provider, subject_type, subject_key, actor_id, initial_actor_id, username, display_name, profile_url, avatar_url, verified_at)
       VALUES ($1, $2, $3, $4, $5, $5, $6, $7, $8, $9, CASE WHEN $10 THEN now() ELSE NULL END) RETURNING *`,
      [credential.node_id, identity.provider, identity.subjectType, identity.subjectKey, actor.id, identity.username, identity.displayName, identity.profileUrl, identity.avatarUrl, verifiedSender],
    )
    stored = inserted.rows[0]
    await recordAudit(client, actor.id, verifiedSender ? 'integration_human_created' : 'external_profile_created', stored.id, credential)
  }
  return { identity: stored, actor }
}

async function recordAudit(client, actorId, action, identityId, credential, details = {}) {
  await client.query(
    `INSERT INTO actor_audit_log (actor_id, action, target_type, target_id, details) VALUES ($1, $2, 'external_identity', $3, $4::jsonb)`,
    [actorId, action, identityId, JSON.stringify({ credentialId: credential.id, connector: credential.connector, ...details })],
  )
}

export async function issueIntegrationAccountLink(client, credential, { purpose, identity }) {
  if (!['login', 'link'].includes(purpose)) throw createError({ statusCode: 400, statusMessage: 'Choose login or link.' })
  await lockIntegrationCredential(client, credential, 'account-links:write')
  const resolved = await resolveExternalIdentity(client, credential, identity, { verifiedSender: true })
  const token = createOpaqueToken()
  // Supersede old links from this same verified user and credential.
  await client.query('UPDATE integration_account_links SET consumed_at = now() WHERE identity_id = $1 AND credential_id = $2 AND consumed_at IS NULL', [resolved.identity.id, credential.id])
  const result = await client.query(
    `INSERT INTO integration_account_links (credential_id, identity_id, purpose, token_hash, actor_id) VALUES ($1, $2, $3, $4, $5) RETURNING expires_at`,
    [credential.id, resolved.identity.id, purpose, hashSecret(token), resolved.actor.id],
  )
  await recordAudit(client, resolved.actor.id, 'integration_account_link_issued', resolved.identity.id, credential, { purpose })
  return { token, purpose, expiresAt: result.rows[0].expires_at }
}

const ACTIVE_ACCOUNT_LINK = `SELECT links.*, identities.node_id, identities.provider, identities.subject_type, identities.subject_key,
      identities.actor_id AS current_actor_id, identities.display_name AS external_display_name,
      credentials.connector, credentials.provider AS credential_provider,
      actors.username, actors.display_name, actors.public_id, actors.role, actors.kind, actors.account_status
    FROM integration_account_links links
    JOIN integration_credentials credentials ON credentials.id = links.credential_id
    JOIN external_identities identities ON identities.id = links.identity_id
    JOIN actors ON actors.id = identities.actor_id
   WHERE links.token_hash = $1 AND links.consumed_at IS NULL AND links.expires_at > now()
     AND credentials.revoked_at IS NULL AND 'account-links:write' = ANY(credentials.scopes)
     AND identities.node_id = credentials.node_id AND identities.provider = credentials.provider
     AND identities.subject_type = 'user' AND identities.verified_at IS NOT NULL
     AND identities.actor_id = links.actor_id AND actors.node_id = identities.node_id
     AND actors.kind = 'human' AND actors.account_status = 'active'`

export async function inspectIntegrationAccountLink(database, token) {
  if (typeof token !== 'string' || !TOKEN_PATTERN.test(token)) throw invalidLink()
  const result = await database.query(ACTIVE_ACCOUNT_LINK, [hashSecret(token)])
  if (!result.rows[0]) throw invalidLink()
  const row = result.rows[0]
  return { purpose: row.purpose, expiresAt: row.expires_at, account: { publicId: row.public_id, username: row.username, displayName: row.display_name || row.external_display_name }, provider: row.provider }
}

// The caller owns the transaction and applies the cookie only after commit.
export async function redeemIntegrationAccountLink(client, token, { human = null, browserSessionHash = null } = {}) {
  if (typeof token !== 'string' || !TOKEN_PATTERN.test(token)) throw invalidLink()
  // Issuance/imports lock credentials first, then identities, then actors. Retain
  // this order during redemption so concurrent imports cannot deadlock it.
  const candidate = await client.query(ACTIVE_ACCOUNT_LINK, [hashSecret(token)])
  const observed = candidate.rows[0]
  if (!observed) throw invalidLink()
  const credential = { id: observed.credential_id, node_id: observed.node_id, connector: observed.connector, provider: observed.credential_provider }
  await lockIntegrationCredential(client, credential, 'account-links:write')
  await lockIdentityMappings(client, observed.node_id, { exclusive: observed.purpose === 'link' })
  const targetActorId = observed.purpose === 'link' ? human?.id || null : null
  const identitiesToLock = await client.query(
    `SELECT id, node_id, provider, subject_type, subject_key FROM external_identities WHERE id = $1 OR ($2::uuid IS NOT NULL AND actor_id = $2::uuid)`,
    [observed.identity_id, targetActorId],
  )
  identitiesToLock.rows.sort((a, b) => JSON.stringify([a.provider, a.subject_type, a.subject_key]).localeCompare(JSON.stringify([b.provider, b.subject_type, b.subject_key])))
  for (const identity of identitiesToLock.rows) {
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [JSON.stringify([identity.node_id, identity.provider, identity.subject_type, identity.subject_key])])
    await client.query('SELECT id FROM external_identities WHERE id = $1 FOR UPDATE', [identity.id])
  }
  await client.query('SELECT id FROM actors WHERE id = ANY($1::uuid[]) ORDER BY id FOR UPDATE', [[observed.actor_id, ...(targetActorId ? [targetActorId] : [])]])
  const locked = await client.query(`${ACTIVE_ACCOUNT_LINK} FOR UPDATE OF links`, [hashSecret(token)])
  const row = locked.rows[0]
  if (!row) throw invalidLink()
  let actor
  let sessionToken = null
  if (row.purpose === 'link') {
    if (!human || !browserSessionHash) throw createError({ statusCode: 401, statusMessage: 'Sign in to your existing account to confirm the link.' })
    const target = await client.query(`SELECT ${ACTOR_FIELDS} FROM actors WHERE id = $1 AND node_id = $2 AND kind = 'human' AND account_status = 'active' FOR UPDATE`, [human.id, row.node_id])
    actor = target.rows[0]
    if (!actor) throw createError({ statusCode: 403, statusMessage: 'The existing account must be active on this node.' })
    const browserSession = await client.query(
      `SELECT id FROM human_sessions WHERE actor_id = $1 AND token_hash = $2 AND revoked_at IS NULL AND expires_at > now() FOR SHARE`,
      [actor.id, browserSessionHash],
    )
    if (!browserSession.rows[0]) throw createError({ statusCode: 401, statusMessage: 'Sign in to your existing account to confirm the link.' })
    await client.query('UPDATE external_identities SET actor_id = $2, account_linked_at = now(), updated_at = now() WHERE id = $1', [row.identity_id, actor.id])
    // Existing page/revision authors retain their immutable attribution. Linking
    // changes this identity's future imports and sign-ins, not ownership of old pages.
    if (actor.id !== row.actor_id) {
      await client.query('UPDATE human_sessions SET revoked_at = now() WHERE actor_id = $1 AND revoked_at IS NULL', [row.actor_id])
      await client.query('UPDATE integration_account_links SET consumed_at = now() WHERE identity_id = $1 AND consumed_at IS NULL', [row.identity_id])
    }
    await recordAudit(client, actor.id, 'external_account_linked', row.identity_id, credential, { previousActorId: row.actor_id })
  } else {
    actor = { id: row.current_actor_id, node_id: row.node_id, public_id: row.public_id, kind: row.kind, username: row.username, display_name: row.display_name, role: row.role }
    sessionToken = createOpaqueToken()
    await client.query(`INSERT INTO human_sessions (actor_id, token_hash, expires_at, integration_credential_id) VALUES ($1, $2, now() + interval '14 days', $3)`, [actor.id, hashSecret(sessionToken), row.credential_id])
    await recordAudit(client, actor.id, 'signed_in_via_integration', row.identity_id, credential)
  }
  await client.query('UPDATE integration_account_links SET consumed_at = now(), consumed_by = $2 WHERE id = $1', [row.id, actor.id])
  return { actor, purpose: row.purpose, sessionToken }
}

// The caller first soft-revokes and locks the credential in this transaction.
// Login issuance holds a shared credential lock, so no session can escape this
// cleanup by committing between credential revocation and these statements.
export async function revokeIntegrationSessionsAndLinks(client, credentialId) {
  await client.query('UPDATE human_sessions SET revoked_at = now() WHERE integration_credential_id = $1 AND revoked_at IS NULL', [credentialId])
  await client.query('UPDATE integration_account_links SET consumed_at = now() WHERE credential_id = $1 AND consumed_at IS NULL', [credentialId])
}

function invalidLink() {
  return createError({ statusCode: 410, statusMessage: 'This account link has expired or has already been used.' })
}
