import { createHash } from 'node:crypto'
import { Announce, Create, isActor, LanguageString, Note, Update } from '@fedify/vocab'
import { buildLocalActor, federation, retryFailedInboundActivities } from '../federation.js'
import { refreshRemoteActors } from './federation-remote-actors.js'
import { actorIdentifier, lookupRemote } from './federation-lookup.js'
import { BOOSTING_CHANNELS, MESSAGE_CHANNELS } from './federation-channel-list.js'
import { channelNoteHtml, channelNoteUri, federationOrigin as origin, pageUrl } from './federation-notes.js'
import { hashtagHtml, hashtagObjects, hashtagsFromLabels, topicTagLabelsSql } from './federation-hashtags.js'

const PUBLIC_AUDIENCE = new URL('https://www.w3.org/ns/activitystreams#Public')
const MAX_ATTEMPTS = 8
// @hot boosts a page once it has this many published replies.
export const HOT_REPLY_THRESHOLD = 3

// Queue every page that a local actor should push and has not handled yet.
// Only recent pages are queued, so enabling federation or a new follower
// never replays the archive.
// A person or agent who publishes a public message needs their own actor to
// post it, even before anyone follows them.
async function ensureMessageAuthorActors(database) {
  await database.query(
    `INSERT INTO federation_actors (node_id, local_actor_id, actor_uri, actor_type, purpose, local_handle, acct, domain, display_name, is_local)
     SELECT DISTINCT author.node_id, author.id, format('https://%s/ap/actors/%s', node.domain, author.username),
            CASE WHEN author.kind = 'agent' THEN 'service' ELSE 'person' END, author.kind, author.username,
            author.username || '@' || node.domain, node.domain, coalesce(author.agent_name, author.display_name, author.username), true
       FROM topics topic
       JOIN actors author ON author.id = topic.author_id AND author.kind IN ('human', 'agent')
       JOIN nodes node ON node.id = author.node_id AND node.federation_enabled = true
      WHERE topic.kind = 'message' AND topic.status = 'published' AND topic.federation_outbound_mode = 'auto'
        AND topic.created_at > now() - interval '1 day'
        AND author.federation_enabled = true
        AND author.username ~ '^[a-z0-9][a-z0-9_-]{2,31}$'
        AND NOT EXISTS (SELECT 1 FROM federation_actors existing WHERE existing.local_actor_id = author.id AND existing.is_local = true)
     ON CONFLICT DO NOTHING`,
  )
}

export async function queueChannelPosts(database) {
  await ensureMessageAuthorActors(database)
  await database.query(
    `INSERT INTO federation_channel_posts (feed_actor_id, topic_id)
     SELECT feed.id, topic.id
       FROM federation_actors feed
       JOIN nodes node ON node.id = feed.node_id AND node.federation_enabled = true
        AND node.federation_mode IN ('open', 'outbound_only')
       JOIN topics topic ON topic.node_id = feed.node_id AND topic.status = 'published'
       LEFT JOIN actors author ON author.id = topic.author_id
       LEFT JOIN actors account ON account.id = feed.local_actor_id
       LEFT JOIN LATERAL (
         SELECT count(*)::int AS reply_count FROM replies WHERE replies.topic_id = topic.id AND replies.status = 'published'
       ) reply_stats ON feed.purpose = 'hot'
      WHERE feed.is_local = true AND feed.status = 'active'
        AND (
          -- @hub posts every new page; @new boosts it.
          (feed.purpose IN ('hub', 'new') AND topic.created_at > now() - interval '1 day' AND topic.kind <> 'message')
          OR (feed.purpose = 'page' AND topic.created_at > now() - interval '1 day' AND topic.kind IN ('article', 'page'))
          OR (feed.purpose = 'ask' AND topic.created_at > now() - interval '1 day'
            AND topic.kind IN ('question', 'discussion') AND topic.federation_author_id IS NULL)
          OR (feed.purpose = 'hot' AND topic.created_at > now() - interval '7 days'
            AND topic.kind <> 'message' AND reply_stats.reply_count >= $1)
          -- Public messages: the author posts, @live/@agents/@humans boost.
          OR (feed.purpose IN ('human', 'agent') AND topic.created_at > now() - interval '1 day'
            AND topic.author_id = feed.local_actor_id AND account.federation_enabled = true
            AND topic.kind = 'message' AND topic.federation_outbound_mode = 'auto')
          OR (feed.purpose IN ('live', 'agents', 'humans') AND topic.created_at > now() - interval '1 day'
            AND topic.kind = 'message' AND topic.federation_outbound_mode = 'auto' AND author.federation_enabled = true
            AND (feed.purpose = 'live' OR (feed.purpose = 'agents' AND author.kind = 'agent')
              OR (feed.purpose = 'humans' AND author.kind = 'human')))
        )
     ON CONFLICT DO NOTHING`,
    [HOT_REPLY_THRESHOLD],
  )
}

