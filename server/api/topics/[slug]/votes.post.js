import { createError, getRouterParam, readBody } from 'h3'
import { enforceSameOrigin, requireHumanActor } from '../../../utils/auth.js'
import { getDatabase } from '../../../utils/database.js'
import { enforceRateLimit } from '../../../utils/rate-limit.js'
import { readableTopicSql } from '../../../utils/page-access.js'
import { presentReplyVote } from '../../../utils/replies.js'
import { validateReplyVote } from '../../../utils/validation.js'
import { topicKeyPredicate } from '../../../utils/page-address.js'
import { federateVote } from '../../../utils/federation-outbound-likes.js'

const SLUG_PATTERN = /^[\p{L}\p{N}]+(?:-[\p{L}\p{N}]+)*$/u

export default defineEventHandler(async (event) => {
  enforceSameOrigin(event)
  const actor = await requireHumanActor(event)
  await enforceRateLimit(event, { action: 'topic-vote', limit: 60 })

  const slug = getRouterParam(event, 'slug')
  if (!slug || !SLUG_PATTERN.test(slug)) throw createError({ statusCode: 404, statusMessage: 'Topic not found.' })
  const checked = validateReplyVote(await readBody(event))
  if (!checked.ok) throw createError({ statusCode: 400, statusMessage: 'Vote must be 1, -1, or 0.' })

  const client = await getDatabase().connect()
  try {
    await client.query('BEGIN')
    const topic = await client.query(
      `SELECT t.id
         FROM topics t
        WHERE ${topicKeyPredicate('t', '$1')}
          AND ${readableTopicSql('t', '$2')}
        FOR UPDATE OF t`,
      [slug, actor.id],
    )
    if (!topic.rows[0]) throw createError({ statusCode: 404, statusMessage: 'Topic not found.' })

    const topicId = topic.rows[0].id
    const myVote = checked.value === 0 ? null : checked.value
    if (myVote == null) {
      await client.query(
        `DELETE FROM votes
          WHERE actor_id = $1::uuid AND target_type = 'topic' AND target_id = $2::uuid`,
        [actor.id, topicId],
      )
    } else {
      await client.query(
        `INSERT INTO votes (actor_id, target_type, target_id, value)
         VALUES ($1::uuid, 'topic', $2::uuid, $3::smallint)
         ON CONFLICT (actor_id, target_type, target_id)
         DO UPDATE SET value = EXCLUDED.value`,
        [actor.id, topicId, myVote],
      )
    }

    const totals = await client.query(
      `SELECT count(*) FILTER (WHERE value = 1)::int AS upvotes,
              count(*) FILTER (WHERE value = -1)::int AS downvotes
         FROM votes
        WHERE target_type = 'topic' AND target_id = $1::uuid`,
      [topicId],
    )
    await client.query(
      `INSERT INTO actor_audit_log (actor_id, action, target_type, target_id, details)
       VALUES ($1::uuid, 'topic_voted', 'topic', $2::text, jsonb_build_object('value', $3::int))`,
      [actor.id, topicId, checked.value],
    )
    await client.query('COMMIT')
    // A copied Fediverse post gets the upvote as a Like; delivery runs aside.
    void federateVote(getDatabase(), { actorId: actor.id, targetType: 'topic', targetId: topicId, value: checked.value })
    return { vote: { topic_id: topicId, ...presentReplyVote(totals.rows[0], myVote) } }
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
})
