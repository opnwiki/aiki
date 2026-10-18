import { createError } from 'h3'
import { getHumanActor } from '../../../../utils/auth.js'
import { queryDatabase, getDatabase } from '../../../../utils/database.js'
import { readableTopicSql } from '../../../../utils/page-access.js'
import { ensureTopicDiffs, presentChange, REVISION_DIFF_COLUMNS, REVISION_DIFF_JOIN } from '../../../../utils/revision-history.js'
import { maskAuthorName, maskPerson } from '../../../../utils/author-privacy.js'
import { topicKeyPredicate } from '../../../../utils/page-address.js'
import { actorDisplayNameSql } from '../../../../utils/actor-display.js'
import { effectiveAuthorHidden } from '../../../../utils/author-visibility.js'

const PAGE_SIZE_MAX = 50

export default defineEventHandler(async (event) => {
  const slug = getRouterParam(event, 'slug')
  if (!slug || !/^[\p{L}\p{N}]+(?:-[\p{L}\p{N}]+)*$/u.test(slug)) {
    throw createError({ statusCode: 404, statusMessage: 'Topic not found.' })
  }
  const viewer = await getHumanActor(event)
  const topic = await queryDatabase(
    `SELECT t.id, t.hide_author, author.show_author AS author_show_default, author.username AS author_username
       FROM topics t
       LEFT JOIN actors author ON author.id = t.author_id
      WHERE ${topicKeyPredicate('t', '$1')} AND ${readableTopicSql('t', '$2')} LIMIT 1`,
    [slug, viewer?.id || null],
  )
  if (!topic.rows[0]) throw createError({ statusCode: 404, statusMessage: 'Page not found.' })
  await ensureTopicDiffs(getDatabase(), topic.rows[0].id)

  const query = getQuery(event)
  const locale = String(query.locale || 'en')
  if (!/^[a-z]{2}$/.test(locale)) throw createError({ statusCode: 400, statusMessage: 'Invalid locale.' })
  const parsedLimit = Number.parseInt(String(query.limit || '20'), 10)
  const parsedOffset = Number.parseInt(String(query.offset || '0'), 10)
  const limit = Number.isFinite(parsedLimit) ? Math.min(Math.max(parsedLimit, 1), PAGE_SIZE_MAX) : 20
  const offset = Number.isFinite(parsedOffset) ? Math.min(Math.max(parsedOffset, 0), 10_000) : 0

  const [items, count] = await Promise.all([
    queryDatabase(
      `SELECT revision.id, revision.parent_revision_id, revision.locale, revision.title, revision.summary, revision.created_at,
              (revision.summary IS DISTINCT FROM parent_revision.summary) AS summary_changed,
              author.username AS author, ${actorDisplayNameSql('author', 'NULL')} AS author_display_name, (current.revision_id = revision.id) AS is_current,
              ${REVISION_DIFF_COLUMNS}
         FROM revisions revision
         LEFT JOIN revisions parent_revision ON parent_revision.id = revision.parent_revision_id
         LEFT JOIN actors author ON author.id = revision.author_id
         LEFT JOIN topic_current_revisions current ON current.topic_id = revision.topic_id AND current.locale = revision.locale
         ${REVISION_DIFF_JOIN}
        WHERE revision.topic_id = $1 AND revision.locale = $2
        ORDER BY (current.revision_id = revision.id) DESC, revision.created_at DESC, revision.id DESC LIMIT $3 OFFSET $4`,
      [topic.rows[0].id, locale, limit, offset],
    ),
    queryDatabase('SELECT count(*)::int AS total FROM revisions WHERE topic_id = $1 AND locale = $2', [topic.rows[0].id, locale]),
  ])
  const hiddenName = effectiveAuthorHidden(topic.rows[0].hide_author, topic.rows[0].author_show_default)
    ? topic.rows[0].author_username
    : null
  return {
    items: items.rows.map(row => {
      const change = presentChange(row)
      if (change && hiddenName) {
        change.introducedBy = maskPerson(change.introducedBy, hiddenName)
        change.confirmedBy = maskPerson(change.confirmedBy, hiddenName)
      }
      return {
        id: row.id,
        parent_revision_id: row.parent_revision_id,
        locale: row.locale,
        title: row.title,
        summary: row.summary,
        summary_changed: Boolean(row.summary_changed),
        created_at: row.created_at,
        author: maskAuthorName(row.author, hiddenName),
        author_display_name: hiddenName && row.author === hiddenName ? null : row.author_display_name,
        is_current: row.is_current,
        change,
      }
    }),
    locale,
    limit,
    offset,
    total: count.rows[0]?.total || 0,
  }
})
