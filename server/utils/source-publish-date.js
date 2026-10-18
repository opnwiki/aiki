// Best-effort extraction of a source's publication date from its HTML,
// mirroring the "article:published_time" style meta tags most publishers emit.
// Falls back to the date the source was added (the publicationDate field).
import { isPrivateAddress } from './validation.js'

const MAX_BYTES = 600_000
const TIMEOUT_MS = 8000

function cleanDateValue(value) {
  if (!value) return null
  const match = String(value).trim().match(/^\s*(\d{4})-(\d{1,2})-(\d{1,2})/)
  if (!match) return null
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  if (year < 1900 || year > 2100 || month < 1 || month > 12 || day < 1 || day > 31) return null
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

export function extractPublishedDate(html = '') {
  const text = String(html)
  const candidates = []

  const propertyAttrs = ['article:published_time', 'og:article:published_time', 'article:modified_time', 'og:article:modified_time', 'datePublished', 'datecreated', 'dc.date', 'dc.date.issued', 'publication_date', 'publish_date']
  for (const attr of propertyAttrs) {
    const reg = new RegExp(`(?:property|name|itemprop)=["']${attr}["'][^>]*content=["']([^"']+)["']`, 'i')
    const m = text.match(reg)
    if (m) candidates.push(m[1])
  }
  // <meta content="..." property="article:published_time"> ordering
  const reversed = text.match(/(?:content)=["']([^"']+)["'][^>]*(?:property|name|itemprop)=["'](?:article:published_time|datePublished|publication_date)["']/i)
  if (reversed) candidates.push(reversed[1])
  const timeTag = text.match(/<time[^>]+datetime=["']([^"']+)["']/i)
  if (timeTag) candidates.push(timeTag[1])

  for (const candidate of candidates) {
    const cleaned = cleanDateValue(candidate)
    if (cleaned) return cleaned
  }
  return null
}

async function fetchHtml(url) {
  const parsed = new URL(url)
  if (!['http:', 'https:'].includes(parsed.protocol)) return null
  const host = parsed.hostname.toLowerCase().replace(/\.$/, '')
  if (isPrivateAddress(host)) return null
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  try {
    const response = await fetch(parsed.href, {
      redirect: 'follow',
      signal: controller.signal,
      headers: { 'user-agent': 'AikiWiki/1.0 (+https://aiki.wiki/)', accept: 'text/html,application/xhtml+xml' },
    })
    if (!response.ok) return null
    const contentType = response.headers.get('content-type') || ''
    if (!/html/.test(contentType) && !/xml/.test(contentType)) return null
    const buffer = await response.arrayBuffer()
    if (buffer.byteLength > MAX_BYTES) return null
    return Buffer.from(buffer).toString('utf8')
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

// Returns the best publication date (YYYY-MM-DD) for a source, or null.
// Prefers HTML meta tags when they can be retrieved; otherwise uses the date
// that was recorded when the source was added.
export async function resolveSourcePublishedAt(source = {}) {
  const provided = cleanDateValue(source.publishedAt || source.published_at || source.publicationDate || '')
  if (!source.url) return provided
  try {
    const html = await fetchHtml(source.url)
    if (html) {
      const fromHtml = extractPublishedDate(html)
      if (fromHtml) return fromHtml
    }
  } catch {
    // fall through to the recorded date
  }
  return provided
}
