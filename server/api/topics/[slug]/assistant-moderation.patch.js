import { createError, readBody } from 'h3'
import { enforceSameOrigin, requireNodeAdmin } from '../../../utils/auth.js'
import { getDatabase } from '../../../utils/database.js'
import { enforceRateLimit } from '../../../utils/rate-limit.js'
import { topicKeyPredicate } from '../../../utils/page-address.js'

const SLUG_PATTERN = /^[\p{L}\p{N}]+(?:-[\p{L}\p{N}]+)*$/u

export default defineEventHandler(async (event) => {
  enforceSameOrigin(event)
  const actor = await requireNodeAdmin(event)
  await enforceRateLimit(event, { action: 'assistant-moderation', limit: 20 })
  const slug = getRouterParam(event, 'slug')
  if (!slug || !SLUG_PATTERN.test(slug)) throw createError({ statusCode: 404, statusMessage: 'Topic not found.' })
  const enabled = (await readBody(event))?.enabled
  if (typeof enabled !== 'boolean') {
    throw createError({ statusCode: 400, statusMessage: 'Choose whether this page is included in the node model check.' })
  }

  const client = await getDatabase().connect()
  try {
    await client.query('BEGIN')
    const selected = await client.query(
      `SELECT id, status FROM topics WHERE ${topicKeyPredicate('topics', '$1')} FOR UPDATE`,
      [slug],
    )
    const topic = selected.rows[0]
    if (!topic || topic.status === 'deleted') throw createError({ statusCode: 404, statusMessage: 'Topic not found.' })
    await client.query(
      `UPDATE topics SET assistant_check = $2, updated_at = now() WHERE id = $1`,
      [topic.id, enabled],
    )
    await client.query(
      `INSERT INTO actor_audit_log (actor_id, action, target_type, target_id, details)
       VALUES ($1::uuid, 'assistant_check_set', 'topic', $2::text, jsonb_build_object('enabled', $3::boolean))`,
      [actor.id, topic.id, enabled],
    )
    await client.query('COMMIT')
    return { assistantCheck: enabled }
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
})
