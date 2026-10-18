import { createError } from 'h3'
import { enforceSameOrigin, requireHumanActor } from '../../../../utils/auth.js'
import { getDatabase } from '../../../../utils/database.js'
import { syncFederatedReply } from '../../../../utils/federation-outbound.js'
import { enforceRateLimit } from '../../../../utils/rate-limit.js'
import { readableTopicSql } from '../../../../utils/page-access.js'
import { topicKeyPredicate } from '../../../../utils/page-address.js'

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export default defineEventHandler(async (event) => {
  enforceSameOrigin(event)
  const actor = await requireHumanActor(event)
  await enforceRateLimit(event, { action: 'reply-delete', limit: 30 })

  const slug = getRouterParam(event, 'slug')
  const replyId = String(getRouterParam(event, 'replyId') || '').trim().toLowerCase()
  if (!slug || !/^[\p{L}\p{N}]+(?:-[\p{L}\p{N}]+)*$/u.test(slug) || !UUID_PATTERN.test(replyId)) {
    throw createError({ statusCode: 404, statusMessage: 'Reply not found.' })
  }

  const client = await getDatabase().connect()
  try {
    await client.query('BEGIN')
    const found = await client.query(
      `SELECT r.id, r.topic_id, r.author_id, r.status
         FROM replies r
         JOIN topics t ON t.id = r.topic_id
        WHERE ${topicKeyPredicate('t', '$1')}
          AND ${readableTopicSql('t', '$2')}
          AND r.id = $3::uuid
        FOR UPDATE OF r`,
      [slug, actor.id, replyId],
    )
    const current = found.rows[0]
    if (!current || current.status !== 'published') throw createError({ statusCode: 404, statusMessage: 'Reply not found.' })
    if (current.author_id !== actor.id) throw createError({ statusCode: 403, statusMessage: 'Only your own replies can be deleted.' })

    await client.query(
      `UPDATE replies
          SET status = 'deleted', updated_at = now()
        WHERE id = $1`,
      [replyId],
    )
    await client.query('DELETE FROM reply_translations WHERE reply_id = $1', [replyId])
    await client.query('UPDATE topics SET updated_at = now() WHERE id = $1', [current.topic_id])
    await client.query(
      `INSERT INTO actor_audit_log (actor_id, action, target_type, target_id)
       VALUES ($1, 'reply_deleted', 'reply', $2)`,
      [actor.id, replyId],
    )
    await client.query('COMMIT')
    // Mirror the deletion on the Fediverse copy of the reply.
    void syncFederatedReply(getDatabase(), replyId).catch(() => {})
    return { reply: { id: replyId, status: 'deleted' } }
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
})
