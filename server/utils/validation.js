export const SUPPORTED_LOCALES = Object.freeze(['en', 'zh', 'ru', 'es', 'ja', 'de', 'fr', 'ar'])

export function preferredLocale(input) {
  const value = String(input || 'en')
  return SUPPORTED_LOCALES.includes(value) ? value : 'en'
}
export const TOPIC_KINDS = Object.freeze(['article', 'question', 'discussion', 'message'])
export const RESERVED_SLUGS = Object.freeze(['a', 'admin', 'api', 'api-txt', 'login', 'account', 'integration-account', 'people', 'node', 'topics', 'branches', 'mcp', 'agents', 'tasks', 'agent', 'terms', 'n', 'notifications', 'connect', 'reports', 'openapi-v1-yaml', 'llms-txt', 'robots-txt', 'sitemap-xml', 'fediverse', 'users', 'ap', 'orders', 'access-denied'])
export const PAGE_REPORT_REASONS = Object.freeze(['inaccurate', 'illegal', 'rights', 'other'])

export function isReservedSlug(slug) {
  return RESERVED_SLUGS.includes(String(slug || '').toLowerCase())
}

const PRIVATE_IPV4_RANGES = [
  [/^0\./, 'unspecified'],
  [/^10\./, 'private'],
  [/^127\./, 'loopback'],
  [/^169\.254\./, 'link-local'],
  [/^172\.(1[6-9]|2\d|3[01])\./, 'private'],
  [/^192\.168\./, 'private'],
  [/^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./, 'carrier-grade NAT'],
  [/^192\.0\.0\./, 'special-purpose'],
  [/^198\.(18|19)\./, 'benchmark'],
  [/^224\./, 'multicast'],
  [/^23[5-9]\./, 'reserved'],
]

export function slugify(input) {
  return String(input || '')
    .normalize('NFKC')
    .toLocaleLowerCase('en')
    .trim()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 96)
    .replace(/-+$/g, '')
}

export function normalizePageSlug(input) {
  const slug = String(input || '').normalize('NFKC').trim().toLocaleLowerCase('en')
  if (slug.length < 1 || slug.length > 96 || !/^[\p{L}\p{N}]+(?:-[\p{L}\p{N}]+)*$/u.test(slug) || isReservedSlug(slug)) return null
  return slug
}

export function normalizeBranchSlug(input) {
  const slug = String(input || '').normalize('NFKC').trim().toLocaleLowerCase('en')
  if (slug.length < 1 || slug.length > 96 || !/^[\p{L}\p{N}]+(?:-[\p{L}\p{N}]+)*$/u.test(slug)) return null
  return slug
}

export function validateBranch(input = {}) {
  const title = cleanText(input.title)
  const description = cleanText(input.description || '')
  const errors = {}
  if (title.length < 2 || title.length > 80) errors.title = 'Branch name must be 2–80 characters.'
  if (description.length > 500) errors.description = 'Branch description must be at most 500 characters.'
  const slug = slugify(title)
  if (!slug || !normalizeBranchSlug(slug)) errors.title = 'Branch name cannot produce an available address.'
  return { ok: Object.keys(errors).length === 0, errors, value: { title, description, slug } }
}

export function validateArticleOverview(input) {
  if (input == null || input === '') return { ok: true, value: null }
  if (typeof input !== 'string') return { ok: false, error: 'Article overview must be text.' }
  const value = input.replace(/\0/g, '').trim()
  if (value.length > 2000) return { ok: false, error: 'Article overview must be at most 2000 characters.' }
  return { ok: true, value: value || null }
}

export function validateTopic(input = {}) {
  const title = cleanText(input.title)
  const body = cleanText(input.body)
  const kind = String(input.kind || 'discussion')
  const locale = String(input.locale || 'en')
  const errors = {}
  if (title.length < 8 || title.length > 180) errors.title = 'Title must be 8–180 characters.'
  if (body.length < 20 || body.length > 40_000) errors.body = 'Body must be 20–40000 characters.'
  if (!TOPIC_KINDS.includes(kind)) errors.kind = 'Unsupported topic type.'
  if (!SUPPORTED_LOCALES.includes(locale)) errors.locale = 'Unsupported language.'
  return { ok: Object.keys(errors).length === 0, errors, value: { title, body, kind, locale } }
}

