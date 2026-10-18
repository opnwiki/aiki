import { randomUUID } from 'node:crypto'
import { isActor, Like, Undo } from '@fedify/vocab'
import { buildLocalActor, federation } from '../federation.js'
import { actorIdentifier, lookupRemote } from './federation-lookup.js'
import { federationAllowsOutbound, currentFederationSettings } from './federation-settings.js'

const origin = process.env.NUXT_PUBLIC_SITE_URL || process.env.SITE_URL || 'http://localhost:3000'

// The remote post a page or reply was copied from, if any.
async function remoteObjectFor(database, targetType, targetId) {
  const result = await database.query(
    `SELECT object.object_uri, author.actor_uri AS author_uri
       FROM federation_objects object
       JOIN federation_actors author ON author.id = object.actor_id AND author.is_local = false
      WHERE object.state = 'active'
        AND ${targetType === 'reply' ? 'object.reply_id = $1::uuid' : 'object.topic_id = $1::uuid AND object.reply_id IS NULL'}
      ORDER BY object.created_at
      LIMIT 1`,
    [targetId],
  )
  return result.rows[0] || null
}

// The voter's own actor, only when both they and the node publish to the Fediverse.
async function voterActor(database, actorId) {
  const result = await database.query(
    `SELECT actor.username, actor.federation_enabled AS actor_enabled, node.federation_enabled, node.federation_mode
       FROM actors actor JOIN nodes node ON node.id = actor.node_id
      WHERE actor.id = $1 AND actor.kind IN ('human', 'agent')
        AND actor.username ~ '^[a-z0-9][a-z0-9_-]{2,31}$'`,
    [actorId],
  )
  const row = result.rows[0]
  if (!row || row.actor_enabled !== true || !federationAllowsOutbound(currentFederationSettings(row))) return null
  if (!await buildLocalActor(row.username)) return null
  const local = await database.query(
    `SELECT id, actor_uri, local_handle FROM federation_actors WHERE local_actor_id = $1 AND is_local = true AND status = 'active' LIMIT 1`,
    [actorId],
  )
  return local.rows[0] || null
}

// After a vote: an upvote on a copied Fediverse post likes the original, and
// taking it back (0 or a downvote) undoes that like. Downvotes themselves
// stay local. Failures never undo the vote here.
export async function federateVote(database, { actorId, targetType, targetId, value }) {
  if (!['topic', 'reply'].includes(targetType)) return { federated: false }
  try {
    const remote = await remoteObjectFor(database, targetType, targetId)
    if (!remote) return { federated: false, reason: 'not_from_fediverse' }
    const local = await voterActor(database, actorId)
    if (!local) return { federated: false, reason: 'federation_disabled' }
    const existing = await database.query(
      `SELECT id, activity_uri FROM federation_outbound_likes
        WHERE local_actor_id = $1 AND object_uri = $2 AND undone_at IS NULL LIMIT 1`,
      [local.id, remote.object_uri],
    )
    const live = existing.rows[0]
    if (value === 1 && live) return { federated: true, like: 'already_sent' }
    if (value !== 1 && !live) return { federated: false, reason: 'nothing_to_undo' }
    const context = federation.createContext(new URL(origin), {})
    const signer = actorIdentifier(local.actor_uri, local.local_handle)
    const author = await lookupRemote(context, new URL(remote.author_uri), signer)
    if (!isActor(author) || !author.inboxId) return { federated: false, reason: 'author_unreachable' }
    const actorUri = new URL(local.actor_uri)
    if (value === 1) {
      const activityUri = `${origin}/ap/activities/likes/${randomUUID()}`
      const inserted = await database.query(
        `INSERT INTO federation_outbound_likes (activity_uri, local_actor_id, object_uri, target_type, target_id)
         VALUES ($1, $2, $3, $4, $5::uuid)
         ON CONFLICT DO NOTHING RETURNING id`,
        [activityUri, local.id, remote.object_uri, targetType, targetId],
      )
      if (!inserted.rows[0]) return { federated: true, like: 'already_sent' }
      await context.sendActivity({ identifier: signer }, author, new Like({ id: new URL(activityUri), actor: actorUri, object: new URL(remote.object_uri) }))
      return { federated: true, like: 'sent' }
    }
    await database.query('UPDATE federation_outbound_likes SET undone_at = now() WHERE id = $1', [live.id])
    await context.sendActivity({ identifier: signer }, author, new Undo({
      id: new URL(`${live.activity_uri}#undo-${Date.now()}`),
      actor: actorUri,
      object: new Like({ id: new URL(live.activity_uri), actor: actorUri, object: new URL(remote.object_uri) }),
    }))
    return { federated: true, like: 'undone' }
  } catch (error) {
    console.error('[fedify] vote federation failed', error instanceof Error ? error.message : error)
    return { federated: false, reason: 'delivery_failed' }
  }
}
