import { translateMarkdown } from './translate.js'

const MAX_TRANSLATION_WORKERS = 3

export function presentTagTranslations(tags = [], translations = new Map()) {
  return (Array.isArray(tags) ? tags : []).map(tag => ({
    slug: tag.slug,
    label: translations.get(tag.id)?.label || tag.label,
  }))
}

export async function ensureTagTranslations(database, tags, { sourceLocale, targetLocale } = {}) {
  const source = String(sourceLocale || '').trim().toLowerCase()
  const target = String(targetLocale || '').trim().toLowerCase()
  const items = Array.isArray(tags) ? tags : []
  if (!items.length || !source || !target || source === target) return presentTagTranslations(items)

  const ids = items.map(tag => tag.id).filter(Boolean)
  if (!ids.length) return presentTagTranslations(items)

  const stored = await database.query(
    `SELECT tag_id, source_label, label, provider
       FROM tag_translations
      WHERE tag_id = ANY($1::uuid[])
        AND source_locale = $2
        AND locale = $3`,
    [ids, source, target],
  )
  const tagById = new Map(items.map(tag => [tag.id, tag]))
  const translations = new Map(
    stored.rows
      .filter(row => tagById.get(row.tag_id)?.label === row.source_label)
      .map(row => [row.tag_id, row]),
  )
  const missing = items.filter(tag => tag.id && !translations.has(tag.id))
  let cursor = 0

  async function worker() {
    while (cursor < missing.length) {
      const tag = missing[cursor]
      cursor += 1
      try {
        const translated = await translateMarkdown({
          body: tag.label,
          sourceLocale: source,
          targetLocale: target,
        })
        const label = String(translated.body || '').replace(/\s+/gu, ' ').trim().slice(0, 80)
        if (!label) continue
        const inserted = await database.query(
          `INSERT INTO tag_translations (tag_id, source_locale, locale, source_label, label, provider)
           VALUES ($1, $2, $3, $4, $5, $6)
           ON CONFLICT (tag_id, source_locale, locale) DO UPDATE
             SET source_label = EXCLUDED.source_label,
                 label = EXCLUDED.label,
                 provider = EXCLUDED.provider,
                 updated_at = now()
           RETURNING tag_id, source_label, label, provider`,
          [tag.id, source, target, tag.label, label, translated.provider],
        )
        if (inserted.rows[0]) translations.set(tag.id, inserted.rows[0])
      } catch (error) {
        console.error(`[translation] tag ${tag.slug} stayed in its source language`, error.message)
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(MAX_TRANSLATION_WORKERS, missing.length) }, () => worker()))
  return presentTagTranslations(items, translations)
}
