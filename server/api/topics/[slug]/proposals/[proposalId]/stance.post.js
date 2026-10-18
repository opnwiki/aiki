import { createError, readBody } from 'h3'
import { enforceSameOrigin, requireHumanActor } from '../../../../../utils/auth.js'
import { getDatabase } from '../../../../../utils/database.js'
import { enforceRateLimit } from '../../../../../utils/rate-limit.js'
import { readableTopicSql } from '../../../../../utils/page-access.js'
import { topicKeyPredicate } from '../../../../../utils/page-address.js'

const SLUG_PATTERN = /^[\p{L}\p{N}]+(?:-[\p{L}\p{N}]+)*$/u
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export default defineEventHandler(async (event) => {
  enforceSameOrigin(event)
  const actor = await requireHumanActor(event)
  await enforceRateLimit(event, { action: 'proposal-stance', limit: 30 })
  const slug = getRouterParam(event, 'slug')
  const proposalId = String(getRouterParam(event, 'proposalId') || '').toLowerCase()
  if (!slug || !SLUG_PATTERN.test(slug) || !UUID_PATTERN.test(proposalId)) {
    throw createError({ statusCode: 404, statusMessage: 'Proposal not found.' })
  }
  const stance = (await readBody(event))?.stance
  if (stance !== 'agree' && stance !== 'disagree') {
    throw createError({ statusCode: 400, statusMessage: 'Choose agree or disagree. The edit stays either way.' })
  }

  const client = await getDatabase().connect()
  try {
    await client.query('BEGIN')
    const selected = await client.query(
      `SELECT p.id, t.author_id
         FROM edit_proposals p
         JOIN topics t ON t.id = p.topic_id
        WHERE ${topicKeyPredicate('t', '$1')} AND p.id = $2::uuid AND ${readableTopicSql('t', '$3')}
        FOR UPDATE OF p`,
      [slug, proposalId, actor.id],
    )
    const proposal = selected.rows[0]
    if (!proposal) throw createError({ statusCode: 404, statusMessage: 'Proposal not found.' })
    if (proposal.author_id !== actor.id) {
      throw createError({ statusCode: 403, statusMessage: 'Only the page author records agreement or disagreement.' })
    }
    await client.query(`UPDATE edit_proposals SET author_stance = $2 WHERE id = $1`, [proposal.id, stance])
    await client.query(
      `INSERT INTO actor_audit_log (actor_id, action, target_type, target_id, details)
       VALUES ($1::uuid, 'proposal_author_stance', 'proposal', $2::text, jsonb_build_object('stance', $3::text))`,
      [actor.id, proposal.id, stance],
    )
    await client.query('COMMIT')
    return { id: proposal.id, author_stance: stance }
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
})
