import { randomUUID } from 'node:crypto'
import { actorIdentifier, lookupRemote } from './federation-lookup.js'
import { Accept, isActor } from '@fedify/vocab'

const origin = process.env.NUXT_PUBLIC_SITE_URL || process.env.SITE_URL || 'http://localhost:3000'

export async function handleInboundFollow(ctx, follow, database) {
  const remoteActorUri = toUrlString(follow?.actorId)
  const targetUri = toUrlString(follow?.objectId)
  const followUri = toUrlString(follow?.id)
  if (!remoteActorUri || !targetUri || !followUri) return { accepted: false, reason: 'missing_follow_provenance' }

  const local = await database.query(
    `SELECT federation_actors.id, federation_actors.local_handle, federation_actors.actor_uri
       FROM federation_actors
       JOIN nodes ON nodes.id = federation_actors.node_id AND nodes.federation_enabled = true
       LEFT JOIN actors account ON account.id = federation_actors.local_actor_id
      WHERE federation_actors.actor_uri = $1 AND federation_actors.is_local = true
        AND federation_actors.status = 'active'
        AND (federation_actors.local_actor_id IS NULL OR account.federation_enabled = true)
      LIMIT 1`,
    [targetUri],
  )
  const localActor = local.rows[0]
  if (!localActor) return { accepted: false, reason: 'unknown_local_target' }

  const remote = await upsertRemoteActor(database, remoteActorUri)
  await database.query(
    `INSERT INTO federation_follows
       (local_actor_id, remote_actor_uri, follow_activity_uri, state, last_activity_at)
     VALUES ($1, $2, $3, 'active', now())
     ON CONFLICT (local_actor_id, remote_actor_uri) DO UPDATE SET
       follow_activity_uri = EXCLUDED.follow_activity_uri,
       state = 'active', last_activity_at = now(), updated_at = now()`,
    [localActor.id, remoteActorUri, followUri],
  )

  const acceptActivityUri = `${origin}/ap/activities/accept/${localActor.local_handle}/${randomUUID()}`
  const accept = new Accept({
    id: new URL(acceptActivityUri),
    actor: new URL(localActor.actor_uri),
    object: new URL(followUri),
  })
  if (ctx?.sendActivity) {
    const remoteActor = await lookupRemote(ctx, new URL(remoteActorUri))
    if (!isActor(remoteActor) || !remoteActor.id || !remoteActor.inboxId) {
      throw new Error('Remote Follow actor has no usable inbox.')
    }
    await ctx.sendActivity({ identifier: actorIdentifier(localActor.actor_uri, localActor.local_handle) }, [remoteActor], accept)
  }
  await database.query(
    `UPDATE federation_follows
        SET accept_activity_uri = $3, updated_at = now()
      WHERE local_actor_id = $1 AND remote_actor_uri = $2`,
    [localActor.id, remoteActorUri, acceptActivityUri],
  )
  return { accepted: true, localActorId: localActor.id, remoteActorId: remote.id }
}

export async function handleInboundUndo(undo, database) {
  const remoteActorUri = toUrlString(undo?.actorId)
  const objectUri = toUrlString(undo?.objectId)
  if (!remoteActorUri || !objectUri) return { undone: false, reason: 'missing_undo_provenance' }
  const result = await database.query(
    `UPDATE federation_follows
        SET state = 'undone', last_activity_at = now(), updated_at = now()
      WHERE remote_actor_uri = $1 AND follow_activity_uri = $2
      RETURNING id`,
    [remoteActorUri, objectUri],
  )
  return result.rows[0] ? { undone: true, followId: result.rows[0].id } : { undone: false, reason: 'unknown_follow' }
}

async function upsertRemoteActor(database, actorUri) {
  const result = await database.query(
    `INSERT INTO federation_actors
       (actor_uri, actor_type, purpose, domain, display_name, status, is_local, raw_actor, last_fetched_at)
     VALUES ($1, 'person', 'remote', $2, $1, 'active', false, $3::jsonb, now())
     ON CONFLICT (actor_uri) DO UPDATE SET last_fetched_at = now(), updated_at = now()
     RETURNING id`,
    [actorUri, hostname(actorUri), JSON.stringify({ actorUri })],
  )
  return result.rows[0]
}

function toUrlString(value) {
  if (!value) return null
  try { return new URL(String(value)).toString() } catch { return null }
}

function hostname(value) {
  try { return new URL(value).hostname } catch { return null }
}
