import { createError, getHeader } from 'h3'
import { enforceSameOrigin, getHumanActor } from './auth.js'
import { getAgentActor } from './agent-auth.js'
import { validateAuthorship } from './authorship.js'
import { validateArticleOverview, validateCitation, validateTopic } from './validation.js'

const TASK_KINDS = new Set(['article', 'question', 'discussion'])
const TASK_LOCALES = new Set(['en', 'zh', 'ru', 'es', 'ja', 'de', 'fr', 'ar'])

export async function requireWritingTaskActor(event) {
  const authorization = getHeader(event, 'authorization') || ''
  if (authorization) {
    if (!/^Bearer\s+/i.test(authorization)) throw createError({ statusCode: 401, statusMessage: 'A valid agent bearer key is required.' })
    const actor = await getAgentActor(event)
    if (!actor) throw createError({ statusCode: 401, statusMessage: 'A valid active agent API key is required.' })
    return actor
  }
  const actor = await getHumanActor(event)
  if (!actor) throw createError({ statusCode: 401, statusMessage: 'Sign in to claim or submit a writing task.' })
  enforceSameOrigin(event)
  return actor
}

export async function requireTaskReviewer(event, submissionAuthorId) {
  const actor = await getHumanActor(event)
  if (!actor) throw createError({ statusCode: 401, statusMessage: 'Sign in to review a writing submission.' })
  enforceSameOrigin(event)
  if (!['owner', 'admin', 'moderator'].includes(actor.role)) {
    throw createError({ statusCode: 403, statusMessage: 'A moderator must review this submission.' })
  }
  if (submissionAuthorId && actor.id === submissionAuthorId) {
    throw createError({ statusCode: 403, statusMessage: 'You cannot review your own submission.' })
  }
  return actor
}

export function validateWritingSubmission(input = {}, localeFallback = 'en') {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return { ok: false, error: 'invalid_body' }
  const allowed = new Set(['kind', 'title', 'body', 'locale', 'sources', 'authorshipMode', 'modelName', 'humanContribution', 'rulesConsent', 'overview'])
  if (Object.keys(input).some(key => !allowed.has(key))) return { ok: false, error: 'unknown_field' }
  const kind = String(input.kind || 'article')
  const locale = String(input.locale || localeFallback)
  if (!TASK_KINDS.has(kind) || !TASK_LOCALES.has(locale)) return { ok: false, error: 'invalid_kind_or_locale' }
  const checked = validateTopic({ title: input.title, body: input.body, kind, locale })
  if (!checked.ok) return { ok: false, error: 'invalid_content' }
  const rawSources = input.sources === undefined ? [] : input.sources
  if (!Array.isArray(rawSources) || rawSources.length > (kind === 'article' ? 20 : 1)) return { ok: false, error: 'invalid_sources' }
  if (kind === 'article' && rawSources.length < 1) return { ok: false, error: 'article_sources_required' }
  const sources = rawSources.map(validateCitation)
  if (sources.some(source => !source.ok)) return { ok: false, error: 'invalid_sources' }

  const overview = validateArticleOverview(input.overview)
  if (!overview.ok || (kind !== 'article' && overview.value)) return { ok: false, error: 'invalid_overview' }

  let authorship = null
  if (kind === 'article') {
    authorship = validateAuthorship(input)
    if (!authorship.ok) return { ok: false, error: 'invalid_authorship' }
  } else if (input.authorshipMode !== undefined || input.modelName !== undefined || input.humanContribution !== undefined) {
    return { ok: false, error: 'authorship_only_for_articles' }
  }
  return {
    ok: true,
    value: {
      ...checked.value,
      sources: sources.map(source => source.value),
      authorship: authorship?.value || null,
      overview: kind === 'article' ? overview.value : null,
    },
  }
}

export function validateOverviewTaskSubmission(input = {}, localeFallback = 'en') {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return { ok: false, error: 'invalid_body' }
  const allowed = new Set(['overview', 'locale', 'rationale'])
  if (Object.keys(input).some(key => !allowed.has(key))) return { ok: false, error: 'unknown_field' }
  const locale = String(input.locale || localeFallback)
  if (!TASK_LOCALES.has(locale)) return { ok: false, error: 'invalid_locale' }
  const overview = validateArticleOverview(input.overview)
  const rationale = String(input.rationale || '').replace(/\0/g, '').trim()
  if (!overview.ok || !overview.value || overview.value.length < 20) return { ok: false, error: 'invalid_overview' }
  if (rationale.length < 8 || rationale.length > 2000) return { ok: false, error: 'invalid_rationale' }
  return { ok: true, value: { locale, overview: overview.value, rationale } }
}
