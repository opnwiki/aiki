import sanitizeHtml from 'sanitize-html'
import { localDomain } from './mentions.js'

// Mastodon writes a mention as <a href="https://server/@user" class="mention">@<span>user</span></a>:
// keep the full @user@server (just @user for this node) instead of a bare @user.
function mentionLinksToText(html, domain) {
  return html.replace(/<a\b([^>]*\bclass="[^"]*\bmention\b[^"]*"[^>]*)>([\s\S]*?)<\/a>/gi, (whole, attributes, inner) => {
    const href = /\bhref="([^"]+)"/i.exec(attributes)?.[1]
    const text = inner.replace(/<[^>]+>/g, '').trim()
    if (!href || !text.startsWith('@') || text.startsWith('#')) return whole
    let host
    try { host = new URL(href).hostname.toLowerCase() } catch { return whole }
    const username = text.slice(1).split('@')[0]
    return host === domain ? `@${username}` : `@${username}@${host}`
  })
}

// Text of Fediverse posts as readable Markdown-ish plain text: paragraphs and
// line breaks survive (stripping tags used to glue "look</p><p>I" into
// "lookI"), links keep their address, entities are decoded.
export function htmlToPlainText(value, { domain = localDomain() } = {}) {
  const html = mentionLinksToText(String(value || ''), domain)
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|blockquote|h[1-6])>/gi, '\n\n')
    .replace(/<li[^>]*>/gi, '- ')
  return sanitizeHtml(html, { allowedTags: [], allowedAttributes: {}, textFilter: text => text })
    .replace(/&(?:amp|#38);/gi, '&').replace(/&(?:lt|#60);/gi, '<').replace(/&(?:gt|#62);/gi, '>')
    .replace(/&quot;/gi, '"').replace(/&#39;|&apos;/gi, "'").replace(/&nbsp;/gi, ' ')
    .split('\n').map(line => line.replace(/[ \t]+/g, ' ').trim()).join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

const MENTION = /^@[\w.-]+(?:@[\w.-]+\.[a-z]{2,})?[\s,:]*/iu

// Mastodon starts a reply with mentions of everyone in the branch; the thread
// already shows who is answered, so they are dropped from the start.
export function stripLeadingMentions(text) {
  let value = String(text || '').trimStart()
  let previous
  do {
    previous = value
    value = value.replace(MENTION, '')
  } while (value !== previous)
  return value.trim() || String(text || '').trim()
}

// A short page title: the first sentence or line, without links, cut at a
// word boundary. The full text stays in the page body.
export function shortTitle(text, fallback, limit = 100) {
  const firstLine = stripLeadingMentions(text).split(/\n/).map(line => line.trim()).find(Boolean) || ''
  const withoutLinks = firstLine.replace(/https?:\/\/\S+/gi, ' ').replace(/\s+/g, ' ').trim()
  const sentence = withoutLinks.match(/^(.{20,}?[.!?…])(\s|$)/u)?.[1] || withoutLinks
  if (!sentence) return fallback
  if (sentence.length <= limit) return sentence
  return `${sentence.slice(0, limit).replace(/\s+\S*$/, '')}…`
}
