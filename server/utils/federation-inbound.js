import sanitizeHtml from 'sanitize-html'
import { notifyReply } from './notifications.js'
import { htmlToPlainText, shortTitle, stripLeadingMentions } from './fediverse-text.js'
import { importMastodonThread, parseMastodonStatusUrl } from './federation-import.js'
import { randomUUID } from 'node:crypto'

const PUBLIC_AUDIENCE = 'https://www.w3.org/ns/activitystreams#Public'

export async function ingestInboundCreate(database, activity, { context = null } = {}) {
  const object = await readActivityObject(activity)
  if (!object || !isPublicObject(object)) return { imported: false, reason: 'not_public_note' }

  const objectUri = toUrlString(object.id)
  const replyTargetUri = toUrlString(object.replyTargetId)
  const actorUri = toUrlString(object.attributionId || activity.actorId)
  if (!objectUri || !actorUri) return { imported: false, reason: 'missing_provenance' }

  if (!replyTargetUri) return ingestInboundAsk(database, object, { objectUri, actorUri })

  const target = await database.query(
    `SELECT COALESCE(source_object.topic_id, source_reply.topic_id) AS topic_id,
            source_object.reply_id AS parent_reply_id,
            topic.discussion_enabled, topic.accept_replies
       FROM federation_objects source_object
       LEFT JOIN replies source_reply ON source_reply.id = source_object.reply_id
       LEFT JOIN topics topic ON topic.id = COALESCE(source_object.topic_id, source_reply.topic_id)
      WHERE source_object.object_uri = $1 AND topic.status = 'published'
      LIMIT 1`,
    [replyTargetUri],
  )
  let targetRow = target.rows[0]
  if (!targetRow?.topic_id) {
    // A reply that mentions @ask asks us to copy the whole thread.
    if (await isAddressedToAsk(database, object)) return ingestAskThread(database, object, { objectUri, actorUri })
    targetRow = await backfillInboundParent(database, context, replyTargetUri)
    if (!targetRow) return { imported: false, reason: 'unknown_reply_target' }
  }
  return ingestInboundReply(database, object, { objectUri, actorUri, replyTargetUri, targetRow })
}

