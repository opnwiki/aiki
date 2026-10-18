import { createHash } from 'node:crypto'
import { createError } from 'h3'
import { validateArticleOverview, validateCitation, validateTopic } from './validation.js'
import { validateTags } from './tags.js'
import { allowedIntegrationMediaUrl } from './integration-auth.js'
import { normalizeExternalIdentity } from './integration-identity.js'

export const IMPORT_API_VERSION = 1
export const IMPORT_KINDS = Object.freeze(['article', 'message', 'question', 'discussion'])
export const IMPORT_BODY_BYTES = 256 * 1024

function invalid(message) { throw createError({ statusCode: 400, statusMessage: message }) }
function object(value, keys, name) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid(`${name} must be an object.`)
  const unknown = Object.keys(value).find(key => !keys.includes(key))
  if (unknown) invalid(`Unknown ${name} field: ${unknown}`)
  return value
}
function text(value, max, name, required = false) {
  if (value == null && !required) return null
  if (typeof value !== 'string' || value.length > max || /[\u0000-\u001f\u007f]/.test(value)) invalid(`Invalid ${name}.`)
  const cleaned = value.trim()
  if (required && !cleaned) invalid(`${name} is required.`)
  return cleaned || null
}
function sourceUrl(value) {
  if (value == null || value === '') return null
  const checked = validateCitation({ url: value })
  let decoded
  try { decoded = checked.ok ? decodeURIComponent(checked.value.url) : '' } catch { invalid('Invalid source URL encoding.') }
  if (!checked.ok || /api\.telegram\.org|bot\d+:[\w-]+|aiki_(?:agent|integration)_|[?&](?:[^=&]*token|key|api_key|secret)=/i.test(decoded)) invalid('The source must have a public URL without credentials.')
  return checked.value.url
}