async function followersOf(context, database, feedActorId) {
  const follows = await database.query(
    `SELECT remote_actor_uri FROM federation_follows WHERE local_actor_id = $1 AND state = 'active'`,
    [feedActorId],
  )
  const recipients = []
  for (const { remote_actor_uri: uri } of follows.rows) {
    try {
      const actor = await lookupRemote(context, new URL(uri))
      if (isActor(actor) && actor.id && actor.inboxId) recipients.push(actor)
    } catch {}
  }
  return recipients
}

export async function deliverChannelPost(database, post) {
  const result = await database.query(
    `SELECT feed.id AS feed_actor_id, feed.actor_uri, feed.local_handle, feed.purpose,
            topic.id AS topic_id, topic.slug, topic.page_number, topic.status,
            revision.title, revision.body_markdown, revision.locale, ${topicTagLabelsSql('topic')}
       FROM federation_actors feed
       JOIN topics topic ON topic.id = $2
       JOIN LATERAL (
         SELECT original.title, original.body_markdown
           FROM topic_current_revisions current
           JOIN revisions original ON original.id = current.revision_id
          WHERE current.topic_id = topic.id
          ORDER BY (original.source_revision_id IS NULL) DESC, current.locale
          LIMIT 1
       ) revision ON true
      WHERE feed.id = $1`,
    [post.feed_actor_id, post.topic_id],
  )
  const row = result.rows[0]
  // A page that stopped being public before delivery is simply not sent.
  if (!row || row.status !== 'published') return 'skipped'
  const context = federation.createContext(new URL(origin), {})
  const recipients = await followersOf(context, database, row.feed_actor_id)
  if (!recipients.length) return 'delivered'
  const actorUri = new URL(row.actor_uri)
  const followersUri = new URL(`${row.actor_uri}/followers`)
  // Messages are their authors' posts (messages-<id>); pages are @hub posts.
  const personal = ['human', 'agent', ...MESSAGE_CHANNELS].includes(row.purpose)
  const objectUri = channelNoteUri(row.topic_id, { personal })
  const activityId = new URL(`${origin}/ap/activities/feeds/${row.local_handle}/${row.topic_id}`)
  const hashtags = hashtagsFromLabels(row.tag_labels)
  // Channels boost the original post instead of posting the same object
  // under another author, which servers reject.
  const activity = BOOSTING_CHANNELS.includes(row.purpose)
    ? new Announce({ id: activityId, actor: actorUri, object: objectUri, to: PUBLIC_AUDIENCE, cc: followersUri })
    : new Create({
      id: activityId,
      actor: actorUri,
      object: new Note({
        id: objectUri,
        attribution: actorUri,
        content: new LanguageString(channelNoteHtml(row) + hashtagHtml(hashtags), row.locale || 'en'),
        url: new URL(pageUrl(row)),
        tags: hashtagObjects(hashtags),
        to: PUBLIC_AUDIENCE,
        cc: followersUri,
      }),
      to: PUBLIC_AUDIENCE,
      cc: followersUri,
    })
  await context.sendActivity({ identifier: actorIdentifier(row.actor_uri, row.local_handle) }, recipients, activity)
  return 'delivered'
}

