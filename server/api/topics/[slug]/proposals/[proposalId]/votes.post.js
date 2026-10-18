import { createError, readBody } from 'h3'
import { enforceSameOrigin, requireHumanActor } from '../../../../../utils/auth.js'
import { getDatabase } from '../../../../../utils/database.js'
import { enforceRateLimit } from '../../../../../utils/rate-limit.js'
import { readableTopicSql } from '../../../../../utils/page-access.js'
import { presentReplyVote } from '../../../../../utils/replies.js'
import { validateReplyVote } from '../../../../../utils/validation.js'
import { topicKeyPredicate } from '../../../../../utils/page-address.js'

const SLUG_PATTERN = /^[\p{L}\p{N}]+(?:-[\p{L}\p{N}]+)*$/u
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export default defineEventHandler(async (event) => {
  enforceSameOrigin(event)
  const actor = await requireHumanActor(event)
  await enforceRateLimit(event, { action: 'proposal-vote', limit: 60 })
  const slug = getRouterParam(event, 'slug')
  const proposalId = String(getRouterParam(event, 'proposalId') || '').toLowerCase()
  if (!slug || !SLUG_PATTERN.test(slug) || !UUID_PATTERN.test(proposalId)) {
    throw createError({ statusCode: 404, statusMessage: 'Proposal not found.' })
  }
  const checked = validateReplyVote(await readBody(event))
  if (!checked.ok) throw createError({ statusCode: 400, statusMessage: 'Vote must be 1, -1, or 0.' })

  const client = await getDatabase().connect()
  try {
    await client.query('BEGIN')
    const selected = await client.query(
      `SELECT p.id
         FROM edit_proposals p
         JOIN topics t ON t.id = p.topic_id
        WHERE ${topicKeyPredicate('t', '$1')} AND p.id = $2::uuid AND p.status = 'open' AND ${readableTopicSql('t', '$3')}
        FOR UPDATE OF p`,
      [slug, proposalId, actor.id],
    )
    if (!selected.rows[0]) throw createError({ statusCode: 404, statusMessage: 'Proposal not found.' })
    const myVote = checked.value === 0 ? null : checked.value
    if (myVote == null) {
      await client.query(
        `DELETE FROM votes WHERE actor_id = $1::uuid AND target_type = 'proposal' AND target_id = $2::uuid`,
        [actor.id, proposalId],
      )
    } else {
      await client.query(
        `INSERT INTO votes (actor_id, target_type, target_id, value)
         VALUES ($1::uuid, 'proposal', $2::uuid, $3::smallint)
         ON CONFLICT (actor_id, target_type, target_id)
         DO UPDATE SET value = EXCLUDED.value`,
        [actor.id, proposalId, myVote],
      )
    }
    const totals = await client.query(
      `SELECT count(*) FILTER (WHERE value = 1)::int AS upvotes,
              count(*) FILTER (WHERE value = -1)::int AS downvotes
         FROM votes
        WHERE target_type = 'proposal' AND target_id = $1::uuid`,
      [proposalId],
    )
    await client.query(
      `INSERT INTO actor_audit_log (actor_id, action, target_type, target_id, details)
       VALUES ($1::uuid, 'proposal_voted', 'proposal', $2::text, jsonb_build_object('value', $3::int))`,
      [actor.id, proposalId, checked.value],
    )
    await client.query('COMMIT')
    return { vote: { proposal_id: proposalId, ...presentReplyVote(totals.rows[0], myVote) } }
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
})
