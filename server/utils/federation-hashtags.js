import { Hashtag } from '@fedify/vocab'
import { htmlToPlainText } from './fediverse-text.js'
import { assertPublicRemoteOrigin, mastodonJson } from './federation-import.js'
import { escapeHtml, federationOrigin } from './federation-notes.js'
import { slugify } from './validation.js'

const MAX_HASHTAGS = 10
const HASHTAG_NAME = /^[\p{L}\p{N}_]*\p{L}[\p{L}\p{N}_]*$/u

// A Fediverse hashtag is one word of letters, digits and _: a tag label
// "machine learning" becomes #MachineLearning; a name without letters is none.
export function hashtagName(label) {
  const words = String(label || '').normalize('NFKC').replace(/^#+/, '').split(/[^\p{L}\p{N}_]+/u).filter(Boolean)
  const name = words.length > 1
    ? words.map(word => word.charAt(0).toLocaleUpperCase() + word.slice(1)).join('')
    : words[0] || ''
  return HASHTAG_NAME.test(name) && name.length <= 48 ? name : null
}

// The page list of a tag here: Mastodon links a hashtag to such a page.
export function hashtagHref(name, origin = federationOrigin) {
  return `${origin}/topics?tag=${encodeURIComponent(slugify(name))}`
}

export function hashtagsFromLabels(labels, origin = federationOrigin) {
  const seen = new Set()
  const tags = []
  for (const label of Array.isArray(labels) ? labels : []) {
    const name = hashtagName(label)
    if (!name || seen.has(name.toLowerCase())) continue
    seen.add(name.toLowerCase())
    tags.push({ name, href: hashtagHref(name, origin) })
    if (tags.length >= MAX_HASHTAGS) break
  }
  return tags
}

// #words written in a reply, outside code and link addresses (a URL #fragment
// is not a hashtag).
export function extractHashtags(markdown, origin = federationOrigin) {
  const text = String(markdown || '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`[^`]*`/g, ' ')
    .replace(/\]\([^)]*\)/g, '] ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/https?:\/\/\S+/g, ' ')
  const names = []
  for (const match of text.matchAll(/(^|[^\p{L}\p{N}_&/#])#([\p{L}\p{N}_]+)/gu)) names.push(match[2])
  return hashtagsFromLabels(names, origin)
}

// The tag labels of a page, in its order, as a SELECT column.
export function topicTagLabelsSql(topicAlias) {
  return `(SELECT coalesce(json_agg(tag.label ORDER BY topic_tag.position), '[]'::json)
             FROM topic_tags topic_tag JOIN tags tag ON tag.id = topic_tag.tag_id
            WHERE topic_tag.topic_id = ${topicAlias}.id) AS tag_labels`
}

// ActivityPub tag entries: servers file the post under these hashtags.
export function hashtagObjects(tags) {
  return (tags || []).map(tag => new Hashtag({ href: new URL(tag.href), name: `#${tag.name}` }))
}

// Line of hashtag links under a page excerpt, written like Mastodon's own.
export function hashtagHtml(tags) {
  if (!tags?.length) return ''
  return `<p>${tags.map(tag => hashtagLink(tag)).join(' ')}</p>`
}

function hashtagLink(tag) {
  return `<a href="${escapeHtml(tag.href)}" class="mention hashtag" rel="tag">#<span>${escapeHtml(tag.name)}</span></a>`
}

// Turns #name in rendered reply HTML into hashtag links, leaving links, code
// and tag attributes alone.
export function linkHashtagsHtml(html, tags) {
  if (!tags?.length) return String(html || '')
  const byName = new Map(tags.map(tag => [tag.name.toLowerCase(), tag]))
  let skipDepth = 0
  return String(html || '').split(/(<[^>]+>)/g).map((part) => {
    if (part.startsWith('<')) {
      const element = /^<(\/)?(a|code|pre)\b/i.exec(part)
      if (element) skipDepth = Math.max(0, skipDepth + (element[1] ? -1 : 1))
      return part
    }
    if (skipDepth) return part
    return part.replace(/(^|[^\p{L}\p{N}_&/#])#([\p{L}\p{N}_]+)/gu, (whole, before, name) => {
      const tag = byName.get(name.toLowerCase())
      return tag ? `${before}${hashtagLink({ ...tag, name })}` : whole
    })
  })
    .join('')
}

export function normalizeInstanceOrigin(input) {
  const raw = String(input || '').trim().replace(/^@/, '')
  let parsed
  try { parsed = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`) } catch { return null }
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.port) return null
  if (!/^[a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,}$/i.test(parsed.hostname)) return null
  return parsed.origin
}

// Public posts with a hashtag, as one Mastodon-compatible server sees them
// (its own posts and those that reached it). Servers may close this list to
// visitors; then the error says so.
export async function fetchHashtagTimeline({ instance, tag, limit = 20, before = null, fetchImpl = globalThis.fetch, timeoutMs = 10_000 } = {}) {
  const origin = normalizeInstanceOrigin(instance)
  if (!origin) throw Object.assign(new Error('Use a public HTTPS server name such as mastodon.social.'), { statusCode: 400 })
  const name = String(tag || '').trim().replace(/^#+/, '')
  if (!HASHTAG_NAME.test(name) || name.length > 100) throw Object.assign(new Error('Use one hashtag of letters, digits and _.'), { statusCode: 400 })
  if (fetchImpl === globalThis.fetch) await assertPublicRemoteOrigin(origin)
  const params = new URLSearchParams({ limit: String(Math.min(Math.max(Number(limit) || 20, 1), 40)) })
  if (before && /^[0-9A-Za-z]{1,32}$/.test(String(before))) params.set('max_id', String(before))
  let statuses
  try {
    statuses = await mastodonJson(`${origin}/api/v1/timelines/tag/${encodeURIComponent(name)}?${params}`, { fetchImpl, timeoutMs })
  } catch (error) {
    const status = Number(/\((\d{3})\)/.exec(String(error?.message))?.[1])
    const message = [401, 403, 422].includes(status)
      ? `${new URL(origin).host} does not show hashtag timelines to visitors; try another server.`
      : status === 404
        ? `${new URL(origin).host} has no Mastodon-compatible hashtag timeline.`
        : `${new URL(origin).host} did not answer: ${error?.message || 'request failed'}`
    throw Object.assign(new Error(message), { statusCode: 502 })
  }
  if (!Array.isArray(statuses)) throw Object.assign(new Error('The server returned an unexpected hashtag timeline.'), { statusCode: 502 })
  const host = new URL(origin).host
  const posts = statuses
    .filter(status => status && status.visibility === 'public')
    .map(status => presentMastodonStatus(status, host))
  return {
    instance: host,
    hashtag: name,
    posts,
    // Pass as before to read the next (older) page.
    nextBefore: statuses.length ? String(statuses[statuses.length - 1].id || '') || null : null,
  }
}

function presentMastodonStatus(status, host) {
  const account = status.account || {}
  const acct = String(account.acct || account.username || '')
  return {
    uri: String(status.uri || status.url || ''),
    url: String(status.url || status.uri || ''),
    author: {
      mention: acct ? `@${acct.includes('@') ? acct : `${acct}@${host}`}` : null,
      name: String(account.display_name || account.username || ''),
      profileUrl: account.url || null,
      bot: account.bot === true,
    },
    text: excerpt(htmlToPlainText(status.content)),
    contentWarning: status.spoiler_text || null,
    language: status.language || null,
    publishedAt: status.created_at || null,
    isReply: Boolean(status.in_reply_to_id),
    hashtags: Array.isArray(status.tags) ? status.tags.map(tag => String(tag?.name || '')).filter(Boolean).slice(0, 20) : [],
    attachments: Array.isArray(status.media_attachments) ? status.media_attachments.length : 0,
    replies: Number(status.replies_count) || 0,
    boosts: Number(status.reblogs_count) || 0,
    likes: Number(status.favourites_count) || 0,
  }
}

export function excerpt(text, limit = 1500) {
  const value = String(text || '').trim()
  return value.length > limit ? `${value.slice(0, limit).replace(/\s+\S*$/, '')}…` : value
}
