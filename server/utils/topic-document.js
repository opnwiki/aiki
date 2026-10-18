import { createError, getQuery } from 'h3'
import { queryDatabase, getDatabase } from './database.js'
import { loadImportProvenance } from './integration-imports.js'
import { topicKeyPredicate } from './page-address.js'
import { SUPPORTED_LOCALES } from './validation.js'
import { actorDisplayNameSql } from './actor-display.js'
import { authorHiddenSql } from './author-visibility.js'

const SLUG_PATTERN = /^[\p{L}\p{N}]+(?:-[\p{L}\p{N}]+)*$/u

function routeSlug(event) {
  const segment = decodeURIComponent(String(event.path || '').split('?')[0].split('/').filter(Boolean)[0] || '')
  return segment.replace(/\.(md|txt|json|jsonld)$/i, '')
}

export async function loadPublishedTopic(event, slug = routeSlug(event)) {
  if (!slug || !SLUG_PATTERN.test(slug)) {
    throw createError({ statusCode: 404, statusMessage: 'Topic not found' })
  }
  const requestedLocale = String(getQuery(event).locale || 'en')
  const locale = SUPPORTED_LOCALES.includes(requestedLocale) ? requestedLocale : 'en'
  const result = await queryDatabase(
    `SELECT t.id, t.slug, t.page_number, t.kind, t.created_at, t.hide_author,
            ${authorHiddenSql('t', 'a')} AS effective_hide_author, r.authorship_mode, r.model_name, r.human_contribution,
            r.id AS revision_id, r.locale, r.title, r.body_markdown,
            coalesce(nullif(r.summary, ''), CASE WHEN r.source_revision_id IS NULL THEN nullif(t.summary, '') ELSE NULL END) AS summary,
            r.created_at AS revision_created_at,
            CASE WHEN ${authorHiddenSql('t', 'a')} THEN NULL ELSE a.username END AS author,
            CASE WHEN ${authorHiddenSql('t', 'a')} THEN NULL ELSE ${actorDisplayNameSql('a', 'NULL')} END AS author_display_name
       FROM topics t
       JOIN topic_current_revisions current ON current.topic_id = t.id AND current.locale = $2
       JOIN revisions r ON r.id = current.revision_id
       LEFT JOIN actors a ON a.id = t.author_id
      WHERE ${topicKeyPredicate('t', '$1')} AND t.status = 'published'`,
    [slug, locale],
  )
  const topic = result.rows[0]
  if (!topic) throw createError({ statusCode: 404, statusMessage: 'Topic not found' })
  const [citations, replies] = await Promise.all([
    queryDatabase(
      `SELECT s.canonical_url, s.title, s.publisher, c.locator, c.note
         FROM citations c JOIN sources s ON s.id = c.source_id
        WHERE c.revision_id = $1 ORDER BY c.retrieved_at, c.id`,
      [topic.revision_id],
    ),
    queryDatabase(
      `SELECT r.body_markdown, r.created_at, r.author_hidden, a.username AS author, ${actorDisplayNameSql('a', 'NULL')} AS author_display_name
         FROM replies r
         LEFT JOIN actors a ON a.id = r.author_id
        WHERE r.topic_id = $1 AND r.status = 'published'
        ORDER BY r.created_at ASC, r.id ASC LIMIT 100`,
      [topic.id],
    ),
  ])
  topic.citations = citations.rows
  topic.replies = replies.rows.map(reply => ({
    ...reply,
    author: reply.author_hidden ? null : reply.author,
    anonymous: Boolean(reply.author_hidden),
  }))
  topic.hideAuthor = Boolean(topic.effective_hide_author)
  topic.import = await loadImportProvenance(getDatabase(), topic.id, topic.revision_id, { hideAuthor: topic.hideAuthor })
  if (topic.hideAuthor) topic.author = null
  delete topic.hide_author
  delete topic.effective_hide_author
  return topic
}