export function validateTopicRevision(input = {}) {
  const title = cleanText(input.title)
  const body = cleanText(input.body)
  const locale = String(input.locale || 'en')
  const summaryResult = validateArticleOverview(input.summary)
  const errors = {}
  if (title.length < 8 || title.length > 180) errors.title = 'Title must be 8–180 characters.'
  if (body.length < 20 || body.length > 40_000) errors.body = 'Body must be 20–40000 characters.'
  if (!SUPPORTED_LOCALES.includes(locale)) errors.locale = 'Unsupported language.'
  if (!summaryResult.ok) errors.summary = summaryResult.error
  return {
    ok: Object.keys(errors).length === 0,
    errors,
    value: { title, body, locale, summary: summaryResult.value },
  }
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

export function validateReply(input = {}) {
  const body = cleanText(input.body)
  const locale = String(input.locale || 'en')
  const errors = {}
  if (body.length < 3 || body.length > 10_000) errors.body = 'Reply must be 3–10000 characters.'
  if (!SUPPORTED_LOCALES.includes(locale)) errors.locale = 'Unsupported language.'
  let parentReplyId = null
  if (input.parentReplyId != null && String(input.parentReplyId).trim() !== '') {
    parentReplyId = String(input.parentReplyId).trim().toLowerCase()
    if (!UUID_PATTERN.test(parentReplyId)) errors.parentReplyId = 'Reply to a published comment on this page.'
  }
  return { ok: Object.keys(errors).length === 0, errors, value: { body, locale, parentReplyId, anonymous: input.anonymous === true } }
}

export function validateReplyVote(input = {}) {
  const value = input?.value
  if (value !== 1 && value !== -1 && value !== 0) {
    return { ok: false, errors: { value: 'Vote must be 1, -1, or 0.' }, value: null }
  }
  return { ok: true, errors: {}, value }
}

export function validateEditProposal(input = {}) {
  const locale = String(input.locale || 'en')
  const baseRevisionId = String(input.baseRevisionId || '').toLowerCase()
  const proposedTitle = cleanText(input.proposedTitle || '')
  const proposedBody = cleanText(input.proposedBody || '')
  const rationale = cleanText(input.rationale || '')
  const errors = {}

  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(baseRevisionId)) {
    errors.baseRevisionId = 'A valid base revision is required.'
  }
  if (!SUPPORTED_LOCALES.includes(locale)) errors.locale = 'Unsupported language.'
  if (proposedTitle && (proposedTitle.length < 8 || proposedTitle.length > 180)) {
    errors.proposedTitle = 'Proposed title must be 8–180 characters when supplied.'
  }
  if (proposedBody.length < 20 || proposedBody.length > 40_000) {
    errors.proposedBody = 'Proposed body must be 20–40000 characters.'
  }
  if (rationale.length < 8 || rationale.length > 2_000) {
    errors.rationale = 'Rationale must be 8–2000 characters.'
  }

  return {
    ok: Object.keys(errors).length === 0,
    errors,
    value: { locale, baseRevisionId, proposedTitle, proposedBody, rationale },
  }
}

export function validatePageReport(input = {}) {
  const reason = String(input.reason || '')
  const details = cleanText(input.details)
  const errors = {}
  if (!PAGE_REPORT_REASONS.includes(reason)) errors.reason = 'Choose a report reason.'
  if (details.length < 8 || details.length > 2_000) errors.details = 'Report details must be 8–2000 characters.'
  return { ok: Object.keys(errors).length === 0, errors, value: { reason, details } }
}

export function validateCitation(input = {}) {
  const errors = {}
  const title = cleanText(input.title || '')
  const publisher = cleanText(input.publisher || '')
  const locator = cleanText(input.locator || '')
  const note = cleanText(input.note || '')
  const publishedAt = normalizePublishDate(input.publishedAt || input.published_at || '')
  let url

  try {
    url = new URL(String(input.url || ''))
  } catch {
    errors.url = 'Citation must have a valid public HTTP(S) URL.'
    return { ok: false, errors }
  }

  const address = url.hostname.toLowerCase().replace(/^\[|\]$/g, '')
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || !address || isPrivateAddress(address)) {
    errors.url = 'Citation must have a valid public HTTP(S) URL without credentials.'
  }
  if (url.href.length > 2048) errors.url = 'Citation URL is too long.'
  if (title.length > 240) errors.title = 'Citation title is too long.'
  if (publisher.length > 180) errors.publisher = 'Publisher is too long.'
  if (locator.length > 500) errors.locator = 'Source locator is too long.'
  if (note.length > 1000) errors.note = 'Citation note is too long.'

  return {
    ok: Object.keys(errors).length === 0,
    errors,
    value: { url: url.href, title, publisher, locator, note, publishedAt },
  }
}

function normalizePublishDate(value) {
  const text = String(value || '').trim()
  if (!text) return null
  const m = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/)
  if (!m) return null
  const y = Number(m[1]); const mo = Number(m[2]); const d = Number(m[3])
  if (y < 1900 || y > 2100 || mo < 1 || mo > 12 || d < 1 || d > 31) return null
  return `${String(y).padStart(4, '0')}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`
}

export function isPrivateAddress(hostname) {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '')
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal')) return true
  if (host.includes(':')) {
    const normalized = host.replace(/^0+/, '')
    return normalized === '::' || normalized === '::1' || /^f[cd]/i.test(normalized) || /^fe[89ab]/i.test(normalized) || /^ff/i.test(normalized)
  }
  const octets = host.split('.')
  if (octets.length !== 4 || octets.some(part => !/^\d{1,3}$/.test(part) || Number(part) > 255)) return false
  return PRIVATE_IPV4_RANGES.some(([pattern]) => pattern.test(host))
}

function cleanText(value) {
  return String(value ?? '').replace(/\0/g, '').trim()
}
