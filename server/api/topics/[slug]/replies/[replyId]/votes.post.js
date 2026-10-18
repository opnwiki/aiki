import { createError, getRouterParam, readBody } from 'h3'
import { enforceSameOrigin, requireHumanActor } from '../../../../../utils/auth.js'
import { getDatabase } from '../../../../../utils/database.js'
import { enforceRateLimit } from '../../../../../utils/rate-limit.js'
import { presentReplyVote } from '../../../../../utils/replies.js'
import { readableTopicSql } from '../../../../../utils/page-access.js'
import { validateReplyVote } from '../../../../../utils/validation.js'
import { topicKeyPredicate } from '../../../../../utils/page-address.js'
import { federateVote } from '../../../../../utils/federation-outbound-likes.js'

const SLUG_PATTERN = /^[\p{L}\p{N}]+(?:-[\p{L}\p{N}]+)*$/u
const REPLY_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

export default defineEventHandler(async (event) => {
  enforceSameOrigin(event)
  const actor = await requireHumanActor(event)
  await enforceRateLimit(event, { action: 'reply-vote', limit: 60 })

  const slug = getRouterParam(event, 'slug')
  const replyId = String(getRouterParam(event, 'replyId') || '').toLowerCase()
  if (!slug || !SLUG_PATTERN.test(slug) || !REPLY_ID_PATTERN.test(replyId)) {
    throw createError({ statusCode: 404, statusMessage: 'Comment not found.' })
  }

  const checked = validateReplyVote(await readBody(event))
  if (!checked.ok) {
    throw createError({ statusCode: 400, statusMessage: 'Vote must be 1, -1, or 0.', data: { errors: checked.errors } })
  }

  const client = await getDatabase().connect()
  try {
    await client.query('BEGIN')
    const reply = await client.query(
      `SELECT r.id
         FROM replies r
         JOIN topics t ON t.id = r.topic_id
        WHERE ${topicKeyPredicate('t', '$1')}
          AND r.id = $2::uuid
          AND ${readableTopicSql('t', '$3')}
          AND r.status = 'published'
        FOR UPDATE OF r`,
      [slug, replyId, actor.id],
    )
    if (!reply.rows[0]) throw createError({ statusCode: 404, statusMessage: 'Comment not found.' })

    const myVote = checked.value === 0 ? null : checked.value
    if (myVote == null) {
      await client.query(
        `DELETE FROM votes
          WHERE actor_id = $1::uuid
            AND target_type = 'reply'
            AND target_id = $2::uuid`,
        [actor.id, replyId],
      )
    } else {
      await client.query(
        `INSERT INTO votes (actor_id, target_type, target_id, value)
         VALUES ($1::uuid, 'reply', $2::uuid, $3::smallint)
         ON CONFLICT (actor_id, target_type, target_id)
         DO UPDATE SET value = EXCLUDED.value`,
        [actor.id, replyId, myVote],
      )
    }

    const totals = await client.query(
      `SELECT count(*) FILTER (WHERE value = 1)::int AS upvotes,
              count(*) FILTER (WHERE value = -1)::int AS downvotes
         FROM votes
        WHERE target_type = 'reply' AND target_id = $1::uuid`,
      [replyId],
    )
    await client.query(
      `INSERT INTO actor_audit_log (actor_id, action, target_type, target_id, details)
       VALUES ($1::uuid, 'reply_voted', 'reply', $2::text, jsonb_build_object('value', $3::int))`,
      [actor.id, replyId, checked.value],
    )
    await client.query('COMMIT')
    // A copied Fediverse reply gets the upvote as a Like; delivery runs aside.
    void federateVote(getDatabase(), { actorId: actor.id, targetType: 'reply', targetId: replyId, value: checked.value })
    return { vote: { reply_id: replyId, ...presentReplyVote(totals.rows[0], myVote) } }
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
})
