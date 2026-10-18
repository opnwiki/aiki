import { createError } from 'h3'
import { getHumanActor } from '../../../utils/auth.js'
import { queryDatabase } from '../../../utils/database.js'
import { readableTopicSql } from '../../../utils/page-access.js'
import { isSlug, listPageActivity } from '../../../utils/page-transfer.js'
import { maskPerson } from '../../../utils/author-privacy.js'
import { topicKeyPredicate } from '../../../utils/page-address.js'
import { effectiveAuthorHidden } from '../../../utils/author-visibility.js'

export default defineEventHandler(async (event) => {
  const slug = getRouterParam(event, 'slug')
  if (!isSlug(slug)) throw createError({ statusCode: 404, statusMessage: 'Topic not found.' })
  const viewer = await getHumanActor(event)
  const topic = await queryDatabase(
    `SELECT topics.id, topics.hide_author, actors.show_author AS author_show_default, actors.username AS author_username
       FROM topics
       LEFT JOIN actors ON actors.id = topics.author_id
      WHERE ${topicKeyPredicate('topics', '$1')} AND ${readableTopicSql('topics', '$2')} LIMIT 1`,
    [slug, viewer?.id || null],
  )
  if (!topic.rows[0]) throw createError({ statusCode: 404, statusMessage: 'Topic not found.' })

  const query = getQuery(event)
  const parsedLimit = Number.parseInt(String(query.limit || '30'), 10)
  const parsedOffset = Number.parseInt(String(query.offset || '0'), 10)
  const limit = Number.isFinite(parsedLimit) ? Math.min(Math.max(parsedLimit, 1), 50) : 30
  const offset = Number.isFinite(parsedOffset) ? Math.min(Math.max(parsedOffset, 0), 10_000) : 0
  const page = await listPageActivity({ query: (text, values) => queryDatabase(text, values) }, topic.rows[0].id, { limit, offset })
  const hiddenName = effectiveAuthorHidden(topic.rows[0].hide_author, topic.rows[0].author_show_default)
    ? topic.rows[0].author_username
    : null
  const items = hiddenName
    ? page.items.map(item => ({
      ...item,
      actor: maskPerson(item.actor, hiddenName),
      other: maskPerson(item.other, hiddenName),
      from: maskPerson(item.from, hiddenName),
    }))
    : page.items
  return { items, limit, offset, total: page.total }
})
