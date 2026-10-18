import { queryDatabase } from '../utils/database.js'
import { normalizeTag } from '../utils/tags.js'

export default defineEventHandler(async (event) => {
  const query = getQuery(event)
  const rawQuery = String(query.q || '').trim().slice(0, 48)
  const normalizedQuery = normalizeTag(rawQuery)?.slug || ''
  const requestedLimit = Number.parseInt(String(query.limit || '10'), 10)
  const limit = Number.isFinite(requestedLimit) ? Math.min(Math.max(requestedLimit, 1), 20) : 10
  const result = await queryDatabase(
    `SELECT tg.slug, tg.label, count(DISTINCT tt.topic_id)::int AS usage_count
       FROM tags tg
       JOIN topic_tags tt ON tt.tag_id = tg.id
       JOIN topics t ON t.id = tt.topic_id
      WHERE tg.node_id IS NOT DISTINCT FROM (SELECT id FROM nodes WHERE is_home LIMIT 1)
        AND t.status = 'published'
        AND ($1 = '' OR tg.slug ILIKE '%' || $1 || '%' OR tg.label ILIKE '%' || $2 || '%')
      GROUP BY tg.id, tg.slug, tg.label
      ORDER BY usage_count DESC, tg.label, tg.slug
      LIMIT $3`,
    [normalizedQuery, rawQuery, limit],
  )
  return { tags: result.rows, query: rawQuery, limit }
})
