import { randomUUID } from 'node:crypto'
import { Create, Delete, LanguageString, Mention, Note, Source, Tombstone, Update, isActor } from '@fedify/vocab'
import { Temporal } from 'temporal-polyfill'
import { federation } from '../federation.js'
import { federationAllowsOutbound } from './federation-settings.js'
import { escapeHtml } from './federation-notes.js'
import { renderSafeMarkdown } from './markdown.js'
import { remoteMentions, resolveLocalMentions } from './mentions.js'
import { actorIdentifier, lookupRemote } from './federation-lookup.js'
import { extractHashtags, hashtagObjects, linkHashtagsHtml } from './federation-hashtags.js'

const origin = process.env.NUXT_PUBLIC_SITE_URL || process.env.SITE_URL || 'http://localhost:3000'
const MAX_ATTEMPTS = 8
const PUBLIC_AUDIENCE = new URL('https://www.w3.org/ns/activitystreams#Public')

export async function enqueueFederationReply(database, { replyId } = {}) {
  if (!replyId) return { queued: false, reason: 'missing_reply' }
  const client = await database.connect()
  try {
    await client.query('BEGIN')
    const result = await client.query(
      `SELECT reply.id, reply.topic_id, reply.parent_reply_id, reply.body_markdown, reply.locale, reply.author_hidden,
              topic.node_id, node.federation_enabled, node.federation_mode,
              topic.discussion_enabled, topic.accept_replies, topic.federation_outbound_mode,
              coalesce(parent_remote.object_uri, root_remote.object_uri) AS target_object_uri,
              coalesce(parent_remote.actor_uri, root_remote.actor_uri) AS target_actor_uri,
              parent_local.object_uri AS parent_local_object_uri,
              topic.kind, topic.status AS topic_status, topic.author_id AS topic_author_id,
              actor.username, actor.node_id AS actor_node_id, actor.federation_enabled AS actor_federation_enabled
         FROM replies reply
         JOIN topics topic ON topic.id = reply.topic_id
         JOIN nodes node ON node.id = topic.node_id
         JOIN actors actor ON actor.id = reply.author_id
         -- Only remote objects are reply targets: a page announced by @new also
         -- has a local root object, which must not make the thread look local.
         LEFT JOIN LATERAL (
           SELECT object.object_uri, object_actor.actor_uri
             FROM federation_objects object
             JOIN federation_actors object_actor ON object_actor.id = object.actor_id AND object_actor.is_local = false
            WHERE object.reply_id = reply.parent_reply_id AND object.state = 'active'
            LIMIT 1
         ) parent_remote ON reply.parent_reply_id IS NOT NULL
         LEFT JOIN LATERAL (
           SELECT object.object_uri, object_actor.actor_uri
             FROM federation_objects object
             JOIN federation_actors object_actor ON object_actor.id = object.actor_id AND object_actor.is_local = false
            WHERE object.topic_id = topic.id AND object.reply_id IS NULL AND object.state = 'active'
            ORDER BY object.created_at
            LIMIT 1
         ) root_remote ON true
         -- In a thread started here, a reply answers the parent's own object
         -- (a reply already federated from this site).
         LEFT JOIN LATERAL (
           SELECT object.object_uri FROM federation_objects object
            WHERE object.reply_id = reply.parent_reply_id AND object.state = 'active'
            LIMIT 1
         ) parent_local ON reply.parent_reply_id IS NOT NULL
        WHERE reply.id = $1
        LIMIT 1 FOR UPDATE OF reply`,
      [replyId],
    )
    const row = result.rows[0]
    if (!row) {
      await client.query('COMMIT')
      return { queued: false, reason: 'missing_reply' }
    }
    // A thread started on this site: the page is a @new post (a message is
    // its author's post). The reply goes to that thread; target_actor_uri
    // stays NULL to mean "everyone in the thread" at delivery time.
    if (!row.target_object_uri) {
      if (row.topic_status !== 'published') {
        await client.query('COMMIT')
        return { queued: false, reason: 'topic_not_public' }
      }
      row.target_object_uri = row.parent_local_object_uri || await ensureLocalThreadRoot(client, row)
      row.target_actor_uri = null
      if (!row.target_object_uri) {
        await client.query('COMMIT')
        return { queued: false, reason: 'topic_not_federated' }
      }
    }
    if (row.actor_federation_enabled !== true) {
      await client.query('COMMIT')
      return { queued: false, reason: 'account_federation_disabled', state: 'none' }
    }
    if (row.discussion_enabled === false || row.accept_replies === false || row.federation_outbound_mode === 'none') {
      await client.query('COMMIT')
      return { queued: false, reason: 'topic_federation_disabled', state: 'none' }
    }
    const enabled = federationAllowsOutbound({ enabled: row.federation_enabled === true, mode: row.federation_mode })
    const state = row.federation_outbound_mode === 'manual' ? 'paused' : (enabled ? 'queued' : 'paused')
    // An anonymous reply is posted by @anon, never by the author's actor; its
    // object id differs so revealing the author later creates a new post.
    const localActor = row.author_hidden === true ? await anonActor(client, row.node_id) : await ensureLocalActor(client, row)
    if (!localActor) {
      await client.query('COMMIT')
      return { queued: false, reason: 'anonymous_actor_missing' }
    }
    const objectUri = `${origin}/ap/objects/notes/replies-${row.id}${row.author_hidden === true ? '-anon' : ''}`
    const activityUri = `${origin}/ap/activities/replies/${row.id}/${randomUUID()}`
    await client.query(
      `INSERT INTO federation_objects (object_uri, actor_id, object_type, reply_id, in_reply_to_uri, visibility, raw_object)
       VALUES ($1, $2, 'note', $3, $4, 'public', '{}'::jsonb)
       ON CONFLICT (object_uri) DO UPDATE SET actor_id = EXCLUDED.actor_id, in_reply_to_uri = EXCLUDED.in_reply_to_uri`,
      [objectUri, localActor.id, row.id, row.target_object_uri],
    )
    const delivery = await client.query(
      `INSERT INTO federation_reply_deliveries (reply_id, topic_id, target_object_uri, target_actor_uri, activity_uri, state)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (reply_id, target_object_uri) DO UPDATE SET target_actor_uri = EXCLUDED.target_actor_uri, activity_uri = EXCLUDED.activity_uri, state = EXCLUDED.state, attempts = 0, next_attempt_at = now(), last_error = NULL, updated_at = now()
       RETURNING id, state, activity_uri`,
       [row.id, row.topic_id, row.target_object_uri, row.target_actor_uri, activityUri, state],
    )
    await client.query(
      `UPDATE replies SET federation_object_uri = $2, federation_activity_uri = $3, federation_delivery_state = $4 WHERE id = $1`,
      [row.id, objectUri, delivery.rows[0]?.activity_uri || activityUri, state],
    )
    await client.query('COMMIT')
    return { queued: state === 'queued', state: delivery.rows[0]?.state || state }
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally { client.release() }
}

export async function deliverFederationReply(database, deliveryId) {
  const result = await database.query(
    `SELECT delivery.*, reply.body_markdown, reply.locale, reply.federation_object_uri, topic.page_number, topic.slug AS topic_slug,
            local_actor.actor_uri AS local_actor_uri, local_actor.local_handle,
            reply_author.federation_enabled AS author_federation_enabled,
            topic.discussion_enabled, topic.accept_replies, topic.federation_outbound_mode,
            remote_actor.actor_uri AS remote_actor_uri
       FROM federation_reply_deliveries delivery
       JOIN replies reply ON reply.id = delivery.reply_id
       JOIN federation_objects local_object ON local_object.reply_id = reply.id AND local_object.object_uri = reply.federation_object_uri
       JOIN federation_actors local_actor ON local_actor.id = local_object.actor_id
       LEFT JOIN actors reply_author ON reply_author.id = reply.author_id
       LEFT JOIN federation_actors remote_actor ON remote_actor.actor_uri = delivery.target_actor_uri
       JOIN topics topic ON topic.id = delivery.topic_id
       JOIN nodes node ON node.id = topic.node_id
      WHERE delivery.id = $1 AND node.federation_enabled = true
        AND node.federation_mode IN ('open', 'outbound_only')
      LIMIT 1`,
    [deliveryId],
  )
  const row = result.rows[0]
  if (!row) throw new Error('Remote Fediverse actor is unavailable.')
  const threadDelivery = !row.target_actor_uri
  if (!threadDelivery && !row.remote_actor_uri) throw new Error('Remote Fediverse actor is unavailable.')
  if (row.author_federation_enabled !== true) {
    await database.query(`UPDATE federation_reply_deliveries SET state = 'cancelled', updated_at = now(), last_error = NULL WHERE id = $1`, [deliveryId])
    await database.query(`UPDATE replies SET federation_delivery_state = 'none' WHERE id = $1`, [row.reply_id])
    return
  }
  if (row.discussion_enabled === false || row.accept_replies === false || row.federation_outbound_mode !== 'auto') {
    await database.query(`UPDATE federation_reply_deliveries SET state = 'cancelled', updated_at = now(), last_error = NULL WHERE id = $1`, [deliveryId])
    await database.query(`UPDATE replies SET federation_delivery_state = 'none' WHERE id = $1`, [row.reply_id])
    return
  }
  const context = federation.createContext(new URL(origin), {})
  const composed = await composeReplyNote(context, database, row)
  if (composed.recipients.length) {
    const activity = new Create({
      id: new URL(row.activity_uri),
      actor: new URL(row.local_actor_uri),
      object: composed.note,
      to: PUBLIC_AUDIENCE,
      ccs: composed.ccs,
    })
    await context.sendActivity({ identifier: actorIdentifier(row.local_actor_uri, row.local_handle) }, composed.recipients, activity)
  }
  await database.query(
    `UPDATE federation_reply_deliveries SET state = 'delivered', delivered_at = now(), updated_at = now(), last_error = NULL WHERE id = $1`,
    [deliveryId],
  )
  await database.query(`UPDATE replies SET federation_delivery_state = 'delivered' WHERE id = $1`, [row.reply_id])
  await database.query(
    `UPDATE nodes SET federation_last_error = NULL WHERE id = (SELECT node_id FROM topics WHERE id = $1)`,
    [row.topic_id],
  )
}

// The reply Note and who should receive it: in a remote thread the person
// answered (mentioned, so they are notified) plus the author's followers; in a
// thread started here, everyone following that thread.
async function composeReplyNote(context, database, row) {
  const followers = new URL(`${row.local_actor_uri}/followers`)
  let recipients
  let mentionHtml = ''
  let tags = []
  let ccs = [followers]
  if (!row.target_actor_uri) {
    recipients = await threadAudience(context, database, row)
  } else {
    const signer = actorIdentifier(row.local_actor_uri, row.local_handle)
    let remoteActor = await lookupRemote(context, new URL(row.remote_actor_uri || row.target_actor_uri), signer)
    // A stored profile-page address may not answer ActivityPub requests: find
    // the author through the post being answered instead.
    if (!isActor(remoteActor) || !remoteActor.inboxId) {
      const target = await lookupRemote(context, new URL(row.target_object_uri), signer)
      remoteActor = target?.attributionId ? await lookupRemote(context, target.attributionId, signer) : null
    }
    if (!isActor(remoteActor) || !remoteActor.id || !remoteActor.inboxId) {
      throw new Error('Remote Fediverse actor has no usable inbox.')
    }
    const handle = `@${remoteActor.preferredUsername || 'user'}@${remoteActor.id.host}`
    // Unless the author already mentioned them in the text.
    if (!String(row.body_markdown || '').toLowerCase().includes(handle.toLowerCase())) {
      mentionHtml = `<p><span class="h-card"><a href="${remoteActor.url?.href || remoteActor.id.href}" class="u-url mention">${escapeHtml(handle)}</a></span></p>`
    }
    tags = [new Mention({ href: remoteActor.id, name: handle })]
    ccs = [remoteActor.id, followers]
    recipients = [remoteActor, ...(await followersOfLocal(context, database, row.local_actor_uri))]
    // The thread's first author too: their server then has every reply and
    // shows the whole thread, not only the replies addressed to its users.
    const rootAuthor = await database.query(
      `SELECT author.actor_uri
         FROM federation_objects root
         JOIN federation_actors author ON author.id = root.actor_id AND author.is_local = false
        WHERE root.topic_id = $1 AND root.reply_id IS NULL AND root.state = 'active'
        ORDER BY root.created_at LIMIT 1`,
      [row.topic_id],
    )
    const rootUri = rootAuthor.rows[0]?.actor_uri
    if (rootUri && rootUri !== remoteActor.id.href) {
      const root = await lookupRemote(context, new URL(rootUri), signer)
      if (isActor(root) && root.id && root.inboxId) {
        recipients.push(root)
        ccs.push(root.id)
      }
    }
  }
  // @user@server and @username in the text: tag them (their servers notify
  // them) and deliver to remote people even outside this thread.
  for (const mentioned of await mentionedActors(context, database, row.body_markdown)) {
    if (tags.some(tag => tag.href?.href === mentioned.id.href)) continue
    tags = [...tags, new Mention({ href: mentioned.id, name: mentioned.handle })]
    ccs = [...ccs, mentioned.id]
    if (mentioned.actor && !recipients.some(recipient => recipient.id?.href === mentioned.id.href)) recipients = [...recipients, mentioned.actor]
  }
  // #words in the reply: linked in the text and filed under those hashtags.
  const hashtags = extractHashtags(row.body_markdown)
  tags = [...tags, ...hashtagObjects(hashtags)]
  const note = new Note({
    id: new URL(row.federation_object_uri),
    // Fediverse servers render HTML, not Markdown; keep the Markdown as source.
    // Mention and page links must be absolute there.
    content: new LanguageString((mentionHtml + linkHashtagsHtml(renderSafeMarkdown(row.body_markdown), hashtags)).replace(/href="\//g, `href="${origin}/`), row.locale || 'en'),
    source: new Source({ content: row.body_markdown, mediaType: 'text/markdown' }),
    attribution: new URL(row.local_actor_uri),
    replyTarget: new URL(row.target_object_uri),
    url: new URL(`${origin}/${row.page_number || encodeURIComponent(row.topic_slug)}#comment-${row.reply_id}`),
    tags,
    to: PUBLIC_AUDIENCE,
    ccs,
    updated: row.edited ? Temporal.Now.instant() : null,
  })
  return { note, recipients, ccs }
}

async function mentionedActors(context, database, text) {
  const result = []
  for (const mention of remoteMentions(text)) {
    try {
      const actor = await lookupRemote(context, `acct:${mention.username}@${mention.domain}`)
      if (isActor(actor) && actor.id && actor.inboxId) result.push({ id: actor.id, handle: `@${mention.username}@${mention.domain}`, actor })
    } catch {}
  }
  const locals = await resolveLocalMentions(database, text)
  if (locals.length) {
    const actors = await database.query(
      `SELECT actor_uri, local_handle FROM federation_actors WHERE is_local = true AND local_actor_id = ANY($1::uuid[])`,
      [locals.map(actor => actor.id)],
    )
    for (const row of actors.rows) result.push({ id: new URL(row.actor_uri), handle: `@${row.local_handle}@${new URL(origin).hostname}`, actor: null })
  }
  return result
}

async function loadFederatedReply(database, replyId) {
  const result = await database.query(
    `SELECT reply.id AS reply_id, reply.status, reply.author_hidden, reply.body_markdown, reply.locale, reply.federation_object_uri,
            reply.federation_delivery_state, reply.topic_id, topic.page_number, topic.slug AS topic_slug,
            object.in_reply_to_uri AS target_object_uri, local_actor.actor_uri AS local_actor_uri,
            local_actor.local_handle, local_actor.purpose AS local_actor_purpose,
            delivery.target_actor_uri
       FROM replies reply
       JOIN topics topic ON topic.id = reply.topic_id
       JOIN federation_objects object ON object.object_uri = reply.federation_object_uri AND object.state = 'active'
       JOIN federation_actors local_actor ON local_actor.id = object.actor_id AND local_actor.is_local = true
       LEFT JOIN LATERAL (
         SELECT target_actor_uri FROM federation_reply_deliveries
          WHERE reply_id = reply.id ORDER BY updated_at DESC LIMIT 1
       ) delivery ON true
      WHERE reply.id = $1`,
    [replyId],
  )
  return result.rows[0] || null
}

// Keeps the Fediverse copy of a reply in line with the site: a deleted reply
// is deleted there, a change of anonymity replaces the post (an author cannot
// be changed on a delivered post), and an edited text is sent as an Update.
export async function syncFederatedReply(database, replyId) {
  const row = await loadFederatedReply(database, replyId)
  if (!row) {
    const reply = await database.query(`SELECT status FROM replies WHERE id = $1`, [replyId])
    if (reply.rows[0]?.status === 'published') return enqueueFederationReply(database, { replyId })
    return { synced: false, reason: 'not_federated' }
  }
  const context = federation.createContext(new URL(origin), {})
  const anonymousNow = row.local_actor_purpose === 'anon'
  const removed = row.status !== 'published'
  if (removed || anonymousNow !== (row.author_hidden === true)) {
    if (row.federation_delivery_state === 'delivered') {
      const { recipients } = await composeReplyNote(context, database, row).catch(() => ({ recipients: [] }))
      if (recipients.length) {
        await context.sendActivity({ identifier: actorIdentifier(row.local_actor_uri, row.local_handle) }, recipients, new Delete({
          id: new URL(`${row.federation_object_uri}#delete-${Date.now()}`),
          actor: new URL(row.local_actor_uri),
          object: new Tombstone({ id: new URL(row.federation_object_uri) }),
          to: PUBLIC_AUDIENCE,
        }))
      }
    }
    await database.query(`UPDATE federation_objects SET state = 'deleted', updated_at = now() WHERE object_uri = $1`, [row.federation_object_uri])
    await database.query(
      `UPDATE replies SET federation_object_uri = NULL, federation_activity_uri = NULL, federation_delivery_state = 'none' WHERE id = $1`,
      [replyId],
    )
    return removed ? { synced: true, deleted: true } : enqueueFederationReply(database, { replyId })
  }
  if (row.federation_delivery_state !== 'delivered') return { synced: false, reason: 'not_delivered' }
  const composed = await composeReplyNote(context, database, { ...row, edited: true })
  if (composed.recipients.length) {
    await context.sendActivity({ identifier: actorIdentifier(row.local_actor_uri, row.local_handle) }, composed.recipients, new Update({
      id: new URL(`${row.federation_object_uri}#update-${Date.now()}`),
      actor: new URL(row.local_actor_uri),
      object: composed.note,
      to: PUBLIC_AUDIENCE,
      ccs: composed.ccs,
    }))
  }
  return { synced: true, updated: true }
}

// Replies written in a Fediverse thread that never got queued (for example
// before a fix, or by a path that missed the enqueue call) are picked up here.
export async function enqueueMissedFederationReplies(database, { limit = 20 } = {}) {
  const missed = await database.query(
    `SELECT reply.id
       FROM replies reply
       JOIN actors author ON author.id = reply.author_id AND author.federation_enabled = true
      WHERE reply.status = 'published'
        AND reply.federation_delivery_state = 'none'
        AND reply.federation_object_uri IS NULL
        AND reply.created_at > now() - interval '3 days'
        AND EXISTS (
          SELECT 1 FROM federation_objects object
            JOIN federation_actors object_actor ON object_actor.id = object.actor_id AND object_actor.is_local = false
           WHERE object.topic_id = reply.topic_id AND object.reply_id IS NULL AND object.state = 'active'
        )
      ORDER BY reply.created_at
      LIMIT $1`,
    [limit],
  )
  for (const { id } of missed.rows) await enqueueFederationReply(database, { replyId: id })
  const mismatched = await database.query(
    `SELECT reply.id
       FROM replies reply
       JOIN federation_objects object ON object.object_uri = reply.federation_object_uri AND object.state = 'active'
       JOIN federation_actors local_actor ON local_actor.id = object.actor_id AND local_actor.is_local = true
      WHERE reply.created_at > now() - interval '30 days'
        AND ((reply.author_hidden IS TRUE) <> (local_actor.purpose = 'anon') OR reply.status <> 'published')
      LIMIT $1`,
    [limit],
  )
  for (const { id } of mismatched.rows) await syncFederatedReply(database, id).catch(error => {
    console.error('[fedify] reply sync failed', error instanceof Error ? error.message : error)
  })
  return missed.rows.length + mismatched.rows.length
}

export function startFederationDeliveryExecutor(database, { intervalMs = 5000 } = {}) {
  let running = false
  let lastCatchUp = 0
  const tick = async () => {
    if (running) return
    running = true
    try {
      if (Date.now() - lastCatchUp > 5 * 60_000) {
        lastCatchUp = Date.now()
        await enqueueMissedFederationReplies(database)
      }
      const claimed = await claimDueDeliveries(database)
      for (const delivery of claimed) {
        try {
          await deliverFederationReply(database, delivery.id)
        } catch (error) {
          await markDeliveryFailure(database, delivery, error)
        }
      }
    } catch (error) {
      console.error('[fedify] delivery executor failed', error)
    } finally { running = false }
  }
  const timer = setInterval(tick, intervalMs)
  timer.unref?.()
  void tick()
  return () => clearInterval(timer)
}

async function claimDueDeliveries(database) {
  const client = await database.connect()
  try {
    await client.query('BEGIN')
    const result = await client.query(
      `WITH next_delivery AS (
        SELECT id FROM federation_reply_deliveries
         WHERE state IN ('queued', 'retry') AND next_attempt_at <= now()
         ORDER BY next_attempt_at, created_at
         FOR UPDATE SKIP LOCKED LIMIT 10
      )
      UPDATE federation_reply_deliveries delivery
         SET state = 'retry', attempts = attempts + 1, last_attempt_at = now(),
             next_attempt_at = now() + interval '5 minutes', updated_at = now()
        FROM next_delivery
       WHERE delivery.id = next_delivery.id
      RETURNING delivery.id, delivery.attempts`,
    )
    await client.query('COMMIT')
    return result.rows
  } catch (error) { await client.query('ROLLBACK'); throw error } finally { client.release() }
}

async function markDeliveryFailure(database, delivery, error) {
  const message = error instanceof Error ? error.message.slice(0, 1000) : String(error).slice(0, 1000)
  const failed = Number(delivery.attempts) >= MAX_ATTEMPTS
  const delay = Math.min(3600, 10 * (2 ** Math.max(0, Number(delivery.attempts) - 1)) + Math.floor(Math.random() * 5))
  await database.query(
    `UPDATE federation_reply_deliveries SET state = $2, next_attempt_at = now() + ($3 * interval '1 second'), last_error = $4, updated_at = now() WHERE id = $1`,
    [delivery.id, failed ? 'failed' : 'retry', delay, message],
  )
  await database.query(`UPDATE replies SET federation_delivery_state = $2 WHERE id = (SELECT reply_id FROM federation_reply_deliveries WHERE id = $1)`, [delivery.id, failed ? 'failed' : 'retry'])
  await database.query(
    `UPDATE nodes SET federation_last_error = $2
      WHERE id = (SELECT topic.node_id FROM federation_reply_deliveries delivery JOIN topics topic ON topic.id = delivery.topic_id WHERE delivery.id = $1)`,
    [delivery.id, message],
  )
}

// The page's own Fediverse post: @hub posted it as topics-<id> (older pages
// were posted by @new and keep that owner); a public
// message is its author's messages-<id>. Make sure the object row exists.
async function ensureLocalThreadRoot(client, row) {
  const personal = row.kind === 'message'
  const objectUri = `${origin}/ap/objects/notes/${personal ? 'messages' : 'topics'}-${row.topic_id}`
  const owner = await client.query(
    personal
      ? `SELECT id FROM federation_actors WHERE local_actor_id = $1 AND is_local = true LIMIT 1`
      : `SELECT id FROM federation_actors WHERE node_id = $1 AND is_local = true AND purpose = 'hub' LIMIT 1`,
    [personal ? row.topic_author_id : row.node_id],
  )
  if (!owner.rows[0]) return null
  await client.query(
    `INSERT INTO federation_objects (object_uri, actor_id, object_type, topic_id, visibility, raw_object)
     VALUES ($1, $2, 'note', $3, 'public', '{}'::jsonb)
     ON CONFLICT (object_uri) DO NOTHING`,
    [objectUri, owner.rows[0].id, row.topic_id],
  )
  return objectUri
}

async function lookupActors(context, uris) {
  const actors = []
  for (const uri of new Set(uris)) {
    try {
      const actor = await lookupRemote(context, new URL(uri))
      if (isActor(actor) && actor.id && actor.inboxId) actors.push(actor)
    } catch {}
  }
  return actors
}

async function followersOfLocal(context, database, localActorUri) {
  const follows = await database.query(
    `SELECT follow.remote_actor_uri FROM federation_follows follow
       JOIN federation_actors local_actor ON local_actor.id = follow.local_actor_id
      WHERE local_actor.actor_uri = $1 AND follow.state = 'active'`,
    [localActorUri],
  )
  return lookupActors(context, follows.rows.map(row => row.remote_actor_uri))
}

// Everyone following a thread started here: followers of the page post
// (@new, or the message author), followers of the reply author, and every
// Fediverse person who already wrote in the thread.
async function threadAudience(context, database, row) {
  const result = await database.query(
    `SELECT follow.remote_actor_uri AS uri
       FROM federation_follows follow
       JOIN federation_objects root ON root.object_uri IN ($2, $3) AND root.actor_id = follow.local_actor_id
      WHERE follow.state = 'active'
     UNION
     SELECT follow.remote_actor_uri FROM federation_follows follow
       JOIN federation_actors author ON author.id = follow.local_actor_id AND author.actor_uri = $4
      WHERE follow.state = 'active'
     UNION
     SELECT remote.actor_uri FROM replies reply
       JOIN federation_actors remote ON remote.id = reply.federation_author_id AND remote.is_local = false
      WHERE reply.topic_id = $1 AND reply.status = 'published'
     UNION
     SELECT remote.actor_uri FROM topics topic
       JOIN federation_actors remote ON remote.id = topic.federation_author_id AND remote.is_local = false
      WHERE topic.id = $1`,
    [row.topic_id, `${origin}/ap/objects/notes/topics-${row.topic_id}`, `${origin}/ap/objects/notes/messages-${row.topic_id}`, row.local_actor_uri],
  )
  return lookupActors(context, result.rows.map(item => item.uri))
}

async function anonActor(client, nodeId) {
  const result = await client.query(
    `SELECT * FROM federation_actors WHERE node_id = $1 AND is_local = true AND purpose = 'anon' AND status = 'active' LIMIT 1`,
    [nodeId],
  )
  return result.rows[0] || null
}

async function ensureLocalActor(client, row) {
  const existing = await client.query(`SELECT * FROM federation_actors WHERE local_actor_id = (SELECT author_id FROM replies WHERE id = $1) AND is_local`, [row.id])
  if (existing.rows[0]) return existing.rows[0]
  const handle = normalizeHandle(row.username, row.id)
  const actorUri = `${origin}/ap/actors/${handle}`
  const result = await client.query(
    `INSERT INTO federation_actors (node_id, local_actor_id, actor_uri, actor_type, purpose, local_handle, acct, domain, display_name, is_local)
     SELECT $1, reply.author_id, $2,
            CASE WHEN actor.kind = 'agent' THEN 'service' ELSE 'person' END,
            actor.kind, $3, $4, nodes.domain, coalesce(actor.agent_name, actor.display_name, actor.username), true
       FROM replies reply JOIN actors actor ON actor.id = reply.author_id JOIN nodes ON nodes.id = actor.node_id
      WHERE reply.id = $5
     RETURNING *`,
    [row.actor_node_id, actorUri, handle, `${handle}@${new URL(origin).hostname}`, row.id],
  )
  return result.rows[0]
}

function normalizeHandle(value, id) {
  const handle = String(value || '').toLowerCase().replace(/[^a-z0-9_-]/g, '-').replace(/^-+|-+$/g, '').slice(0, 31) || `user-${String(id).slice(0, 8)}`
  return /^[a-z0-9]/.test(handle) ? handle : `user-${handle}`
}
