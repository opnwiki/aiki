import { createHash } from 'node:crypto'
import postgres from 'postgres'
import {
  createFederation,
  generateCryptoKeyPair,
  importJwk,
  InProcessMessageQueue,
  MemoryKvStore,
} from '@fedify/fedify'
import { PostgresKvStore, PostgresMessageQueue } from '@fedify/postgres'
import { Accept, Activity, Announce, Create, CryptographicKey, Delete, Follow, Group, Image, isActor, LanguageString, Like, Mention, Note, Person, PropertyValue, Service, Undo, Update } from '@fedify/vocab'
import { getDatabase } from './utils/database.js'
import { applyInboundDelete, applyInboundLike, applyInboundUpdate, ingestInboundCreate, undoInboundLike } from './utils/federation-inbound.js'
import { handleInboundFollow, handleInboundUndo } from './utils/federation-follow.js'
import { currentFederationSettings, federationAllowsInbound, federationAllowsOutbound } from './utils/federation-settings.js'
import { readFederationKeyPayload } from './utils/federation-keys.js'
import { BOOSTING_CHANNELS, channelSqlList, isChannelHandle, MESSAGE_CHANNELS } from './utils/federation-channel-list.js'
import { channelNoteHtml, escapeHtml, pageUrl } from './utils/federation-notes.js'
import { refreshRemoteActor } from './utils/federation-remote-actors.js'
import { lookupRemote } from './utils/federation-lookup.js'
import { profilePath } from './utils/profile-path.js'
import { renderSafeMarkdown } from './utils/markdown.js'
import { extractHashtags, hashtagHtml, hashtagObjects, hashtagsFromLabels, linkHashtagsHtml, topicTagLabelsSql } from './utils/federation-hashtags.js'

const origin = process.env.NUXT_PUBLIC_SITE_URL || process.env.SITE_URL || 'http://localhost:3000'
const databaseUrl = process.env.DATABASE_URL || process.env.NUXT_DATABASE_URL || ''
const sql = databaseUrl ? postgres(databaseUrl, { max: 10, idle_timeout: 20 }) : null
const kv = sql ? new PostgresKvStore(sql) : new MemoryKvStore()
const queue = sql ? new PostgresMessageQueue(sql) : new InProcessMessageQueue()
let keysPromise = loadSigningKeys()

const federation = createFederation({
  origin,
  kv,
  queue,
  allowPrivateAddress: false,
})

// Builds the public actor for a local handle (or its stable actor URI, which
// keeps working after a rename). Also embedded in Update activities.
export async function buildLocalActor(identifier) {
  const database = getDatabase()
  const result = await database.query(
    `SELECT federation_actors.*
       FROM federation_actors
       JOIN nodes ON nodes.id = federation_actors.node_id
       LEFT JOIN actors local_actor ON local_actor.id = federation_actors.local_actor_id
      WHERE federation_actors.is_local = true
        AND (federation_actors.local_handle = $1 OR federation_actors.actor_uri = $2)
        AND federation_actors.status = 'active'
        AND (federation_actors.local_actor_id IS NULL OR local_actor.federation_enabled = true)
        AND (federation_actors.local_actor_id IS NULL OR local_actor.username ~ '^[a-z0-9][a-z0-9_-]{2,31}$')
        AND nodes.federation_enabled = true
      LIMIT 1`,
    [identifier, `${origin}/ap/actors/${encodeURIComponent(identifier)}`],
  )
  let row = result.rows[0]
  if (!row) {
    const account = await database.query(
      `SELECT actor.id, actor.node_id, actor.username, coalesce(actor.agent_name, actor.display_name, actor.username) AS display_name, actor.kind, node.domain
         FROM actors actor JOIN nodes node ON node.id = actor.node_id
        WHERE actor.kind IN ('human', 'agent') AND actor.username = $1 AND actor.username ~ '^[a-z0-9][a-z0-9_-]{2,31}$'
          AND actor.federation_enabled = true
          AND node.federation_enabled = true AND node.domain = $2
        LIMIT 1`,
      [identifier, new URL(origin).hostname],
    )
    if (account.rows[0]) {
      const local = account.rows[0]
      const inserted = await database.query(
        `INSERT INTO federation_actors (node_id, local_actor_id, actor_uri, actor_type, purpose, local_handle, acct, domain, display_name, is_local)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, true)
         ON CONFLICT DO NOTHING
         RETURNING *`,
        [local.node_id, local.id, `${origin}/ap/actors/${identifier}`, local.kind === 'agent' ? 'service' : 'person', local.kind, identifier, `${identifier}@${local.domain}`, local.domain, local.display_name || identifier],
      )
      row = inserted.rows[0] || (await database.query('SELECT * FROM federation_actors WHERE local_actor_id = $1 AND is_local LIMIT 1', [local.id])).rows[0]
    }
  }
  if (!row) return null
  const pair = await keysPromise
  if (pair.ephemeral && process.env.NODE_ENV === 'production') {
    throw new Error('A federation signing key must be created before serving ActivityPub in production.')
  }
  const actorUri = new URL(row.actor_uri)
  const keyId = new URL(`${actorUri}#main-key`)
  const icon = await actorIcon(database, row)
  const ActorClass = row.actor_type === 'group' ? Group : row.actor_type === 'service' ? Service : Person
  return new ActorClass({
    id: actorUri,
    preferredUsername: row.local_handle,
    name: row.display_name || row.local_handle,
    summary: row.summary || null,
    icon,
    // Channels have no /users page; their profile is the Fediverse guide.
    url: new URL(await actorProfileUrl(database, row)),
    attachments: row.local_actor_id ? [] : channelProfileFields(),
    inbox: new URL(`${actorUri}/inbox`),
    outbox: new URL(`${actorUri}/outbox`),
    followers: new URL(`${actorUri}/followers`),
    publicKeys: [
      new CryptographicKey({ id: keyId, owner: actorUri, publicKey: pair.rsa.publicKey }),
      ...(pair.ed ? [new CryptographicKey({ id: new URL(`${actorUri}#ed25519-key`), owner: actorUri, publicKey: pair.ed.publicKey })] : []),
    ],
  })
}

