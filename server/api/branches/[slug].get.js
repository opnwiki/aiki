import { createError } from 'h3'
import { findBranchBySlug } from '../../utils/branches.js'
import { getDatabase, queryDatabase } from '../../utils/database.js'
import { withShortPath } from '../../utils/page-number.js'
import { normalizeBranchSlug, preferredLocale } from '../../utils/validation.js'
import { actorDisplayNameSql } from '../../utils/actor-display.js'

export default defineEventHandler(async (event) => {
  const slug = normalizeBranchSlug(getRouterParam(event, 'slug'))
  if (!slug) throw createError({ statusCode: 404, statusMessage: 'Branch not found' })

  const client = await getDatabase().connect()
  let branch
  try {
    branch = await findBranchBySlug(client, slug)
  } finally {
    client.release()
  }
  if (!branch) throw createError({ statusCode: 404, statusMessage: 'Branch not found' })

  const locale = preferredLocale(getQuery(event).locale)
  const [topics, counted] = await Promise.all([
    queryDatabase(
    `SELECT t.slug, t.page_number, t.kind, t.created_at, r.title, r.locale, ${actorDisplayNameSql('a')} AS author,
            coalesce(replies.reply_count, 0) AS reply_count
       FROM topics t
       JOIN LATERAL (
         SELECT revision_id
           FROM topic_current_revisions
          WHERE topic_id = t.id
          ORDER BY (locale = $2) DESC, (locale = 'en') DESC, locale
          LIMIT 1
       ) current ON true
       JOIN revisions r ON r.id = current.revision_id
       LEFT JOIN actors a ON a.id = t.author_id
       LEFT JOIN LATERAL (
         SELECT count(*)::int AS reply_count FROM replies
          WHERE topic_id = t.id AND status = 'published'
       ) replies ON true
      WHERE t.branch_id = $1 AND t.status = 'published'
      ORDER BY t.created_at DESC, t.slug
      LIMIT 50`,
      [branch.id, locale],
    ),
    queryDatabase(
      `SELECT count(*)::int AS topic_count FROM topics WHERE branch_id = $1 AND status = 'published'`,
      [branch.id],
    ),
  ])

  return {
    branch: {
      slug: branch.slug,
      title: branch.title,
      description: branch.description,
      created_at: branch.created_at,
      leader: branch.leader || null,
      topic_count: counted.rows[0]?.topic_count || 0,
    },
    topics: topics.rows.map(withShortPath),
  }
})
