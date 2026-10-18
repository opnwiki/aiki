import { createError } from 'h3'
import { getHumanActor } from '../../../utils/auth.js'
import { queryDatabase, getDatabase } from '../../../utils/database.js'
import { readableTopicSql } from '../../../utils/page-access.js'
import { ensureTopicDiffs, presentChange, REVISION_DIFF_COLUMNS, REVISION_DIFF_JOIN } from '../../../utils/revision-history.js'
import { topicKeyPredicate } from '../../../utils/page-address.js'

export default defineEventHandler(async (event) => {
  const slug = getRouterParam(event, 'slug')
  if (!slug || !/^[\p{L}\p{N}]+(?:-[\p{L}\p{N}]+)*$/u.test(slug)) {
    throw createError({ statusCode: 404, statusMessage: 'Topic not found.' })
  }
  const viewer = await getHumanActor(event)
  const topic = await queryDatabase(
    `SELECT id FROM topics WHERE ${topicKeyPredicate('topics', '$1')} AND ${readableTopicSql('topics', '$2')} LIMIT 1`,
    [slug, viewer?.id || null],
  )
  if (!topic.rows[0]) throw createError({ statusCode: 404, statusMessage: 'Page not found.' })

  const query = getQuery(event)
  const locale = String(query.locale || 'en')
  if (!/^[a-z]{2}$/.test(locale)) throw createError({ statusCode: 400, statusMessage: 'Invalid locale.' })
  await ensureTopicDiffs(getDatabase(), topic.rows[0].id)

  const result = await queryDatabase(
    `SELECT revision.id, revision.parent_revision_id, revision.locale, revision.title, revision.body_markdown, revision.created_at,
            ${REVISION_DIFF_COLUMNS}
       FROM revisions revision
       ${REVISION_DIFF_JOIN}
      WHERE revision.topic_id = $1 AND revision.locale = $2
      ORDER BY revision.created_at ASC, revision.id ASC
      LIMIT 200`,
    [topic.rows[0].id, locale],
  )
  const count = await queryDatabase(
    'SELECT count(*)::int AS total FROM revisions WHERE topic_id = $1 AND locale = $2',
    [topic.rows[0].id, locale],
  )
  const total = count.rows[0]?.total || 0
  return {
    locale,
    total,
    complete: total <= result.rows.length,
    items: result.rows.map(row => presentChange(row, { includeOps: true })),
  }
})
