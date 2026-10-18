// Shared text for pages published to the Fediverse. The outbox, the object
// URL and pushed posts all describe a page the same way: title, a short
// excerpt and the page link (Mastodon renders `content` as HTML, so raw
// Markdown must not be sent).
export const federationOrigin = process.env.NUXT_PUBLIC_SITE_URL || process.env.SITE_URL || 'http://localhost:3000'
const EXCERPT_CHARS = 420

export function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char])
}

export function plainExcerpt(markdown, limit = EXCERPT_CHARS) {
  const text = String(markdown || '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[#>*_`~|]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return text.length > limit ? `${text.slice(0, limit).replace(/\s+\S*$/, '')}…` : text
}

export function pageUrl(row, origin = federationOrigin) {
  return `${origin}/${row.page_number || encodeURIComponent(row.slug)}`
}

export function channelNoteHtml(row, origin = federationOrigin) {
  const url = pageUrl(row, origin)
  const excerpt = plainExcerpt(row.body_markdown)
  return [
    row.title ? `<p><strong>${escapeHtml(row.title)}</strong></p>` : '',
    excerpt && excerpt !== row.title ? `<p>${escapeHtml(excerpt)}</p>` : '',
    `<p><a href="${url}">${url}</a></p>`,
  ].join('')
}

// Pages are announced by @new as topics-<id>; personal public messages are
// messages-<id> from their author.
export function channelNoteUri(topicId, { personal = false } = {}, origin = federationOrigin) {
  return new URL(`${origin}/ap/objects/notes/${personal ? 'messages' : 'topics'}-${topicId}`)
}
