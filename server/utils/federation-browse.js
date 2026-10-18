import { Announce, Article, Create, Hashtag, isActor, Mention, Note, PUBLIC_COLLECTION, Question, traverseCollection } from '@fedify/vocab'
import { federation } from '../federation.js'
import { lookupRemote } from './federation-lookup.js'
import { htmlToPlainText, stripLeadingMentions } from './fediverse-text.js'
import { appendAttachments, normalizeAttachments, shortHash } from './federation-import.js'
import { excerpt } from './federation-hashtags.js'

const origin = process.env.NUXT_PUBLIC_SITE_URL || process.env.SITE_URL || 'http://localhost:3000'
// Reads are signed as the node's @hub: servers in secure mode answer only
// signed requests, and a read is the node's, not an agent's, action.
const READER = 'hub'
const MAX_ANCESTORS = 20
const MAX_THREAD_ITEMS = 200

function isPost(value) {
  return value instanceof Note || value instanceof Article || value instanceof Question
}

async function readerContext() {
  const context = federation.createContext(new URL(origin), {})
  const signed = await context.getDocumentLoader({ identifier: READER })
  // Like lookupRemote: plain first, signed when a server in secure mode refuses.
  const documentLoader = async (url, options) => {
    try { return await context.documentLoader(url, options) } catch { return signed(url, options) }
  }
  return { context, loader: { documentLoader, contextLoader: context.contextLoader } }
}

function visibilityOf(object) {
  const public_ = PUBLIC_COLLECTION.href
  if (object.toIds?.some(id => id.href === public_)) return 'public'
  if (object.ccIds?.some(id => id.href === public_)) return 'unlisted'
  return 'private'
}

function contentOf(object) {
  const value = object.content ?? object.contents?.[0] ?? object.name ?? ''
  return { html: String(value || ''), language: value?.locale ? value.locale.baseName : null }
}

function actorHandle(actor) {
  return actor?.id ? `${actor.preferredUsername || 'user'}@${actor.id.host}` : null
}

async function authorOf(object, loader, cache) {
  const id = object.attributionId?.href
  if (!id) return null
  if (!cache.has(id)) {
    cache.set(id, (async () => {
      try {
        const actor = await object.getAttribution(loader)
        return isActor(actor) ? actor : null
      } catch { return null }
    })())
  }
  return cache.get(id)
}

function presentActor(actor) {
  const handle = actorHandle(actor)
  return {
    mention: handle ? `@${handle}` : null,
    name: String(actor.name || actor.preferredUsername || ''),
    uri: actor.id?.href || null,
    profileUrl: actor.url?.href || actor.id?.href || null,
    bot: actor.constructor?.name === 'Service' || actor.constructor?.name === 'Application',
    // Mastodon's opt-in for full-text search of the author's posts.
    indexable: actor.indexable ?? null,
    discoverable: actor.discoverable ?? null,
  }
}

async function attachmentsOf(object, loader) {
  const items = []
  try {
    for await (const item of object.getAttachments(loader)) {
      items.push({ url: item.url?.href || item.href?.href || null, preview_url: null, type: item.mediaType || 'unknown', description: String(item.name || '') })
      if (items.length >= 8) break
    }
  } catch {}
  return normalizeAttachments(items)
}

