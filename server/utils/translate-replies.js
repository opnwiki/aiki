import { translateMarkdown } from './translate.js'

const MAX_TRANSLATION_WORKERS = 3
const LATIN_LANGUAGE_PATTERNS = {
  en: { bonus: 0, words: /\b(?:the|and|is|are|this|that|with|from|for|not|can|what|how)\b/gu },
  es: { bonus: /[¿¡ñ]/u, words: /\b(?:qué|es|para|una|uno|el|la|los|las|se|necesita|puede|hacer|directamente|pregunta|sobre|página|esto)\b/gu },
  de: { bonus: /[äöüß]/u, words: /\b(?:der|die|das|und|ist|nicht|mit|für|ein|eine|wie|was|auf|von)\b/gu },
  fr: { bonus: /[àâçéèêëîïôùûüÿœ]/u, words: /\b(?:le|la|les|des|une|est|pour|dans|pas|avec|que|qui|sur|ce)\b/gu },
}

export function inferReplyLocale(body, declaredLocale) {
  const declared = String(declaredLocale || '').trim().toLowerCase()
  const text = String(body || '')
  if (/[\u0400-\u04ff]/u.test(text)) return 'ru'
  if (/[\u0600-\u06ff]/u.test(text)) return 'ar'
  if (/[\u3040-\u30ff]/u.test(text)) return 'ja'
  if (/[\u4e00-\u9fff]/u.test(text)) return declared === 'ja' ? 'ja' : 'zh'
  const lower = text.toLowerCase()
  const ranked = Object.entries(LATIN_LANGUAGE_PATTERNS)
    .map(([locale, pattern]) => ({
      locale,
      score: (pattern.bonus && pattern.bonus.test(lower) ? 3 : 0) + (lower.match(pattern.words)?.length || 0),
    }))
    .sort((left, right) => right.score - left.score)
  if (ranked[0]?.score >= 2 && ranked[0].score > (ranked[1]?.score || 0)) return ranked[0].locale
  return declared
}

export async function ensureReplyTranslations(database, replies, targetLocale) {
  const candidates = (replies || [])
    .map(reply => ({ ...reply, sourceLocale: inferReplyLocale(reply.body_markdown, reply.locale) }))
    .filter(reply => reply.sourceLocale && reply.sourceLocale !== targetLocale)
  const translations = new Map()
  if (!candidates.length) return translations

  const ids = candidates.map(reply => reply.id)
  const sourceLocales = new Map(candidates.map(reply => [reply.id, reply.sourceLocale]))
  const sourceLocaleChanged = new Map(candidates.map(reply => [reply.id, reply.sourceLocale !== String(reply.locale || '').trim().toLowerCase()]))
  const stored = await database.query(
    `SELECT reply_id, body_markdown, provider
       FROM reply_translations
      WHERE locale = $1 AND reply_id = ANY($2::uuid[])`,
    [targetLocale, ids],
  )
  for (const row of stored.rows) {
    if (!sourceLocaleChanged.get(row.reply_id)) translations.set(row.reply_id, { ...row, sourceLocale: sourceLocales.get(row.reply_id) || null })
  }

  const missing = candidates.filter(reply => !translations.has(reply.id))
  let cursor = 0
  async function worker() {
    while (cursor < missing.length) {
      const reply = missing[cursor]
      cursor += 1
      try {
        const translated = await translateMarkdown({
          body: reply.body_markdown,
          sourceLocale: reply.sourceLocale,
          targetLocale,
        })
        const inserted = await database.query(
          `INSERT INTO reply_translations (reply_id, locale, body_markdown, provider)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT (reply_id, locale) DO UPDATE SET
             body_markdown = EXCLUDED.body_markdown,
             provider = EXCLUDED.provider
           RETURNING reply_id, body_markdown, provider`,
          [reply.id, targetLocale, translated.body, translated.provider],
        )
        const row = inserted.rows[0] || (await database.query(
          `SELECT reply_id, body_markdown, provider
             FROM reply_translations
            WHERE reply_id = $1 AND locale = $2`,
          [reply.id, targetLocale],
        )).rows[0]
        if (row) translations.set(row.reply_id, { ...row, sourceLocale: reply.sourceLocale })
      } catch (error) {
        console.error(`[translation] reply ${reply.id} stayed in its source language`, error.message)
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(MAX_TRANSLATION_WORKERS, missing.length) }, () => worker()))
  return translations
}