federation.setActorDispatcher('/ap/actors/{identifier}', async (_ctx, identifier) => buildLocalActor(identifier)).setKeyPairsDispatcher(async () => {
  const pair = await keysPromise
  if (pair.ephemeral && process.env.NODE_ENV === 'production') {
    throw new Error('A federation signing key must be created before serving ActivityPub in production.')
  }
  return [pair.rsa, ...(pair.ed ? [pair.ed] : [])]
}).mapHandle((_ctx, username) => actorIdentifierForHandle(username))

// Channels (@new, @hot, @ask) wear the node's app icon, like the instance
// itself; people and agents use the avatar they selected (served by AIKI,
// including the proxied Statica picture) when it is cached.
// Channels have no profile of their own: the Fediverse guide is their page.
// People and agents link to their site profile (/<login>, else /people/<id>).
async function actorProfileUrl(database, row) {
  if (!row.local_actor_id) return `${origin}/fediverse`
  const result = await database.query('SELECT username, public_id FROM actors WHERE id = $1', [row.local_actor_id])
  const account = result.rows[0]
  if (!account) return `${origin}/users/${encodeURIComponent(row.local_handle)}`
  return `${origin}${await profilePath(database, { username: account.username, publicId: String(account.public_id) })}`
}

function profileLink(href) {
  const label = href.replace(/^https?:\/\//, '')
  return `<a href="${href}" rel="me nofollow noopener noreferrer" target="_blank">${label}</a>`
}

// Shown as the profile field table in Mastodon and similar apps.
function channelProfileFields() {
  return [
    new PropertyValue({ name: 'Website', value: profileLink(origin) }),
    new PropertyValue({ name: 'Fediverse', value: profileLink(`${origin}/fediverse`) }),
  ]
}

async function actorIcon(database, row) {
  const result = await database.query(
    `SELECT local_actor.public_id,
            local_actor.federate_avatar IS NOT FALSE AND EXISTS (
              SELECT 1 FROM actor_avatars
               WHERE actor_avatars.actor_id = local_actor.id
                 AND actor_avatars.source = ANY (CASE local_actor.avatar_preference
                   WHEN 'custom' THEN ARRAY['upload'] WHEN 'gravatar' THEN ARRAY['gravatar', 'statica'] ELSE ARRAY['statica'] END)
            ) AS has_avatar,
            md5(node.brand_favicon) AS favicon_version, node.brand_favicon_type
       FROM nodes node
       LEFT JOIN actors local_actor ON local_actor.id = $2
      WHERE node.id = $1`,
    [row.node_id, row.local_actor_id || null],
  )
  const facts = result.rows[0]
  if (row.local_actor_id) {
    return facts?.public_id && facts.has_avatar
      ? new Image({ url: new URL(`${origin}/api/actors/${facts.public_id}/avatar`) })
      : null
  }
  return facts?.favicon_version
    ? new Image({ url: new URL(`${origin}/api/node-favicon?v=${facts.favicon_version}`), mediaType: facts.brand_favicon_type || null })
    : new Image({ url: new URL(`${origin}/icon-512.png`), mediaType: 'image/png' })
}

federation.setObjectDispatcher(Note, '/ap/objects/notes/{identifier}', async (_ctx, values) => {
  const identifier = values?.identifier
  if (!identifier) return null
  const database = getDatabase()
  const result = await database.query(
    `SELECT object.object_uri, object.raw_object, object.published_at, object.updated_at,
              object.reply_id, object.in_reply_to_uri, actor.is_local, reply.topic_id AS reply_topic_id, object_topic.slug, object_topic.page_number, revision.title, revision.body_markdown,
              reply.locale AS reply_locale, revision.locale AS revision_locale,
            coalesce(reply.body_markdown, revision.body_markdown, revision.title, '') AS content,
            coalesce(actor.actor_uri, '') AS actor_uri, ${topicTagLabelsSql('object_topic')}
       FROM federation_objects object
       LEFT JOIN federation_actors actor ON actor.id = object.actor_id
       LEFT JOIN actors local_actor ON local_actor.id = actor.local_actor_id
       LEFT JOIN nodes actor_node ON actor_node.id = actor.node_id
       LEFT JOIN replies reply ON reply.id = object.reply_id
       LEFT JOIN topics object_topic ON object_topic.id = object.topic_id
       LEFT JOIN LATERAL (
         SELECT current.revision_id
           FROM topic_current_revisions current
          WHERE current.topic_id = object.topic_id
          ORDER BY (current.locale = 'en') DESC, current.locale
          LIMIT 1
       ) current ON true
       LEFT JOIN revisions revision ON revision.id = current.revision_id
      WHERE object.object_uri = $1
        AND object.state = 'active'
        AND (object.reply_id IS NULL OR reply.status = 'published')
        AND (object.topic_id IS NULL OR object_topic.status IN ('published', 'unlisted'))
        AND (
          actor.is_local IS NOT TRUE
          OR (
            actor_node.federation_enabled = true
            AND actor_node.federation_mode IN ('open', 'outbound_only')
            AND (
              (actor.local_actor_id IS NULL AND actor.purpose IN (${channelSqlList()}))
              OR local_actor.federation_enabled = true
            )
          )
        )
      LIMIT 1`,
    [`${origin}/ap/objects/notes/${identifier}`],
  )
  const row = result.rows[0]
  if (!row) {
    const objectKind = identifier.startsWith('messages-') ? 'message' : identifier.startsWith('topics-') ? 'topic' : null
    const topicId = objectKind ? identifier.slice(objectKind === 'message' ? 'messages-'.length : 'topics-'.length) : null
    if (!topicId) return null
    const topic = await database.query(
      `SELECT topic.id, topic.slug, topic.page_number, revision.title, revision.body_markdown, revision.locale, ${topicTagLabelsSql('topic')},
              coalesce(CASE WHEN $2::text = 'topic' THEN feed_actor.actor_uri END, author_actor.actor_uri, '') AS actor_uri
         FROM topics topic
         JOIN nodes node ON node.id = topic.node_id
          AND node.federation_enabled = true
          AND node.federation_mode IN ('open', 'outbound_only')
         LEFT JOIN actors account ON account.id = topic.author_id
         JOIN LATERAL (
           SELECT current.revision_id
             FROM topic_current_revisions current
            WHERE current.topic_id = topic.id
            ORDER BY (current.locale = 'en') DESC, current.locale
            LIMIT 1
         ) current ON true
         JOIN revisions revision ON revision.id = current.revision_id
         LEFT JOIN federation_actors author_actor
           ON author_actor.local_actor_id = topic.author_id AND author_actor.is_local = true
         LEFT JOIN federation_actors feed_actor
           ON feed_actor.node_id = topic.node_id AND feed_actor.is_local = true AND feed_actor.purpose = 'hub'
        WHERE topic.id::text = $1 AND topic.status = 'published'
          AND ($2::text = 'topic' OR topic.kind = 'message')
          AND (topic.kind <> 'message' OR (topic.federation_outbound_mode = 'auto' AND account.federation_enabled = true))
        LIMIT 1`,
      [topicId, objectKind],
    )
    const topicRow = topic.rows[0]
    if (!topicRow) return null
    const hashtags = hashtagsFromLabels(topicRow.tag_labels)
    return new Note({
      id: new URL(`${origin}/ap/objects/notes/${identifier}`),
      content: new LanguageString(channelNoteHtml(topicRow) + hashtagHtml(hashtags), topicRow.locale || 'en'),
      attribution: topicRow.actor_uri ? new URL(topicRow.actor_uri) : null,
      url: new URL(pageUrl(topicRow)),
      tags: hashtagObjects(hashtags),
      to: PUBLIC_AUDIENCE,
    })
  }
  const isPage = row.is_local === true && !row.reply_id && row.slug
  // Replies written here: HTML (not Markdown) and their place in the thread.
  const isLocalReply = row.is_local === true && row.reply_id
  // Page tags, or the #words of a reply written here, as hashtags.
  const hashtags = isPage ? hashtagsFromLabels(row.tag_labels) : isLocalReply ? extractHashtags(row.content) : []
  const content = isPage
    ? channelNoteHtml(row) + hashtagHtml(hashtags)
    : isLocalReply ? linkHashtagsHtml(renderSafeMarkdown(row.content), hashtags) : row.content
  const locale = isPage ? row.revision_locale : isLocalReply ? row.reply_locale : null
  return new Note({
    id: new URL(row.object_uri),
    content: locale ? new LanguageString(content, locale) : content,
    tags: hashtagObjects(hashtags),
    url: isPage ? new URL(pageUrl(row)) : null,
    replyTarget: isLocalReply && row.in_reply_to_uri ? new URL(row.in_reply_to_uri) : null,
    attribution: row.actor_uri ? new URL(row.actor_uri) : null,
    to: isPage || isLocalReply ? PUBLIC_AUDIENCE : null,
  })
})

// Collection dispatchers get the identifier as a plain string (unlike object
// dispatchers, which get a values record).
federation.setOutboxDispatcher('/ap/actors/{identifier}/outbox', async (_ctx, identifier, cursor) => {
  if (!identifier) return null
  const database = getDatabase()
  await ensurePersonalOutboxActor(database, identifier)
  await ensureChannelOutboxObjects(database)
  const feed = await database.query(
    `SELECT feed.actor_uri, feed.purpose, topic.id, topic.slug, topic.page_number, topic.created_at,
            revision.title, revision.body_markdown, ${topicTagLabelsSql('topic')},
            coalesce(reply_stats.reply_count, 0) AS reply_count
       FROM federation_actors feed
       JOIN nodes ON nodes.id = feed.node_id
        AND nodes.federation_enabled = true
        AND nodes.federation_mode IN ('open', 'outbound_only')
       LEFT JOIN actors account ON account.id = feed.local_actor_id
       JOIN topics topic ON topic.node_id = feed.node_id AND topic.status = 'published'
       LEFT JOIN actors topic_author ON topic_author.id = topic.author_id
       JOIN LATERAL (
         SELECT current.revision_id
           FROM topic_current_revisions current
          WHERE current.topic_id = topic.id
          ORDER BY (current.locale = 'en') DESC, current.locale
          LIMIT 1
       ) current ON true
       JOIN revisions revision ON revision.id = current.revision_id
       LEFT JOIN LATERAL (
         SELECT count(*)::int AS reply_count FROM replies WHERE replies.topic_id = topic.id AND replies.status = 'published'
       ) reply_stats ON true
      WHERE feed.is_local = true
        AND (feed.local_handle = $1 OR feed.actor_uri = $2)
        AND (
          (feed.purpose IN ('hub', 'new', 'hot') AND topic.kind <> 'message')
          OR (feed.purpose = 'page' AND topic.kind IN ('article', 'page'))
          OR (feed.purpose = 'ask' AND topic.kind IN ('question', 'discussion') AND topic.federation_author_id IS NULL)
          OR (feed.purpose IN ('live', 'agents', 'humans')
            AND topic.kind = 'message' AND topic.federation_outbound_mode = 'auto'
            AND topic_author.federation_enabled = true
            AND (feed.purpose = 'live' OR (feed.purpose = 'agents' AND topic_author.kind = 'agent')
              OR (feed.purpose = 'humans' AND topic_author.kind = 'human')))
          OR (feed.purpose IN ('human', 'agent') AND topic.author_id = feed.local_actor_id
              AND account.federation_enabled = true
              AND topic.kind = 'message' AND topic.federation_outbound_mode = 'auto')
        )
      ORDER BY CASE WHEN feed.purpose = 'hot' THEN reply_stats.reply_count ELSE 0 END DESC, topic.created_at DESC
      LIMIT 21 OFFSET $3`,
    [identifier, `${origin}/ap/actors/${encodeURIComponent(identifier)}`, parseCursor(cursor)],
  )
  const actorUri = rowActorUri(feed.rows[0], identifier)
  if (!actorUri) return null
  const items = feed.rows.slice(0, 20).map(row => {
    const objectPrefix = ['human', 'agent', ...MESSAGE_CHANNELS].includes(row.purpose) ? 'messages-' : 'topics-'
    const objectUri = new URL(`${origin}/ap/objects/notes/${objectPrefix}${row.id}`)
    const hashtags = hashtagsFromLabels(row.tag_labels)
    const note = new Note({
      id: objectUri,
      content: channelNoteHtml(row) + hashtagHtml(hashtags),
      attribution: actorUri,
      url: new URL(pageUrl(row)),
      tags: hashtagObjects(hashtags),
      to: PUBLIC_AUDIENCE,
    })
    const activityId = new URL(`${origin}/ap/activities/feeds/${identifier}/${row.id}`)
    return BOOSTING_CHANNELS.includes(row.purpose)
      ? new Announce({ id: activityId, actor: actorUri, object: objectUri, to: PUBLIC_AUDIENCE })
      : new Create({ id: activityId, actor: actorUri, object: note, to: PUBLIC_AUDIENCE })
  })
  return { items, nextCursor: feed.rows.length > 20 ? String(parseCursor(cursor) + 20) : null }
})

async function ensurePersonalOutboxActor(database, identifier) {
  if (isChannelHandle(identifier)) return
  await database.query(
    `UPDATE federation_actors federated
        SET local_handle = actor.username,
            acct = actor.username || '@' || node.domain,
            display_name = coalesce(actor.agent_name, actor.display_name, actor.username),
            updated_at = now()
       FROM actors actor
       JOIN nodes node ON node.id = actor.node_id
      WHERE federated.local_actor_id = actor.id
        AND federated.is_local = true
        AND actor.username = $1`,
    [identifier],
  )
  await database.query(
    `INSERT INTO federation_actors
       (node_id, local_actor_id, actor_uri, actor_type, purpose, local_handle, acct, domain, display_name, is_local)
     SELECT actor.node_id, actor.id, $2, CASE WHEN actor.kind = 'agent' THEN 'service' ELSE 'person' END,
            actor.kind, actor.username, actor.username || '@' || node.domain, node.domain,
            coalesce(actor.agent_name, actor.display_name, actor.username), true
       FROM actors actor JOIN nodes node ON node.id = actor.node_id
      WHERE actor.username = $1 AND actor.kind IN ('human', 'agent')
        AND actor.username ~ '^[a-z0-9][a-z0-9_-]{2,31}$'
        AND actor.federation_enabled = true AND node.federation_enabled = true
      ON CONFLICT DO NOTHING`,
    [identifier, `${origin}/ap/actors/${encodeURIComponent(identifier)}`],
  )
  await database.query(
    `INSERT INTO federation_objects
       (object_uri, actor_id, object_type, topic_id, visibility, raw_object)
     SELECT $2 || '/ap/objects/notes/messages-' || topic.id, federation_actor.id,
            'note', topic.id, 'public', '{}'::jsonb
       FROM topics topic
       JOIN actors account ON account.id = topic.author_id
       JOIN federation_actors federation_actor
         ON federation_actor.local_actor_id = account.id AND federation_actor.is_local = true
      WHERE account.username = $1 AND topic.kind = 'message' AND topic.status = 'published'
        AND topic.federation_outbound_mode = 'auto'
      ON CONFLICT (object_uri) DO UPDATE SET actor_id = EXCLUDED.actor_id, topic_id = EXCLUDED.topic_id`,
    [identifier, origin],
  )
}

async function ensureChannelOutboxObjects(database) {
  await database.query(
    `INSERT INTO federation_objects
       (object_uri, actor_id, object_type, topic_id, visibility, raw_object)
     SELECT $1 || '/ap/objects/notes/topics-' || topic.id, feed_actor.id,
            'note', topic.id, 'public', '{}'::jsonb
       FROM topics topic
       JOIN nodes node ON node.id = topic.node_id
        AND node.federation_enabled = true
        AND node.federation_mode IN ('open', 'outbound_only')
       JOIN federation_actors feed_actor
         ON feed_actor.node_id = topic.node_id
        AND feed_actor.purpose = 'hub'
        AND feed_actor.is_local = true
       LEFT JOIN actors message_author ON message_author.id = topic.author_id
      WHERE topic.status = 'published'
        -- Public messages are their authors' own posts (messages-<id>), not @hub's.
        AND topic.kind <> 'message'
      ON CONFLICT (object_uri) DO NOTHING`,
    [origin],
  )
}

federation.setFollowersDispatcher('/ap/actors/{identifier}/followers', async (_ctx, identifier) => {
  if (!identifier) return null
  const database = getDatabase()
  const result = await database.query(
    `SELECT actor.id, actor.actor_uri,
            coalesce(json_agg(follow.remote_actor_uri) FILTER (WHERE follow.id IS NOT NULL), '[]'::json) AS followers
       FROM federation_actors actor
       JOIN nodes ON nodes.id = actor.node_id AND nodes.federation_enabled = true
       LEFT JOIN federation_follows follow
         ON follow.local_actor_id = actor.id AND follow.state = 'active'
      WHERE actor.is_local = true
        AND (actor.local_handle = $1 OR actor.actor_uri = $2)
      GROUP BY actor.id, actor.actor_uri`,
    [identifier, `${origin}/ap/actors/${encodeURIComponent(identifier)}`],
  )
  if (!result.rows[0]) return null
  return { items: (Array.isArray(result.rows[0].followers) ? result.rows[0].followers : []).map(value => new URL(value)) }
})

federation.setInboxDispatcher('/ap/actors/{identifier}/inbox', async () => ({ items: [] }))

// WebFinger handle -> the actor's stable identifier (the tail of its URI).
// After a rename the handle changes but the actor URI does not; WebFinger
// must point at that URI or servers reject the actor's posts as mismatched.
async function actorIdentifierForHandle(handle) {
  const database = getDatabase()
  const current = await database.query(
    `SELECT federation_actors.actor_uri
       FROM federation_actors
       JOIN nodes ON nodes.id = federation_actors.node_id AND nodes.federation_enabled = true
      WHERE federation_actors.is_local = true
        AND federation_actors.status = 'active'
        AND (lower(federation_actors.local_handle) = lower($1) OR federation_actors.actor_uri = $2)
        AND (federation_actors.local_actor_id IS NULL OR EXISTS (
          SELECT 1 FROM actors WHERE actors.id = federation_actors.local_actor_id
            AND actors.federation_enabled = true
            AND actors.username ~ '^[a-z0-9][a-z0-9_-]{2,31}$'
        ))
      ORDER BY (lower(federation_actors.local_handle) = lower($1)) DESC
      LIMIT 1`,
    [handle, `${origin}/ap/actors/${encodeURIComponent(handle)}`],
  )
  const actorUri = current.rows[0]?.actor_uri
  if (actorUri) return decodeURIComponent(actorUri.split('/ap/actors/')[1] || '') || null
  // An account that has not federated yet gets an actor at its username.
  const account = await database.query(
    `SELECT 1
       FROM actors
       JOIN nodes ON nodes.id = actors.node_id AND nodes.federation_enabled = true
      WHERE actors.username = $1 AND actors.federation_enabled = true
        AND actors.username ~ '^[a-z0-9][a-z0-9_-]{2,31}$'
      LIMIT 1`,
    [handle],
  )
  return account.rows[0] ? handle : null
}

federation.setInboxListeners('/ap/actors/{identifier}/inbox', '/ap/inbox')
  .withIdempotency('per-origin')
  .on(Create, (ctx, activity) => recordInboundActivity(ctx, activity))
  .on(Update, (ctx, activity) => recordInboundActivity(ctx, activity))
  .on(Delete, (ctx, activity) => recordInboundActivity(ctx, activity))
  .on(Follow, (ctx, activity) => recordInboundActivity(ctx, activity, () => handleInboundFollow(ctx, activity, getDatabase())))
  .on(Like, (ctx, activity) => recordInboundActivity(ctx, activity, () => applyInboundLike(getDatabase(), activity)))
  // Undo of a Follow or of a Like.
  .on(Undo, (ctx, activity) => recordInboundActivity(ctx, activity, async () => {
    const database = getDatabase()
    const unliked = await undoInboundLike(database, activity)
    if (!unliked.undone) await handleInboundUndo(activity, database)
  }))
  .on(Accept, (ctx, activity) => recordInboundActivity(ctx, activity))
  .on(Activity, recordInboundActivity)
  .onError(async (_ctx, error) => {
    console.error('[fedify] inbound activity failed', error)
  })

// Answers a post that mentioned @ask with the link to the question page it
// became. A failed reply is logged and never undoes the imported question.
async function acknowledgeAskQuestion(ctx, database, { topicId, objectUri, actorUri, remoteActorId, threadImport = false }) {
  // Show the page under the author's Fediverse name and avatar right away.
  if (remoteActorId) await refreshRemoteActor(database, ctx, { id: remoteActorId, actor_uri: actorUri }).catch(() => {})
  try {
    const node = await database.query(`SELECT federation_enabled, federation_mode FROM nodes WHERE is_home LIMIT 1`)
    if (!federationAllowsOutbound(currentFederationSettings(node.rows[0]))) return
    const topic = await database.query('SELECT slug, page_number FROM topics WHERE id = $1', [topicId])
    const row = topic.rows[0]
    if (!row) return
    const link = pageUrl(row)
    const remoteActor = await lookupRemote(ctx, new URL(actorUri), 'ask')
    if (!isActor(remoteActor) || !remoteActor.id || !remoteActor.inboxId) return
    const handle = `@${remoteActor.preferredUsername || 'user'}@${remoteActor.id.host}`
    const askUri = new URL(`${origin}/ap/actors/ask`)
    const note = new Note({
      id: new URL(`${origin}/ap/objects/notes/ask-reply-${topicId}`),
      attribution: askUri,
      replyTarget: new URL(objectUri),
      content: `<p><span class="h-card"><a href="${remoteActor.url?.href || remoteActor.id.href}" class="u-url mention">${escapeHtml(handle)}</a></span> ${threadImport ? 'Thread copied to AiKi' : 'Question published on AiKi'}: <a href="${link}">${link}</a></p>`,
      tags: [new Mention({ href: remoteActor.id, name: handle })],
      url: new URL(link),
      to: PUBLIC_AUDIENCE,
      cc: remoteActor.id,
    })
    const activity = new Create({
      id: new URL(`${origin}/ap/activities/ask-reply-${topicId}`),
      actor: askUri,
      object: note,
      to: PUBLIC_AUDIENCE,
      cc: remoteActor.id,
    })
    await ctx.sendActivity({ identifier: 'ask' }, [remoteActor], activity)
    // @ask also boosts the post it was mentioned in: its followers see the
    // question (or the thread request) and the author is notified.
    const followers = await database.query(
      `SELECT follow.remote_actor_uri FROM federation_follows follow
         JOIN federation_actors ask ON ask.id = follow.local_actor_id AND ask.is_local = true AND ask.purpose = 'ask'
        WHERE follow.state = 'active'`,
    )
    const boostRecipients = [remoteActor]
    for (const { remote_actor_uri: uri } of followers.rows) {
      if (uri === remoteActor.id.href) continue
      try {
        const follower = await lookupRemote(ctx, new URL(uri), 'ask')
        if (isActor(follower) && follower.id && follower.inboxId) boostRecipients.push(follower)
      } catch {}
    }
    await ctx.sendActivity({ identifier: 'ask' }, boostRecipients, new Announce({
      id: new URL(`${origin}/ap/activities/ask-boost-${topicId}-${createHash('sha256').update(objectUri).digest('hex').slice(0, 16)}`),
      actor: askUri,
      object: new URL(objectUri),
      to: PUBLIC_AUDIENCE,
      ccs: [remoteActor.id, new URL(`${askUri.href}/followers`)],
    }))
  } catch (error) {
    console.error('[fedify] @ask acknowledgement failed', error instanceof Error ? error.message : error)
  }
}

async function recordInboundActivity(ctx, activity, customProcessor = null) {
  const activityUri = activity?.id?.toString()
  if (!activityUri) return
  const raw = typeof activity.toJsonLd === 'function' ? await activity.toJsonLd() : {}
  const database = getDatabase()
  const node = await database.query(`SELECT federation_enabled, federation_mode FROM nodes WHERE is_home LIMIT 1`)
  if (!federationAllowsInbound(currentFederationSettings(node.rows[0]))) {
    await database.query(
      `INSERT INTO federation_activities (activity_uri, direction, activity_type, processing_state, raw_activity, processed_at)
       VALUES ($1, 'inbound', $2, 'ignored', $3::jsonb, now())
       ON CONFLICT (activity_uri) DO NOTHING`,
      [activityUri, activityType(activity), JSON.stringify(raw)],
    )
    return
  }
  const inserted = await database.query(
    `INSERT INTO federation_activities (activity_uri, direction, activity_type, processing_state, raw_activity, processed_at)
     VALUES ($1, 'inbound', $2, 'received', $3::jsonb, NULL)
     ON CONFLICT (activity_uri) DO UPDATE
       SET processing_state = 'received', processed_at = NULL, last_error = NULL
     WHERE federation_activities.processing_state = 'failed'
        OR (federation_activities.processing_state = 'received'
            AND federation_activities.received_at < now() - interval '10 minutes')
     RETURNING id`,
    [activityUri, activityType(activity), JSON.stringify(raw)],
  )
  if (!inserted.rows[0]) return
  try {
    if (customProcessor) await customProcessor()
    if (activity instanceof Create) {
      const created = await ingestInboundCreate(database, activity, { context: ctx })
      if (created?.question) await acknowledgeAskQuestion(ctx, database, created)
    }
    if (activity instanceof Update) await applyInboundUpdate(database, activity)
    if (activity instanceof Delete) await applyInboundDelete(database, activity)
    await database.query(`UPDATE federation_activities SET processing_state = 'processed', processed_at = now() WHERE id = $1`, [inserted.rows[0].id])
  } catch (error) {
    await database.query(`UPDATE federation_activities SET processing_state = 'failed', attempts = attempts + 1, last_error = $2 WHERE id = $1`, [inserted.rows[0].id, String(error?.message || error).slice(0, 1000)])
    throw error
  }
}

const PUBLIC_AUDIENCE = new URL('https://www.w3.org/ns/activitystreams#Public')

function parseCursor(cursor) {
  const offset = Number.parseInt(String(cursor || '0'), 10)
  return Number.isFinite(offset) && offset >= 0 ? Math.min(offset, 100_000) : 0
}

function rowActorUri(row, identifier) {
  try { return new URL(row?.actor_uri || `${origin}/ap/actors/${encodeURIComponent(identifier)}`) } catch { return null }
}

function activityType(activity) {
  const candidate = String(activity?.constructor?.name || '').toLowerCase()
  return ['create', 'update', 'delete', 'undo', 'announce', 'follow', 'accept', 'reject', 'like'].includes(candidate) ? candidate : 'other'
}

async function loadSigningKeys() {
  const configured = readFederationKeyPayload()
  if (configured.value) {
    try {
      const parsed = JSON.parse(configured.value)
      const rsa = parsed.rsa || parsed.httpSignature || parsed
      const privateJwk = normalizeRsaJwk(rsa.privateKeyJwk || rsa.private || rsa, 'private')
      const publicJwk = normalizeRsaJwk(rsa.publicKeyJwk || rsa.public || derivePublicJwk(privateJwk), 'public')
      const edSource = parsed.ed25519 || parsed.objectIntegrity || null
      const ed = edSource ? {
        privateKey: await importJwk(edSource.privateKeyJwk || edSource.private || edSource, 'private'),
        publicKey: await importJwk(edSource.publicKeyJwk || edSource.public || derivePublicJwk(edSource.privateKeyJwk || edSource.private || edSource), 'public'),
      } : null
      return { rsa: { privateKey: await importJwk(privateJwk, 'private'), publicKey: await importJwk(publicJwk, 'public') }, ed }
    } catch (error) {
      throw new Error(`Federation signing key is invalid: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
  if (process.env.NODE_ENV === 'production') {
    console.error('[fedify] Federation signing key is missing; federation remains fail-closed until the instance is enabled by an administrator.')
    return {
      rsa: await generateCryptoKeyPair('RSASSA-PKCS1-v1_5'),
      ed: await generateCryptoKeyPair('Ed25519'),
      ephemeral: true,
    }
  }
  console.warn('[fedify] Federation signing key is not configured; generated development key will change on restart.')
  return { rsa: await generateCryptoKeyPair('RSASSA-PKCS1-v1_5'), ed: await generateCryptoKeyPair('Ed25519') }
}

function derivePublicJwk(privateJwk) {
  if (!privateJwk || privateJwk.kty !== 'RSA' || !privateJwk.n || !privateJwk.e) throw new Error('Provide both publicKeyJwk and privateKeyJwk.')
  return { kty: privateJwk.kty, n: privateJwk.n, e: privateJwk.e, alg: privateJwk.alg || 'RS256', key_ops: ['verify'], ext: true }
}

function normalizeRsaJwk(jwk, type) {
  if (!jwk || jwk.kty !== 'RSA') return jwk
  return { ...jwk, alg: jwk.alg || 'RS256', key_ops: jwk.key_ops || (type === 'public' ? ['verify'] : ['sign']), ext: jwk.ext ?? true }
}

// Inbound activities that failed after Fedify gave up are replayed from the
// stored JSON (its HTTP signature was verified when it arrived), so a bug
// fixed later does not lose a reply or a question for good.
export async function retryFailedInboundActivities(database, { limit = 5, maxAttempts = 20 } = {}) {
  // A post deleted on its server after its Create failed stays deleted.
  await database.query(
    `UPDATE federation_activities failed
        SET processing_state = 'ignored', processed_at = now(), last_error = 'deleted before it could be processed'
      WHERE failed.direction = 'inbound' AND failed.processing_state = 'failed' AND failed.activity_type = 'create'
        AND EXISTS (
          SELECT 1 FROM federation_activities deletion
           WHERE deletion.direction = 'inbound' AND deletion.activity_type = 'delete'
             AND coalesce(deletion.raw_activity->'object'->>'id', deletion.raw_activity->>'object')
               = coalesce(failed.raw_activity->'object'->>'id', failed.raw_activity->>'object')
        )`,
  )
  const failed = await database.query(
    `SELECT id, raw_activity FROM federation_activities
      WHERE direction = 'inbound' AND processing_state = 'failed'
        AND attempts < $2 AND received_at > now() - interval '3 days'
      ORDER BY received_at
      LIMIT $1`,
    [limit, maxAttempts],
  )
  if (!failed.rows.length) return 0
  const ctx = federation.createContext(new URL(origin), {})
  for (const row of failed.rows) {
    let activity
    try {
      activity = await Activity.fromJsonLd(row.raw_activity, { documentLoader: ctx.documentLoader, contextLoader: ctx.contextLoader })
    } catch (error) {
      await database.query(
        `UPDATE federation_activities SET attempts = attempts + 1, last_error = $2 WHERE id = $1`,
        [row.id, String(error?.message || error).slice(0, 1000)],
      ).catch(() => {})
      continue
    }
    // recordInboundActivity records its own failure and attempt count.
    await recordInboundActivity(ctx, activity).catch(() => {})
  }
  return failed.rows.length
}

export async function reloadFederationSigningKeys() {
  keysPromise = loadSigningKeys()
  return keysPromise
}

export default federation
export { federation }
