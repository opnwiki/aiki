import { createError, readBody } from 'h3'
import { enforceSameOrigin, requireHumanActor } from '../../../../utils/auth.js'
import { getDatabase } from '../../../../utils/database.js'
import { syncFederatedReply } from '../../../../utils/federation-outbound.js'
import { enforceRateLimit } from '../../../../utils/rate-limit.js'
import { readableTopicSql } from '../../../../utils/page-access.js'
import { topicKeyPredicate } from '../../../../utils/page-address.js'
import { validateReply } from '../../../../utils/validation.js'

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export default defineEventHandler(async (event) => {
  enforceSameOrigin(event)
  const actor = await requireHumanActor(event)
  await enforceRateLimit(event, { action: 'reply-edit', limit: 30 })

  const slug = getRouterParam(event, 'slug')
  const replyId = String(getRouterParam(event, 'replyId') || '').trim().toLowerCase()
  if (!slug || !/^[\p{L}\p{N}]+(?:-[\p{L}\p{N}]+)*$/u.test(slug) || !UUID_PATTERN.test(replyId)) {
    throw createError({ statusCode: 404, statusMessage: 'Reply not found.' })
  }

  const body = await readBody(event)
  const unknownKey = Object.keys(body || {}).find(key => !['body', 'anonymous'].includes(key))
  if (unknownKey) throw createError({ statusCode: 400, statusMessage: `Unknown reply field: ${unknownKey}` })

  const client = await getDatabase().connect()
  let reply
  try {
    await client.query('BEGIN')
    const found = await client.query(
      `SELECT r.id, r.topic_id, r.author_id, r.locale, r.status
         FROM replies r
         JOIN topics t ON t.id = r.topic_id
        WHERE ${topicKeyPredicate('t', '$1')}
          AND ${readableTopicSql('t', '$2')}
          AND r.id = $3::uuid
          AND r.status = 'published'
        FOR UPDATE OF r`,
      [slug, actor.id, replyId],
    )
    const current = found.rows[0]
    if (!current) throw createError({ statusCode: 404, statusMessage: 'Reply not found.' })
    if (current.author_id !== actor.id) throw createError({ statusCode: 403, statusMessage: 'Only your own replies can be edited.' })

    const checked = validateReply({
      body: body?.body,
      locale: current.locale,
      anonymous: body?.anonymous === true,
    })
    if (!checked.ok) throw createError({ statusCode: 400, statusMessage: 'Please correct the reply.', data: { errors: checked.errors } })

    const updated = await client.query(
      `UPDATE replies
          SET body_markdown = $2, author_hidden = $3, updated_at = now()
        WHERE id = $1
      RETURNING id, topic_id, parent_reply_id, author_id, locale, body_markdown, author_hidden, created_at, updated_at`,
      [replyId, checked.value.body, checked.value.anonymous],
    )
    reply = updated.rows[0]

    await client.query('DELETE FROM reply_translations WHERE reply_id = $1', [replyId])
    await client.query('UPDATE topics SET updated_at = now() WHERE id = $1', [current.topic_id])
    await client.query(
      `INSERT INTO actor_audit_log (actor_id, action, target_type, target_id, details)
       VALUES ($1, 'reply_updated', 'reply', $2,
               jsonb_build_object('author_hidden', $3::boolean))`,
      [actor.id, replyId, checked.value.anonymous],
    )
    await client.query('COMMIT')
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }

  // Edits and anonymity changes are mirrored on the Fediverse copy.
  void syncFederatedReply(getDatabase(), replyId).catch(() => {})
  return { reply }
})
