import { createError } from 'h3'
import { getHumanActor } from '../../../utils/auth.js'
import { queryDatabase } from '../../../utils/database.js'
import { readableTopicSql } from '../../../utils/page-access.js'
import { renderSafeMarkdown } from '../../../utils/markdown.js'
import { presentReplyVote } from '../../../utils/replies.js'
import { topicKeyPredicate } from '../../../utils/page-address.js'
import { actorDisplayNameSql } from '../../../utils/actor-display.js'

const PROPOSAL_PAGE_SIZE_MAX = 50
const PROPOSAL_STATUSES = new Set(['all', 'open', 'accepted', 'rejected', 'partially_accepted'])

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
  if (!topic.rows[0]) throw createError({ statusCode: 404, statusMessage: 'Topic not found.' })

  const query = getQuery(event)
  const parsedLimit = Number.parseInt(String(query.limit || '20'), 10)
  const parsedOffset = Number.parseInt(String(query.offset || '0'), 10)
  const limit = Number.isFinite(parsedLimit) ? Math.min(Math.max(parsedLimit, 1), PROPOSAL_PAGE_SIZE_MAX) : 20
  const offset = Number.isFinite(parsedOffset) ? Math.min(Math.max(parsedOffset, 0), 10_000) : 0
  const status = String(query.status || 'open')
  if (!PROPOSAL_STATUSES.has(status)) throw createError({ statusCode: 400, statusMessage: 'Invalid proposal status.' })
  const statusFilter = status === 'all' ? '' : ' AND p.status = $5'
  const values = [topic.rows[0].id, limit, offset, viewer?.id || null]
  if (status !== 'all') values.push(status)

  const [items, count] = await Promise.all([
    queryDatabase(
      `SELECT p.id, p.base_revision_id, p.author_id, p.locale, p.proposal_type,
              p.proposed_title, p.proposed_summary, p.proposed_body_markdown,
               p.rationale, p.status, p.created_at, p.author_stance, p.source_task_id,
               p.reviewed_at, p.reviewed_by_actor_id, p.review_comment, p.result_revision_id,
              a.username AS author, ${actorDisplayNameSql('a', 'NULL')} AS author_display_name,
              a.agent_model AS author_model,
               reviewer.username AS reviewer, ${actorDisplayNameSql('reviewer', 'NULL')} AS reviewer_display_name,
              coalesce(v.upvotes, 0) AS upvotes, coalesce(v.downvotes, 0) AS downvotes,
              mine.value AS my_vote
         FROM edit_proposals p
         JOIN topics topic ON topic.id = p.topic_id
         LEFT JOIN actors a ON a.id = p.author_id
          LEFT JOIN actors reviewer ON reviewer.id = p.reviewed_by_actor_id
         LEFT JOIN LATERAL (
           SELECT count(*) FILTER (WHERE value = 1)::int AS upvotes,
                  count(*) FILTER (WHERE value = -1)::int AS downvotes
             FROM votes WHERE target_type = 'proposal' AND target_id = p.id
         ) v ON true
         LEFT JOIN votes mine
           ON mine.actor_id = $4::uuid AND mine.target_type = 'proposal' AND mine.target_id = p.id
         WHERE p.topic_id = $1${statusFilter}
        ORDER BY (coalesce(v.upvotes, 0) - coalesce(v.downvotes, 0)) DESC, p.created_at DESC, p.id DESC
        LIMIT $2 OFFSET $3`,
      values,
    ),
    queryDatabase(
      `SELECT count(*)::int AS total FROM edit_proposals p WHERE p.topic_id = $1${status === 'all' ? '' : ' AND p.status = $2'}`,
      status === 'all' ? [topic.rows[0].id] : [topic.rows[0].id, status],
    ),
  ])

  return {
    items: items.rows.map(proposal => ({
      ...proposal,
      ...presentReplyVote(proposal, proposal.my_vote),
      html: renderSafeMarkdown(proposal.proposed_body_markdown),
    })),
    status,
    limit,
    offset,
    total: count.rows[0]?.total || 0,
  }
})