async function tagsOf(object, loader) {
  const hashtags = []
  const mentions = []
  try {
    for await (const tag of object.getTags(loader)) {
      if (tag instanceof Hashtag) hashtags.push(String(tag.name || '').replace(/^#/, ''))
      else if (tag instanceof Mention && tag.name) mentions.push(String(tag.name))
      if (hashtags.length + mentions.length >= 40) break
    }
  } catch {}
  return { hashtags: hashtags.filter(Boolean), mentions }
}

async function presentPost(object, loader, cache) {
  const author = await authorOf(object, loader, cache)
  const { html, language } = contentOf(object)
  const { hashtags, mentions } = await tagsOf(object, loader)
  const attachments = await attachmentsOf(object, loader)
  return {
    uri: object.id?.href || null,
    url: object.url?.href || object.id?.href || null,
    author: author ? presentActor(author) : null,
    text: excerpt(htmlToPlainText(html), 2000),
    contentWarning: object.summary ? String(object.summary) : null,
    language,
    publishedAt: object.published ? String(object.published) : null,
    inReplyTo: object.replyTargetId?.href || null,
    visibility: visibilityOf(object),
    hashtags,
    mentions,
    attachments: attachments.map(item => ({ url: item.url, description: item.description || null })),
  }
}

// What this node already holds for a remote post: the page it was copied
// into, or the reply it became.
async function localCopy(database, uris) {
  const known = uris.filter(Boolean)
  if (!database || !known.length) return null
  const result = await database.query(
    `SELECT topic.slug, topic.page_number, object.reply_id, object.object_uri
       FROM federation_objects object
       JOIN topics topic ON topic.id = coalesce(object.topic_id, (SELECT topic_id FROM replies WHERE id = object.reply_id))
      WHERE object.object_uri = ANY($1::text[]) AND object.state = 'active'
        AND topic.status IN ('published', 'unlisted')
      ORDER BY array_position($1::text[], object.object_uri)
      LIMIT 1`,
    [known],
  )
  const row = result.rows[0]
  return row ? { slug: row.slug, pageNumber: row.page_number || null, replyId: row.reply_id || null, objectUri: row.object_uri } : null
}

async function lookupTarget(context, target) {
  const value = String(target || '').trim()
  const handle = /^@?([\p{L}\p{N}_][\p{L}\p{N}_.-]*)@([a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,})$/iu.exec(value)
  if (handle) return lookupRemote(context, `acct:${handle[1]}@${handle[2]}`, READER)
  let url
  try { url = new URL(value) } catch { return null }
  if (url.protocol !== 'https:' || url.username || url.password) return null
  return lookupRemote(context, url, READER)
}

// One Fediverse address read for an agent: a post with the posts above it
// and its first replies, or a person with their latest public posts.
export async function lookupFediverse(database, target, { limit = 10 } = {}) {
  const max = Math.min(Math.max(Number(limit) || 10, 1), 20)
  const { context, loader } = await readerContext()
  const found = await lookupTarget(context, target)
  const cache = new Map()
  if (isActor(found)) {
    const posts = []
    try {
      const outbox = await found.getOutbox(loader)
      if (outbox) {
        for await (const item of traverseCollection(outbox, { ...loader, suppressError: true })) {
          if (item instanceof Create) {
            const object = await item.getObject(loader).catch(() => null)
            if (isPost(object) && visibilityOf(object) === 'public') posts.push({ type: 'post', ...await presentPost(object, loader, cache) })
          } else if (item instanceof Announce && item.objectId) {
            posts.push({ type: 'boost', uri: item.objectId.href, publishedAt: item.published ? String(item.published) : null })
          }
          if (posts.length >= max) break
        }
      }
    } catch {}
    return { type: 'actor', actor: presentActor(found), summary: found.summary ? excerpt(htmlToPlainText(String(found.summary)), 600) : null, posts }
  }
  if (!isPost(found)) {
    throw Object.assign(new Error('Nothing public was found at this address. Use a post URL, a profile URL or @user@server.'), { statusCode: 404 })
  }
  const post = await presentPost(found, loader, cache)
  if (post.visibility === 'private') throw Object.assign(new Error('This post is not public.'), { statusCode: 403 })
  const ancestors = []
  let cursor = found
  while (cursor.replyTargetId && ancestors.length < 5) {
    const parent = await cursor.getReplyTarget(loader).catch(() => null)
    if (!isPost(parent)) break
    ancestors.unshift(await presentPost(parent, loader, cache))
    cursor = parent
  }
  const replies = []
  try {
    const collection = await found.getReplies(loader)
    if (collection) {
      for await (const item of traverseCollection(collection, { ...loader, suppressError: true })) {
        const reply = isPost(item) ? item : await lookupRemote(context, item.id || item.href, READER)
        if (isPost(reply) && visibilityOf(reply) !== 'private') replies.push(await presentPost(reply, loader, cache))
        if (replies.length >= max) break
      }
    }
  } catch {}
  return {
    type: 'post',
    post,
    ancestors,
    replies,
    hereAlready: await localCopy(database, [post.uri, ...ancestors.map(item => item.uri)]),
  }
}

function threadItem(object, author, parentObjectUri, attachments) {
  const objectUri = object.id.href
  const text = htmlToPlainText(contentOf(object).html)
  const body = appendAttachments(object.replyTargetId ? stripLeadingMentions(text) : text, attachments)
  const handle = actorHandle(author)
  return {
    id: objectUri,
    objectUri,
    activityUri: null,
    url: object.url?.href || objectUri,
    actorUri: author?.id?.href || object.attributionId?.href || '',
    actorDisplayName: String(author?.name || author?.preferredUsername || 'remote author'),
    actorHandle: handle,
    body,
    visibility: visibilityOf(object),
    parentObjectUri,
    publishedAt: object.published ? new Date(String(object.published)) : null,
    contentHash: shortHash(`${objectUri}\n${body}`),
    attachments,
    raw: { uri: objectUri, url: object.url?.href || null, in_reply_to: object.replyTargetId?.href || null, published: object.published ? String(object.published) : null, account: { uri: author?.id?.href || null, acct: handle, display_name: author?.name ? String(author.name) : null }, attachments },
  }
}

// A thread read through ActivityPub, in the same shape as a Mastodon API
// thread: up from the post to the first one, then down the replies
// collections, breadth first.
export async function fetchActivityPubThread(url, { maxItems = MAX_THREAD_ITEMS } = {}) {
  const { context, loader } = await readerContext()
  const requested = await lookupRemote(context, new URL(url), READER)
  if (!isPost(requested)) throw new Error('The address is not a public Fediverse post.')
  let root = requested
  for (let depth = 0; root.replyTargetId && depth < MAX_ANCESTORS; depth += 1) {
    const parent = await root.getReplyTarget(loader).catch(() => null)
    if (!isPost(parent)) break
    root = parent
  }
  const cache = new Map()
  const items = []
  const seen = new Set()
  const queue = [{ object: root, parent: null }]
  while (queue.length && items.length < maxItems) {
    const { object, parent } = queue.shift()
    const uri = object.id?.href
    if (!uri || seen.has(uri)) continue
    seen.add(uri)
    const author = await authorOf(object, loader, cache)
    items.push(threadItem(object, author, parent, await attachmentsOf(object, loader)))
    try {
      const collection = await object.getReplies(loader)
      if (!collection) continue
      for await (const entry of traverseCollection(collection, { ...loader, suppressError: true })) {
        if (seen.size + queue.length >= maxItems) break
        const reply = isPost(entry) ? entry : await lookupRemote(context, entry.id || entry.href, READER)
        if (isPost(reply) && reply.id && !seen.has(reply.id.href)) queue.push({ object: reply, parent: uri })
      }
    } catch {}
  }
  const threadRoot = items[0] || null
  return {
    requestedUrl: requested.id.href,
    origin: new URL(requested.id.href).origin,
    root: threadRoot,
    requested: items.find(item => item.objectUri === requested.id.href) || threadRoot,
    items,
    observed: { total: items.length, public: items.filter(item => item.visibility === 'public').length },
  }
}
