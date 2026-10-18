import { queryDatabase } from '../utils/database.js'

export default defineEventHandler(async (event) => {
  const query = getQuery(event)
  const search = String(query.q || '').trim().slice(0, 80)
  const requestedLimit = Number.parseInt(String(query.limit || '50'), 10)
  const requestedOffset = Number.parseInt(String(query.offset || '0'), 10)
  const limit = Number.isFinite(requestedLimit) ? Math.min(Math.max(requestedLimit, 1), 50) : 50
  const offset = Number.isFinite(requestedOffset) ? Math.min(Math.max(requestedOffset, 0), 100_000) : 0

  const result = await queryDatabase(
    `SELECT branches.id, branches.slug, branches.title, branches.description, branches.created_at,
            leader.username AS leader,
            (SELECT count(*)::int FROM topics WHERE topics.branch_id = branches.id AND topics.status = 'published') AS topic_count
       FROM branches
       LEFT JOIN LATERAL (
         SELECT actors.username
           FROM branch_roles role
           JOIN actors ON actors.id = role.actor_id
          WHERE role.branch_id = branches.id AND role.role = 'leader'
          ORDER BY role.created_at, actors.username
          LIMIT 1
       ) leader ON true
      WHERE ($1 = '' OR branches.title ILIKE '%' || $1 || '%' OR branches.description ILIKE '%' || $1 || '%')
      ORDER BY branches.created_at DESC, branches.slug
      LIMIT $2 OFFSET $3`,
    [search, limit, offset],
  )
  const countResult = await queryDatabase(
    `SELECT count(*)::int AS total
       FROM branches
      WHERE ($1 = '' OR title ILIKE '%' || $1 || '%' OR description ILIKE '%' || $1 || '%')`,
    [search],
  )
  return {
    items: result.rows.map(presentBranch),
    query: search,
    limit,
    offset,
    total: countResult.rows[0]?.total || 0,
  }
})

function presentBranch(row) {
  return {
    slug: row.slug,
    title: row.title,
    description: row.description,
    created_at: row.created_at,
    leader: row.leader || null,
    topic_count: row.topic_count,
  }
}