export function validateIntegrationImport(input, credential) {
  object(input, ['version', 'idempotencyKey', 'externalSourceKey', 'submitter', 'author', 'source', 'content', 'sources', 'media', 'formatting'], 'import')
  if (input.version !== IMPORT_API_VERSION) invalid('Unsupported integration API version.')
  const idempotencyKey = text(input.idempotencyKey, 256, 'idempotencyKey', true)
  const externalSourceKey = text(input.externalSourceKey, 512, 'externalSourceKey', true)
  const submitter = normalizeExternalIdentity(input.submitter, credential, { verifiedSender: true })
  const author = input.author == null ? null : normalizeExternalIdentity(input.author, credential)
  const rawSource = object(input.source, ['url', 'title', 'publisher', 'publishedAt', 'visibility', 'authorName', 'authorSignature', 'originalLanguage'], 'source')
  if (!['public', 'confirmed'].includes(rawSource.visibility)) invalid('Only a public source or an explicitly confirmed submission can be imported.')
  const url = sourceUrl(rawSource.url)
  let publishedAt = null
  if (rawSource.publishedAt != null) {
    if (typeof rawSource.publishedAt !== 'string' || !/^\d{4}-\d{2}-\d{2}(?:T.*)?$/.test(rawSource.publishedAt) || !Number.isFinite(Date.parse(rawSource.publishedAt))) invalid('Invalid source publication time.')
    publishedAt = new Date(rawSource.publishedAt).toISOString()
    if (rawSource.publishedAt.length === 10 && publishedAt.slice(0, 10) !== rawSource.publishedAt) invalid('Invalid source publication date.')
  }
  const source = {
    url, title: text(rawSource.title, 240, 'source title'), publisher: text(rawSource.publisher, 180, 'publisher'),
    publishedAt, visibility: rawSource.visibility, authorName: text(rawSource.authorName, 160, 'source author'),
    authorSignature: text(rawSource.authorSignature, 160, 'source author signature'),
    originalLanguage: text(rawSource.originalLanguage, 35, 'source language'),
  }
  const rawContent = object(input.content, ['title', 'body', 'kind', 'locale', 'overview', 'tags', 'publicUsefulnessScore', 'publicUsefulnessReason'], 'content')
  if (typeof rawContent.title !== 'string' || typeof rawContent.body !== 'string' || typeof rawContent.locale !== 'string') invalid('Page title, body and locale must be text.')
  if (!IMPORT_KINDS.includes(rawContent.kind)) invalid('An import requires a completed page type.')
  const topic = validateTopic(rawContent)
  if (!topic.ok) invalid(Object.values(topic.errors).join(' '))
  const overview = validateArticleOverview(rawContent.overview)
  if (!overview.ok) invalid(overview.error)
  const tags = validateTags(rawContent.tags)
  if (!tags.ok) invalid(Object.values(tags.errors).join(' '))
  if (/api\.telegram\.org\/file\/bot|aiki_(?:integration|agent)_[\w-]+/i.test(topic.value.body)) invalid('The page contains a private credential or download URL.')
  const score = rawContent.publicUsefulnessScore == null ? null : rawContent.publicUsefulnessScore
  if (score !== null && (typeof score !== 'number' || !Number.isFinite(score) || score < 0 || score > 100)) invalid('Invalid public usefulness score.')
  const sources = input.sources ?? []
  if (!Array.isArray(sources) || sources.length > 20 || (topic.value.kind === 'article' && sources.length === 0)) invalid('Articles require 1–20 public sources.')
  const citations = sources.map(item => {
    object(item, ['url', 'title', 'publisher', 'publishedAt', 'locator', 'note'], 'citation')
    const checked = validateCitation(item)
    if (!checked.ok) invalid(Object.values(checked.errors).join(' '))
    sourceUrl(checked.value.url)
    return checked.value
  })
  const rawMedia = input.media ?? []
  if (!Array.isArray(rawMedia) || rawMedia.length > 10) invalid('An import supports up to ten images.')
  const media = rawMedia.map(item => {
    object(item, ['url', 'mediaType', 'alt'], 'media')
    const mediaUrl = allowedIntegrationMediaUrl(item.url, credential)
    if (!mediaUrl || !['image/png', 'image/jpeg', 'image/webp'].includes(item.mediaType)) invalid('Images must use stable URLs on an allowed media origin.')
    return { url: mediaUrl, mediaType: item.mediaType, alt: text(item.alt, 240, 'image description') }
  })
  const rawFormat = object(input.formatting, ['provider', 'model', 'mode', 'usage', 'costUsd'], 'formatting')
  if (!['preserved', 'generated'].includes(rawFormat.mode)) invalid('Invalid formatting mode.')
  const formatting = { provider: text(rawFormat.provider, 80, 'formatting provider', true), model: text(rawFormat.model, 160, 'formatting model', true), mode: rawFormat.mode }
  if (rawFormat.costUsd != null) {
    if (typeof rawFormat.costUsd !== 'number' || !Number.isFinite(rawFormat.costUsd) || rawFormat.costUsd < 0) invalid('Invalid formatting cost.')
    formatting.costUsd = rawFormat.costUsd
  }
  if (rawFormat.usage != null) {
    if (!rawFormat.usage || typeof rawFormat.usage !== 'object' || Array.isArray(rawFormat.usage) || Object.keys(rawFormat.usage).length > 16
      || Object.entries(rawFormat.usage).some(([key, value]) => !/^[a-zA-Z][a-zA-Z0-9_]{0,40}$/.test(key) || !Number.isSafeInteger(value) || value < 0)) invalid('Formatting usage must contain bounded token counts.')
    formatting.usage = rawFormat.usage
  }
  const content = { ...topic.value, overview: overview.value, tags: tags.value, publicUsefulnessScore: score === null ? null : Math.round(score * 100) / 100,
    publicUsefulnessReason: text(rawContent.publicUsefulnessReason, 500, 'usefulness reason') }
  return { version: IMPORT_API_VERSION, idempotencyKey, externalSourceKey, submitter, author, source, content, sources: citations, media, formatting, sourceHash: importContentHash({ content, sources: citations, media, formatting }) }
}

// Generated headings and profile avatars can vary on retry. They do not make an
// unchanged source a new revision. Stable media URLs are content-addressed.
export function importContentHash({ content, sources = [], media = [], formatting }) {
  return createHash('sha256').update(JSON.stringify({ body: content.body, sources: sources.map(item => item.url),
    media: media.map(item => item.url), mode: formatting.mode })).digest('hex')
}

export function importRevisionDecision(stored, incoming) {
  if (!['published', 'pending'].includes(stored.status)) return 'unavailable'
  if (stored.source_hash === incoming.sourceHash) return 'reuse'
  if (stored.current_revision_id !== stored.last_revision_id || stored.locale !== incoming.content.locale || stored.kind !== incoming.content.kind || stored.status === 'pending') return 'proposal'
  return 'revision'
}

export function publicImportState(status, proposalId = null, moderationPending = false) {
  if (!['published', 'pending'].includes(status)) return 'rejected'
  if (proposalId) return 'proposed'
  if (status === 'pending' || moderationPending) return 'pending'
  return status === 'published' ? 'published' : 'rejected'
}