async function ingestInboundReply(database, object, { objectUri, actorUri, replyTargetUri, targetRow }) {
  if (targetRow.discussion_enabled === false || targetRow.accept_replies === false) return { imported: false, reason: 'replies_disabled' }

  const existing = await database.query('SELECT id FROM federation_objects WHERE object_uri = $1 LIMIT 1', [objectUri])
  if (existing.rows[0]) return { imported: false, reason: 'duplicate' }

  const actor = await upsertRemoteActor(database, actorUri)
  // Mastodon's automatic mentions of the branch are dropped from replies.
  const content = stripLeadingMentions(htmlToText(object.content))
  if (!content) return { imported: false, reason: 'empty_content' }
  // The federated post language (contentMap) becomes the reply locale so
  // translators and re-federation keep the original language.
  const replyLocale = object.content?.locale?.toString() || null
  const locale = replyLocale && ['en', 'zh', 'ru', 'es', 'ja', 'de', 'fr', 'ar'].includes(replyLocale) ? replyLocale : 'en'

  const client = await database.connect()
  try {
    await client.query('BEGIN')
    const reply = await client.query(
      `INSERT INTO replies (topic_id, parent_reply_id, author_id, federation_author_id, locale,
                            body_markdown, status, federation_object_uri, federation_source_url)
         VALUES ($1, $2, NULL, $3, $7, $4, 'published', $5, $6)
       ON CONFLICT (federation_object_uri) WHERE federation_object_uri IS NOT NULL DO NOTHING
       RETURNING id`,
        [targetRow.topic_id, targetRow.parent_reply_id || null, actor.id, content, objectUri, safeExternalUrl(object.url), locale],
    )
    const replyId = reply.rows[0]?.id || null
    if (replyId) {
      await client.query(
        `INSERT INTO federation_objects (object_uri, actor_id, object_type, reply_id, in_reply_to_uri,
                                         visibility, content_hash, published_at, raw_object)
         VALUES ($1, $2, 'note', $3, $4, 'public', md5($5), $6, $7::jsonb)
         ON CONFLICT (object_uri) DO NOTHING`,
        [objectUri, actor.id, replyId, replyTargetUri, content, toDate(object.published), JSON.stringify({
          id: objectUri,
          type: 'Note',
          actor: actorUri,
          inReplyTo: replyTargetUri,
          content,
          url: safeExternalUrl(object.url),
        })],
      )
    }
    // Tell the author being answered (a person or an agent) about the reply.
    if (replyId) await notifyReply(client, { topicId: targetRow.topic_id, replyId, authorId: null, parentReplyId: targetRow.parent_reply_id || null })
    await client.query('COMMIT')
    return { imported: Boolean(replyId), topicId: targetRow.topic_id, replyId }
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
}

async function backfillInboundParent(database, context, replyTargetUri) {
  if (!context?.lookupObject) return null
  let parent
  try {
    parent = await context.lookupObject(replyTargetUri)
  } catch {
    return null
  }
  if (!parent || !isPublicObject(parent)) return null
  const objectUri = toUrlString(parent.id) || replyTargetUri
  const actorUri = toUrlString(parent.attributionId)
  const content = htmlToText(parent.content)
  if (!objectUri || !actorUri || !content) return null

  const existing = await database.query(
    `SELECT object.topic_id, object.reply_id, topic.discussion_enabled, topic.accept_replies
       FROM federation_objects object
       LEFT JOIN topics topic ON topic.id = object.topic_id
      WHERE object.object_uri = $1 AND object.state = 'active' AND topic.status = 'published'
      LIMIT 1`,
    [objectUri],
  )
  if (existing.rows[0]?.topic_id) {
    return {
      topic_id: existing.rows[0].topic_id,
      parent_reply_id: existing.rows[0].reply_id || null,
      discussion_enabled: existing.rows[0].discussion_enabled !== false,
      accept_replies: existing.rows[0].accept_replies !== false,
    }
  }

  const node = await database.query('SELECT id FROM nodes WHERE is_home LIMIT 1')
  if (!node.rows[0]) return null
  const actor = await upsertRemoteActor(database, actorUri)
  const raw = typeof parent.toJsonLd === 'function' ? await parent.toJsonLd() : {
    id: objectUri,
    type: 'Note',
    actor: actorUri,
    content,
    url: safeExternalUrl(parent.url),
  }
  const client = await database.connect()
  try {
    await client.query('BEGIN')
    const slug = await uniqueQuestionSlug(client).then(value => value.replace('fediverse-question-', 'fediverse-thread-'))
    const topic = await client.query(
      `INSERT INTO topics
         (node_id, author_id, slug, kind, status, summary, hide_author, federation_author_id)
       VALUES ($1, NULL, $2, 'discussion', 'published', $3, NULL, $4)
       RETURNING id`,
      [node.rows[0].id, slug, null, actor.id],
    )
    const topicId = topic.rows[0].id
    const revision = await client.query(
      `INSERT INTO revisions (topic_id, author_id, locale, title, body_markdown, summary)
       VALUES ($1, NULL, 'en', $2, $3, $4) RETURNING id`,
      [topicId, titleForInboundQuestion(content), content, null],
    )
    await client.query('INSERT INTO topic_current_revisions (topic_id, locale, revision_id) VALUES ($1, \'en\', $2)', [topicId, revision.rows[0].id])
    await client.query('INSERT INTO page_read_counts (topic_id) VALUES ($1) ON CONFLICT DO NOTHING', [topicId])
    await client.query(
      `INSERT INTO federation_objects
         (object_uri, actor_id, object_type, topic_id, visibility, content_hash, published_at, raw_object)
       VALUES ($1, $2, 'note', $3, 'public', md5($4), $5, $6::jsonb)
       ON CONFLICT (object_uri) DO NOTHING`,
      [objectUri, actor.id, topicId, content, toDate(parent.published), JSON.stringify(raw)],
    )
    await client.query('COMMIT')
    return { topic_id: topicId, parent_reply_id: null, discussion_enabled: true, accept_replies: true }
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
}

async function ingestInboundAsk(database, object, { objectUri, actorUri }) {
  const addressed = await database.query(
    `SELECT ask.actor_uri, ask.node_id
       FROM federation_actors ask
       JOIN nodes node ON node.id = ask.node_id AND node.federation_enabled = true
      WHERE ask.is_local = true AND ask.purpose = 'ask' AND ask.status = 'active'
        AND ask.actor_uri = ANY($1::text[])
      LIMIT 1`,
    [[...new Set([
      ...idStrings(object?.toIds),
      ...idStrings(object?.ccIds),
      ...idStrings(object?.audienceIds),
      ...idStrings(object?.tagIds),
    ])]],
  )
  if (!addressed.rows[0]) return { imported: false, reason: 'unknown_reply_target' }
  const existing = await database.query('SELECT id FROM federation_objects WHERE object_uri = $1 LIMIT 1', [objectUri])
  if (existing.rows[0]) return { imported: false, reason: 'duplicate' }
  const content = htmlToText(object.content)
  // A post that only mentions accounts has nothing to ask.
  if (!content || !withoutMentions(content)) return { imported: false, reason: 'empty_content' }
  const remote = await upsertRemoteActor(database, actorUri)
  const client = await database.connect()
  try {
    await client.query('BEGIN')
    const slug = await uniqueQuestionSlug(client)
    const title = titleForInboundQuestion(content)
    const topic = await client.query(
      `INSERT INTO topics
         (node_id, author_id, slug, kind, status, summary, hide_author, federation_author_id)
       VALUES ($1, NULL, $2, 'question', 'published', $3, NULL, $4)
       RETURNING id`,
      [addressed.rows[0].node_id, slug, null, remote.id],
    )
    const topicId = topic.rows[0].id
    const revision = await client.query(
      `INSERT INTO revisions (topic_id, author_id, locale, title, body_markdown)
       VALUES ($1, NULL, 'en', $2, $3) RETURNING id`,
      [topicId, title, content],
    )
    await client.query('INSERT INTO topic_current_revisions (topic_id, locale, revision_id) VALUES ($1, \'en\', $2)', [topicId, revision.rows[0].id])
    await client.query('INSERT INTO page_read_counts (topic_id) VALUES ($1) ON CONFLICT DO NOTHING', [topicId])
    await client.query(
      `INSERT INTO federation_objects
         (object_uri, actor_id, object_type, topic_id, visibility, content_hash, published_at, raw_object)
       VALUES ($1, $2, 'question', $3, 'public', md5($4), $5, $6::jsonb)`,
      [objectUri, remote.id, topicId, content, toDate(object.published), JSON.stringify({ id: objectUri, type: 'Note', actor: actorUri, content })],
    )
    // Follow the thread from now on, like a thread copied with @ask (only
    // for servers with the Mastodon API, which the sync reads).
    const statusUrl = [safeExternalUrl(object.url), objectUri].find(url => url && parseMastodonStatusUrl(url).ok)
    if (statusUrl) {
      const followed = await client.query(
        `INSERT INTO federation_imports (node_id, requested_url, canonical_root_uri, created_by, status, started_at, completed_at, last_synced_at, topic_id, total_seen, public_imported)
         VALUES ($1, $2, $3, NULL, 'complete', now(), now(), now(), $4, 1, 1)
         ON CONFLICT DO NOTHING
         RETURNING id`,
        [addressed.rows[0].node_id, parseMastodonStatusUrl(statusUrl).value.url, objectUri, topicId],
      )
      if (followed.rows[0]) await client.query('UPDATE topics SET federation_import_id = $2 WHERE id = $1', [topicId, followed.rows[0].id])
    }
    await client.query('COMMIT')
    return { imported: true, topicId, question: true, objectUri, actorUri, remoteActorId: remote.id }
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally { client.release() }
}

export function withoutMentions(text) {
  return String(text || '').replace(/(^|\s)@[\w.-]+(?:@[\w.-]+\.[a-z]{2,})?/giu, ' ').replace(/\s+/g, ' ').trim()
}

const ASK_IMPORT_LIMIT = 5
const ASK_IMPORT_WINDOW_MS = 60 * 60_000
const askImportsByActor = new Map()

function allowAskImport(actorUri) {
  const now = Date.now()
  const recent = (askImportsByActor.get(actorUri) || []).filter(time => now - time < ASK_IMPORT_WINDOW_MS)
  if (recent.length >= ASK_IMPORT_LIMIT) return false
  recent.push(now)
  if (askImportsByActor.size > 5000) askImportsByActor.clear()
  askImportsByActor.set(actorUri, recent)
  return true
}

// Copies the public thread the mentioning reply belongs to (ancestors, the
// reply and later public replies) into one discussion page. A thread copied
// before is refreshed instead of duplicated. Servers without the Mastodon
// API fall back to a question page from the post text, when it has any.
async function ingestAskThread(database, object, { objectUri, actorUri }) {
  const node = await database.query(
    `SELECT ask.node_id FROM federation_actors ask
       JOIN nodes node ON node.id = ask.node_id AND node.federation_enabled = true
      WHERE ask.is_local = true AND ask.purpose = 'ask' AND ask.status = 'active'
      LIMIT 1`,
  )
  const nodeId = node.rows[0]?.node_id
  if (!nodeId) return { imported: false, reason: 'federation_disabled' }
  const statusUrl = [safeExternalUrl(object.url), objectUri].find(url => url && parseMastodonStatusUrl(url).ok)
  if (statusUrl && allowAskImport(actorUri)) {
    try {
      const result = await importMastodonThread(database, { nodeId, actorId: null, url: statusUrl, forceSync: true })
      if (result?.topicId) {
        const remote = await upsertRemoteActor(database, actorUri)
        return { imported: true, topicId: result.topicId, question: true, threadImport: true, objectUri, actorUri, remoteActorId: remote.id }
      }
    } catch (error) {
      console.error('[fedify] @ask thread import failed', error instanceof Error ? error.message : error)
    }
  }
  return ingestInboundAsk(database, object, { objectUri, actorUri })
}

async function isAddressedToAsk(database, object) {
  const addresses = [...new Set([
    ...idStrings(object?.toIds),
    ...idStrings(object?.ccIds),
    ...idStrings(object?.audienceIds),
    ...idStrings(object?.tagIds),
  ])]
  if (!addresses.length) return false
  const result = await database.query(
    `SELECT 1
       FROM federation_actors ask
       JOIN nodes node ON node.id = ask.node_id AND node.federation_enabled = true
      WHERE ask.is_local = true AND ask.purpose = 'ask' AND ask.status = 'active'
        AND ask.actor_uri = ANY($1::text[])
      LIMIT 1`,
    [addresses],
  )
  return Boolean(result.rows[0])
}

export async function applyInboundUpdate(database, activity) {
  const object = await readActivityObject(activity)
  const objectUri = toUrlString(object?.id || activity?.objectId)
  const actorUri = toUrlString(activity?.actorId || object?.attributionId)
  if (!objectUri || !actorUri) return { updated: false, reason: 'missing_provenance' }
  const content = htmlToText(object?.content)
  if (!content) return { updated: false, reason: 'empty_content' }
  const result = await database.query(
    `UPDATE federation_objects fo
        SET content_hash = md5($3), updated_at = now(), raw_object = $4::jsonb
      FROM federation_actors actor, replies reply
     WHERE fo.object_uri = $1 AND fo.actor_id = actor.id AND fo.reply_id = reply.id
       AND actor.actor_uri = $2 AND actor.is_local = false
     RETURNING reply.id AS reply_id, fo.topic_id`,
    [objectUri, actorUri, content, JSON.stringify({ id: objectUri, type: 'Note', actor: actorUri, content })],
  )
  if (!result.rows[0]) return { updated: false, reason: 'unknown_object' }
  if (result.rows[0].reply_id) {
    await database.query(`UPDATE replies SET body_markdown = $2, updated_at = now() WHERE id = $1`, [result.rows[0].reply_id, content])
    return { updated: true, replyId: result.rows[0].reply_id }
  }
  if (result.rows[0].topic_id) {
    const current = await database.query(
      `SELECT current.revision_id, current.locale, revision.title, revision.summary
         FROM topic_current_revisions current
         JOIN revisions revision ON revision.id = current.revision_id
        WHERE current.topic_id = $1
        ORDER BY (current.locale = 'en') DESC, current.locale
        LIMIT 1`,
      [result.rows[0].topic_id],
    )
    if (current.rows[0]) {
      const revision = current.rows[0]
      const next = await database.query(
        `INSERT INTO revisions (topic_id, parent_revision_id, author_id, locale, title, body_markdown, summary)
         VALUES ($1, $2, NULL, $3, $4, $5, $6)
         RETURNING id`,
        [result.rows[0].topic_id, revision.revision_id, revision.locale, typeof object?.name === 'string' ? object.name : revision.title, content, revision.summary],
      )
      await database.query(
        `UPDATE topic_current_revisions SET revision_id = $2 WHERE topic_id = $1 AND locale = $3`,
        [result.rows[0].topic_id, next.rows[0].id, revision.locale],
      )
    }
  }
  return { updated: true, topicId: result.rows[0].topic_id || null }
}

export async function applyInboundDelete(database, activity) {
  const objectUri = toUrlString(activity?.objectId)
  const actorUri = toUrlString(activity?.actorId)
  if (!objectUri || !actorUri) return { deleted: false, reason: 'missing_provenance' }
  const result = await database.query(
    `UPDATE federation_objects fo
        SET state = 'deleted', updated_at = now()
      FROM federation_actors actor
     WHERE fo.object_uri = $1 AND fo.actor_id = actor.id
       AND actor.actor_uri = $2 AND actor.is_local = false
     RETURNING fo.reply_id, fo.topic_id`,
    [objectUri, actorUri],
  )
  if (!result.rows[0]) {
    // A Delete can arrive before (or instead of) its Create, e.g. when the
    // Create failed and is replayed later. Remember the deletion so the post
    // is never created afterwards. Only the author's own server may do this,
    // and an account deletion (object = actor) is not a post.
    if (objectUri !== actorUri && hostname(objectUri) && hostname(objectUri) === hostname(actorUri)) {
      const remote = await upsertRemoteActor(database, actorUri)
      await database.query(
        `INSERT INTO federation_objects (object_uri, actor_id, object_type, visibility, state, raw_object)
         VALUES ($1, $2, 'tombstone', 'unknown', 'deleted', '{}'::jsonb)
         ON CONFLICT (object_uri) DO NOTHING`,
        [objectUri, remote.id],
      )
    }
    return { deleted: false, reason: 'unknown_object' }
  }
  if (result.rows[0].reply_id) {
    await database.query(`UPDATE replies SET status = 'deleted', updated_at = now() WHERE id = $1`, [result.rows[0].reply_id])
  }
  if (result.rows[0].topic_id) {
    await database.query(`UPDATE topics SET status = 'deleted', updated_at = now() WHERE id = $1`, [result.rows[0].topic_id])
  }
  return { deleted: true, replyId: result.rows[0].reply_id || null, topicId: result.rows[0].topic_id || null }
}

async function readActivityObject(activity) {
  if (activity?.object && typeof activity.object === 'object' && !(activity.object instanceof URL)) return activity.object
  if (typeof activity?.getObject === 'function') {
    try { return await activity.getObject({ suppressError: true }) } catch { return null }
  }
  return null
}

function isPublicObject(object) {
  const addresses = [
    ...(Array.isArray(object?.toIds) ? object.toIds : []),
    ...(Array.isArray(object?.ccIds) ? object.ccIds : []),
    ...(Array.isArray(object?.audienceIds) ? object.audienceIds : []),
  ].map(toUrlString)
  return addresses.includes(PUBLIC_AUDIENCE) || addresses.includes('as:Public') || addresses.includes('Public')
}

function idStrings(values) {
  return (Array.isArray(values) ? values : []).map(toUrlString).filter(Boolean)
}

async function uniqueQuestionSlug(client) {
  const base = `fediverse-question-${randomUUID().slice(0, 12)}`
  const result = await client.query('SELECT 1 FROM topics WHERE slug = $1 LIMIT 1', [base])
  return result.rows[0] ? `${base}-${randomUUID().slice(0, 6)}` : base
}

function titleForInboundQuestion(content) {
  return shortTitle(withoutMentions(content) || content, 'Fediverse question')
}

async function upsertRemoteActor(database, actorUri) {
  const result = await database.query(
    `INSERT INTO federation_actors (actor_uri, actor_type, purpose, acct, domain, display_name, status, is_local, raw_actor, last_fetched_at)
     VALUES ($1, 'person', 'remote', NULL, $2, $3, 'active', false, $4::jsonb, now())
     ON CONFLICT (actor_uri) DO UPDATE SET domain = EXCLUDED.domain, last_fetched_at = now(), updated_at = now()
     RETURNING id`,
    [actorUri, hostname(actorUri), actorUri, JSON.stringify({ actorUri })],
  )
  return result.rows[0]
}

function toUrlString(value) {
  if (!value) return null
  try { return new URL(String(value)).toString() } catch { return null }
}

function safeExternalUrl(value) {
  const url = toUrlString(value)
  return url && /^https:\/\//i.test(url) ? url : null
}

function hostname(value) {
  try { return new URL(value).hostname } catch { return null }
}

// Fedify returns dates as Temporal.Instant, whose valueOf() throws, so
// new Date(instant) must not be used directly.
export function toDate(value) {
  if (!value) return null
  const date = typeof value?.epochMilliseconds === 'number'
    ? new Date(value.epochMilliseconds)
    : new Date(typeof value === 'object' && !(value instanceof Date) ? String(value) : value)
  return Number.isNaN(date.getTime()) ? null : date
}

function htmlToText(value) {
  return htmlToPlainText(value)
}

const LOCAL_NOTE = /\/ap\/objects\/notes\/(topics|messages|replies)-([0-9a-f-]{36})(?:-anon)?$/i

// Which page or reply a liked object is: our own notes by their URI, other
// objects through the federation ledger (e.g. imported posts).
async function likeTarget(database, objectUri) {
  const local = LOCAL_NOTE.exec(objectUri)
  if (local) return { type: local[1].toLowerCase() === 'replies' ? 'reply' : 'topic', id: local[2] }
  const result = await database.query(
    `SELECT topic_id, reply_id FROM federation_objects WHERE object_uri = $1 AND state = 'active' LIMIT 1`,
    [objectUri],
  )
  const row = result.rows[0]
  if (row?.reply_id) return { type: 'reply', id: row.reply_id }
  if (row?.topic_id) return { type: 'topic', id: row.topic_id }
  return null
}

// A Fediverse like counts as an upvote for the page or reply it is about.
export async function applyInboundLike(database, like) {
  const activityUri = toUrlString(like?.id)
  const actorUri = toUrlString(like?.actorId)
  const objectUri = toUrlString(like?.objectId)
  if (!activityUri || !actorUri || !objectUri) return { liked: false, reason: 'missing_provenance' }
  const target = await likeTarget(database, objectUri)
  if (!target) return { liked: false, reason: 'unknown_object' }
  const exists = await database.query(
    target.type === 'reply'
      ? `SELECT 1 FROM replies WHERE id = $1 AND status = 'published'`
      : `SELECT 1 FROM topics WHERE id = $1 AND status IN ('published', 'unlisted')`,
    [target.id],
  )
  if (!exists.rows[0]) return { liked: false, reason: 'unknown_object' }
  const remote = await upsertRemoteActor(database, actorUri)
  await database.query(
    `INSERT INTO federation_likes (activity_uri, remote_actor_id, target_type, target_id, object_uri)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT DO NOTHING`,
    [activityUri, remote.id, target.type, target.id, objectUri],
  )
  return { liked: true, target }
}

export async function undoInboundLike(database, undo) {
  const actorUri = toUrlString(undo?.actorId)
  const likeUri = toUrlString(undo?.objectId)
  if (!actorUri || !likeUri) return { undone: false }
  const result = await database.query(
    `DELETE FROM federation_likes likes
      USING federation_actors actor
      WHERE likes.remote_actor_id = actor.id AND actor.actor_uri = $1 AND likes.activity_uri = $2
      RETURNING likes.id`,
    [actorUri, likeUri],
  )
  return { undone: Boolean(result.rows[0]) }
}

