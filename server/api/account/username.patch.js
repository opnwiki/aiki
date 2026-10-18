import { createError, readBody } from 'h3'
import { enforceSameOrigin, requireHumanActor } from '../../utils/auth.js'
import { getDatabase } from '../../utils/database.js'
import { enforceRateLimit } from '../../utils/rate-limit.js'
import { announceActorUpdate } from '../../utils/federation-channels.js'
import { FEDERATION_RESERVED_HANDLES, federationHandleTakenSql, pageSlugTakenSql, validateFederationUsername, validateUsername } from '../../utils/usernames.js'

// Pages and replies belong to the account, not the login, so they follow the
// new name at once. The Fediverse actor keeps its URI: followers and old posts
// stay attached, the old @name keeps resolving to it and cannot be reused.
export default defineEventHandler(async (event) => {
  enforceSameOrigin(event)
  const actor = await requireHumanActor(event)
  await enforceRateLimit(event, { action: 'username-change', limit: 5, actor })
  const body = await readBody(event)
  const checked = validateUsername(typeof body?.username === 'string' ? body.username : '')
  if (!checked.ok) throw createError({ statusCode: 400, statusMessage: 'Use 3–32 letters, digits, underscores or hyphens.' })
  if (FEDERATION_RESERVED_HANDLES.has(checked.value.toLowerCase())) {
    throw createError({ statusCode: 409, statusMessage: 'That username is reserved for an AIKI Fediverse channel.' })
  }
  if (checked.value === actor.username) return { username: actor.username, changed: false }
  if (actor.federation_enabled === true) {
    const federation = validateFederationUsername(checked.value)
    if (!federation.ok) throw createError({ statusCode: 400, statusMessage: `${federation.error} Turn off Fediverse publishing first to use another username.` })
  }

  const database = getDatabase()
  const client = await database.connect()
  try {
    await client.query('BEGIN')
    const conflict = await client.query(
      `SELECT 1 FROM actors
        WHERE node_id IS NOT DISTINCT FROM $1 AND lower(username) = lower($2) AND id <> $3
       UNION ALL ${federationHandleTakenSql('$2', '$3')}
       UNION ALL ${pageSlugTakenSql('$2')}
        LIMIT 1`,
      [actor.node_id, checked.value, actor.id],
    )
    if (conflict.rowCount) throw createError({ statusCode: 409, statusMessage: 'That username is already in use on this node.' })
    const updated = await client.query(
      `UPDATE actors SET username = $1
        WHERE id = $2 AND kind = 'human' AND account_status = 'active'
        RETURNING username`,
      [checked.value, actor.id],
    )
    if (!updated.rows[0]) throw createError({ statusCode: 404, statusMessage: 'Account not found.' })
    await client.query(
      `UPDATE federation_actors federated
          SET local_handle = $1, acct = $1 || '@' || nodes.domain, updated_at = now()
         FROM nodes
        WHERE federated.local_actor_id = $2 AND federated.is_local = true AND nodes.id = federated.node_id`,
      [checked.value, actor.id],
    )
    await client.query(
      `INSERT INTO actor_audit_log (actor_id, action, target_type, target_id, details)
       VALUES ($1, 'username_changed', 'actor', $1,
               jsonb_build_object('old_username', $2::text, 'new_username', $3::text, 'source', 'account'))`,
      [actor.id, actor.username, checked.value],
    )
    await client.query('COMMIT')
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
  void announceActorUpdate(database, actor.id).catch(error => {
    console.error('[fedify] actor update after rename failed', error instanceof Error ? error.message : error)
  })
  return { username: checked.value, changed: true }
})
