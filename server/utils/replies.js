import { createError } from 'h3'

export const MAX_REPLY_DEPTH = 12

export async function requirePublishedParent(client, topicId, parentReplyId) {
  if (!parentReplyId) return null
  const result = await client.query(
    `WITH RECURSIVE chain AS (
       SELECT id, parent_reply_id, 1 AS depth
         FROM replies
        WHERE id = $1::uuid AND topic_id = $2::uuid AND status = 'published'
       UNION ALL
       SELECT parent.id, parent.parent_reply_id, chain.depth + 1
         FROM replies parent
         JOIN chain ON parent.id = chain.parent_reply_id
        WHERE parent.topic_id = $2::uuid
          AND parent.status = 'published'
          AND chain.depth < $3::int
     )
     SELECT count(*)::int AS found, coalesce(max(depth), 0)::int AS depth
       FROM chain`,
    [parentReplyId, topicId, MAX_REPLY_DEPTH],
  )
  const row = result.rows[0]
  if (!row?.found) {
    throw createError({ statusCode: 400, statusMessage: 'Reply to a published comment on this page.' })
  }
  if (row.depth >= MAX_REPLY_DEPTH) {
    throw createError({ statusCode: 400, statusMessage: 'This thread is already as deep as replies can go.' })
  }
  return parentReplyId
}

// The same text from the same author on the same page within a day is spam,
// not a new contribution.
export async function rejectDuplicateReply(client, { topicId, authorId, body }) {
  const duplicate = await client.query(
    `SELECT 1 FROM replies
      WHERE topic_id = $1 AND author_id = $2 AND body_markdown = $3
        AND status = 'published' AND created_at > now() - interval '1 day'
      LIMIT 1`,
    [topicId, authorId, body],
  )
  if (duplicate.rows[0]) throw createError({ statusCode: 409, statusMessage: 'You already posted this exact reply on this page today.' })
}

export function presentReplyVote(row, myVote) {
  const upvotes = Number(row?.upvotes) || 0
  const downvotes = Number(row?.downvotes) || 0
  const vote = myVote == null || myVote === '' ? null : Number(myVote)
  return {
    upvotes,
    downvotes,
    score: upvotes - downvotes,
    my_vote: vote === 1 || vote === -1 ? vote : null,
  }
}