export async function runChannelPosts(database, { limit = 20 } = {}) {
  await refreshRemoteActors(database, federation.createContext(new URL(origin), {})).catch(error => {
    console.error('[fedify] remote profile refresh failed', error instanceof Error ? error.message : error)
  })
  await retryFailedInboundActivities(database).catch(error => {
    console.error('[fedify] inbound retry failed', error instanceof Error ? error.message : error)
  })
  await queueChannelPosts(database)
  const due = await database.query(
    `SELECT feed_actor_id, topic_id, attempts FROM federation_channel_posts
      WHERE state = 'queued' AND next_attempt_at <= now()
      ORDER BY created_at
      LIMIT $1`,
    [limit],
  )
  for (const post of due.rows) {
    try {
      const state = await deliverChannelPost(database, post)
      await database.query(
        `UPDATE federation_channel_posts SET state = $3, delivered_at = now(), last_error = NULL
          WHERE feed_actor_id = $1 AND topic_id = $2`,
        [post.feed_actor_id, post.topic_id, state],
      )
    } catch (error) {
      const attempts = post.attempts + 1
      await database.query(
        `UPDATE federation_channel_posts
            SET attempts = $3, last_error = $4,
                state = CASE WHEN $3 >= $5 THEN 'failed' ELSE 'queued' END,
                next_attempt_at = now() + make_interval(mins => least(60, power(2, $3)::int))
          WHERE feed_actor_id = $1 AND topic_id = $2`,
        [post.feed_actor_id, post.topic_id, attempts, String(error?.message || error).slice(0, 500), MAX_ATTEMPTS],
      )
    }
  }
}

export function startChannelPostExecutor(database, { intervalMs = 30_000 } = {}) {
  let running = false
  let lastProfileCheck = 0
  const tick = async () => {
    if (running) return
    running = true
    try {
      await runChannelPosts(database)
      if (Date.now() - lastProfileCheck > 5 * 60_000) {
        lastProfileCheck = Date.now()
        await announceChangedProfiles(database).catch(error => {
          console.error('[fedify] profile update broadcast failed', error instanceof Error ? error.message : error)
        })
      }
    } catch (error) {
      console.error('[fedify] channel post executor failed', error instanceof Error ? error.message : error)
    } finally {
      running = false
    }
  }
  const timer = setInterval(tick, intervalMs)
  timer.unref?.()
  void tick()
  return () => clearInterval(timer)
}

async function sendActorUpdate(database, row, actor) {
  const context = federation.createContext(new URL(origin), {})
  const recipients = await followersOf(context, database, row.id)
  if (!recipients.length) return false
  await context.sendActivity({ identifier: actorIdentifier(row.actor_uri, row.local_handle) }, recipients, new Update({
    id: new URL(`${row.actor_uri}#update-${Date.now()}`),
    actor: new URL(row.actor_uri),
    object: actor,
    to: PUBLIC_AUDIENCE,
    cc: new URL(`${row.actor_uri}/followers`),
  }))
  return true
}

// After a rename the actor keeps its URI (followers and old posts stay
// attached); followers get an Update so their servers show the new handle
// right away instead of on their next profile refresh.
export async function announceActorUpdate(database, localActorId) {
  const result = await database.query(
    `SELECT id, actor_uri, local_handle FROM federation_actors WHERE local_actor_id = $1 AND is_local = true LIMIT 1`,
    [localActorId],
  )
  const row = result.rows[0]
  if (!row) return false
  const actor = await buildLocalActor(row.local_handle)
  return actor ? sendActorUpdate(database, row, actor) : false
}

// Followers' servers cache profiles. When what they show changes (name,
// handle, profile link, avatar, profile fields), send them an Update.
export async function announceChangedProfiles(database, { limit = 50 } = {}) {
  const actors = await database.query(
    `SELECT actor.id, actor.actor_uri, actor.local_handle, actor.raw_actor->>'profileVersion' AS version
       FROM federation_actors actor
      WHERE actor.is_local = true AND actor.status = 'active'
        AND EXISTS (SELECT 1 FROM federation_follows follow WHERE follow.local_actor_id = actor.id AND follow.state = 'active')
      ORDER BY actor.updated_at
      LIMIT $1`,
    [limit],
  )
  let sent = 0
  for (const row of actors.rows) {
    const actor = await buildLocalActor(row.local_handle)
    if (!actor) continue
    const json = await actor.toJsonLd({ format: 'compact' })
    const version = createHash('sha256')
      .update(JSON.stringify([json.name, json.preferredUsername, json.url, json.icon, json.attachment, json.summary]))
      .digest('hex')
    if (version === row.version) continue
    if (await sendActorUpdate(database, row, actor)) sent += 1
    await database.query(
      `UPDATE federation_actors SET raw_actor = coalesce(raw_actor, '{}'::jsonb) || jsonb_build_object('profileVersion', $2::text) WHERE id = $1`,
      [row.id, version],
    )
  }
  return sent
}
