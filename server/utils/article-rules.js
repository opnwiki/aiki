import { createError } from 'h3'

const BASELINE = [
  {
    id: 'sources',
    scope: 'article',
    statement: {
      en: 'An article names 1–20 public http or https sources a reader can open.',
      ru: 'У статьи 1–20 публичных источников http или https, которые читатель может открыть.',
    },
    check(article) {
      const sources = Array.isArray(article.sources) ? article.sources : []
      const urls = sources.map(source => String(source?.url || source?.canonical_url || ''))
      if (urls.length < 1 || urls.length > 20 || urls.some(url => !/^https?:\/\//i.test(url))) return false
      return true
    },
  },
  {
    id: 'authorship',
    scope: 'article',
    statement: {
      en: 'The article says who wrote it, and names the model when one was used.',
      ru: 'В статье указано, кто её написал, и названа модель, если она использовалась.',
    },
    check(article) {
      const mode = article.authorshipMode
      const model = String(article.modelName || '').trim()
      const human = String(article.humanContribution || '').trim()
      if (mode === 'external_import') return article.importSourceVerified === true && !model && !human && Array.isArray(article.sources) && article.sources.length > 0
      if (mode === 'human_only') return human.length > 0 && !model
      if (mode === 'human_ai_collaboration') return human.length > 0 && model.length > 0
      if (mode === 'ai_generated_human_reviewed' || mode === 'ai_generated_unreviewed') return model.length > 0 && !human
      return false
    },
  },
  {
    id: 'no-secrets',
    scope: 'text',
    statement: {
      en: 'The title and the body do not contain a password, an API key, or a private key.',
      ru: 'В названии и в тексте нет пароля, ключа API и приватного ключа.',
    },
    check(article) {
      return !secretPattern().test(articleText(article))
    },
    adjust(article) {
      return {
        ...article,
        title: article.title.replace(secretPattern(), '[removed]'),
        body: article.body.replace(secretPattern(), '[removed]'),
      }
    },
  },
  {
    id: 'no-email',
    scope: 'text',
    statement: {
      en: 'The title and the body do not contain an email address.',
      ru: 'В названии и в тексте нет адреса электронной почты.',
    },
    check(article) {
      return !emailPattern().test(articleText(article))
    },
    adjust(article) {
      return {
        ...article,
        title: article.title.replace(emailPattern(), '[removed]'),
        body: article.body.replace(emailPattern(), '[removed]'),
      }
    },
  },
  {
    id: 'no-h1',
    scope: 'text',
    statement: {
      en: 'The body does not open with a level-1 heading. The page title is already that heading.',
      ru: 'Текст не начинается с заголовка первого уровня. Заголовок страницы уже стоит над текстом.',
    },
    check(article) {
      return !/^\s*#\s+\S/.test(String(article.body || ''))
    },
    adjust(article) {
      return { ...article, body: String(article.body || '').replace(/^\uFEFF?\s*#\s+[^\n]*\n?/, '').trim() }
    },
  },
]

const EFFECTS = new Set(['allow', 'replace', 'add', 'forbid'])
const ID_TEXT = /^[a-z][a-z0-9-]{1,40}$/
const BASELINE_IDS = new Set(BASELINE.map(rule => rule.id))

export function articleRuleBaseline(locale = 'en') {
  const language = locale === 'ru' ? 'ru' : 'en'
  return BASELINE.map(rule => ({
    id: rule.id,
    statement: rule.statement[language],
    scope: rule.scope,
  }))
}

export function normalizeArticleRuleOverrides(input) {
  if (!Array.isArray(input)) return { ok: false, message: 'Article rules must be a list.' }
  if (input.length > 20) return { ok: false, message: 'A node can keep at most 20 article rule changes.' }
  const seen = new Set()
  const overrides = []
  for (const item of input) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return { ok: false, message: 'Each article rule change needs an id and an effect.' }
    const extra = Object.keys(item).find(key => !['id', 'effect', 'statement', 'match'].includes(key))
    if (extra) return { ok: false, message: `Unknown article rule field: ${extra}` }
    const id = String(item.id || '').trim()
    const effect = String(item.effect || '')
    if (!ID_TEXT.test(id) || !EFFECTS.has(effect)) return { ok: false, message: 'Each article rule change needs an id and an effect.' }
    if (seen.has(id)) return { ok: false, message: 'Each article rule id can be changed once.' }
    seen.add(id)
    if ((effect === 'allow' || effect === 'replace') && !BASELINE_IDS.has(id)) {
      return { ok: false, message: 'Allow and replace apply to a shared article rule.' }
    }
    if ((effect === 'add' || effect === 'forbid') && BASELINE_IDS.has(id)) {
      return { ok: false, message: 'A shared article rule is changed with allow or replace.' }
    }
    const statement = cleanLine(item.statement, 400)
    const match = cleanLine(item.match, 80)
    if (effect === 'allow') {
      overrides.push({ id, effect })
      continue
    }
    if (!statement || statement.length < 8) return { ok: false, message: 'A changed article rule needs a sentence of 8–400 characters.' }
    if (effect === 'forbid' && (!match || match.length < 2)) return { ok: false, message: 'A forbidden phrase needs 2–80 characters.' }
    if (effect === 'replace' || effect === 'add') {
      overrides.push({ id, effect, statement, ...(match ? { match } : {}) })
      continue
    }
    overrides.push({ id, effect, statement, match })
  }
  return { ok: true, value: overrides }
}

export function effectiveArticleRules(overrides = [], locale = 'en') {
  const changes = new Map()
  const extras = []
  for (const item of Array.isArray(overrides) ? overrides : []) {
    if (!item || typeof item !== 'object' || !EFFECTS.has(item.effect) || !ID_TEXT.test(String(item.id || ''))) continue
    if (item.effect === 'add' || item.effect === 'forbid') extras.push(item)
    else changes.set(item.id, item)
  }
  const rules = []
  for (const rule of BASELINE) {
    const change = changes.get(rule.id)
    if (change?.effect === 'allow') continue
    if (change?.effect === 'replace' && change.match) {
      rules.push(phraseRule({
        id: rule.id,
        statement: change.statement,
        match: change.match,
        source: 'node',
        scope: rule.scope,
      }))
      continue
    }
    const presented = presentRule(rule, locale, change?.effect === 'replace' ? 'node' : 'baseline')
    if (change?.effect === 'replace' && change.statement) presented.statement = change.statement
    rules.push({ ...presented, check: rule.check, adjust: rule.adjust })
  }
  for (const extra of extras) {
    if (extra.effect === 'forbid' && extra.match && extra.statement) {
      rules.push(phraseRule({ id: extra.id, statement: extra.statement, match: extra.match, source: 'node', scope: 'text' }))
    } else if (extra.effect === 'add' && extra.statement && extra.match) {
      rules.push(phraseRule({ id: extra.id, statement: extra.statement, match: extra.match, source: 'node', scope: 'text' }))
    } else if (extra.effect === 'add' && extra.statement) {
      rules.push({
        id: extra.id,
        statement: extra.statement,
        enforced: false,
        scope: 'text',
        source: 'node',
        check: () => true,
      })
    }
  }
  return rules
}

export function presentArticleRules(overrides = [], locale = 'en') {
  return effectiveArticleRules(overrides, locale).map(rule => ({
    id: rule.id,
    statement: rule.statement,
    enforced: rule.enforced !== false,
    scope: rule.scope,
    source: rule.source,
  }))
}

export function reviewArticle(article, overrides = [], { locale = 'en', scope = 'article' } = {}) {
  const rules = effectiveArticleRules(overrides, locale).filter(rule => scope === 'article' || rule.scope === 'text')
  const findings = rules.filter(rule => rule.check && !rule.check(article)).map(rule => ({ id: rule.id, statement: rule.statement }))
  return { ok: findings.length === 0, findings, rules }
}

export function fitArticleToRules(article, overrides = [], locale = 'en') {
  let current = {
    title: String(article?.title || ''),
    body: String(article?.body || ''),
    sources: article?.sources || [],
    authorshipMode: article?.authorshipMode || null,
    modelName: article?.modelName || null,
    humanContribution: article?.humanContribution || null,
  }
  const rules = effectiveArticleRules(overrides, locale)
  for (const rule of rules) {
    if (rule.adjust && rule.check && !rule.check(current)) current = rule.adjust(current)
  }
  const review = reviewArticle(current, overrides, { locale })
  const adjusted = current.title !== String(article?.title || '') || current.body !== String(article?.body || '')
  return { ...review, article: current, adjusted }
}

export function rulesConsentError() {
  return createError({ statusCode: 400, statusMessage: 'Confirm that this article follows the publication rules.' })
}

export function rulesReviewError(findings) {
  const text = findings.map(finding => finding.statement).join(' ')
  return createError({ statusCode: 400, statusMessage: `This article does not follow the publication rules. ${text}`.slice(0, 500) })
}

export async function loadArticleRuleOverrides(db) {
  const result = await db.query(
    `SELECT COALESCE(article_rule_overrides, '[]'::jsonb) AS overrides FROM nodes WHERE is_home LIMIT 1`,
  )
  const overrides = result.rows[0]?.overrides
  return Array.isArray(overrides) ? overrides : []
}

function presentRule(rule, locale, source) {
  return {
    id: rule.id,
    statement: rule.statement[locale] || rule.statement.en,
    enforced: true,
    scope: rule.scope,
    source,
    check: rule.check,
    adjust: rule.adjust,
  }
}

function phraseRule({ id, statement, match, source, scope }) {
  const phrase = String(match || '')
  return {
    id,
    statement,
    enforced: true,
    scope,
    source,
    check(article) {
      return !articleText(article).toLowerCase().includes(phrase.toLowerCase())
    },
    adjust(article) {
      return { ...article, title: stripPhrase(article.title, phrase), body: stripPhrase(article.body, phrase) }
    },
  }
}

function articleText(article) {
  return `${article?.title || ''}\n${article?.body || ''}`
}

function stripPhrase(text, phrase) {
  const source = String(text || '')
  const needle = phrase.toLowerCase()
  if (!needle) return source
  const lower = source.toLowerCase()
  let out = ''
  let index = 0
  while (index < source.length) {
    const at = lower.indexOf(needle, index)
    if (at < 0) {
      out += source.slice(index)
      break
    }
    out += source.slice(index, at)
    index = at + needle.length
  }
  return out.replace(/[ ]{2,}/g, ' ').replace(/\n{3,}/g, '\n\n').trim()
}

function cleanLine(value, max) {
  if (value == null || value === '') return ''
  if (typeof value !== 'string') return ''
  return value.replace(/[\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max)
}

function secretPattern() {
  return /(?:password|passwd|api[_-]?key|secret)\s*[:=]\s*\S+|-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z0-9 ]*PRIVATE KEY-----/gi
}

function emailPattern() {
  return /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi
}
