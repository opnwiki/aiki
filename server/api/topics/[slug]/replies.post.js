import { createError, readBody, setResponseStatus } from 'h3'
import { enforceSameOrigin, requireHumanActor } from '../../../utils/auth.js'
import { getDatabase } from '../../../utils/database.js'
import { enforceContentQuota, enforceRateLimit } from '../../../utils/rate-limit.js'
import { notifyReply } from '../../../utils/notifications.js'
import { rejectDuplicateReply, requirePublishedParent } from '../../../utils/replies.js'
import { readableTopicSql } from '../../../utils/page-access.js'
import { validateCitation, validateReply } from '../../../utils/validation.js'
import { clientLabelFromUserAgent } from '../../../utils/client-label.js'
import { topicKeyPredicate } from '../../../utils/page-address.js'
import { ensureContentTasks } from '../../../utils/content-tasks.js'
import { enqueueFederationReply } from '../../../utils/federation-outbound.js'

export default defineEventHandler(async (event) => {
  enforceSameOrigin(event)
  const actor = await requireHumanActor(event)
  await enforceRateLimit(event, { action: 'reply-create', limit: 30, actor })
  await enforceContentQuota(event, actor, 'reply')

  const slug = getRouterParam(event, 'slug')
  if (!slug || !/^[\p{L}\p{N}]+(?:-[\p{L}\p{N}]+)*$/u.test(slug)) {
    throw createError({ statusCode: 404, statusMessage: 'Topic not found.' })
  }

  const body = await readBody(event)
  const checked = validateReply(body)
  if (!checked.ok) throw createError({ statusCode: 400, statusMessage: 'Please correct the reply.', data: { errors: checked.errors } })

  let citation = null
  if (body.source && Object.values(body.source).some(value => String(value || '').trim())) {
    citation = validateCitation(body.source)
    if (!citation.ok) throw createError({ statusCode: 400, statusMessage: 'Please correct the source details.', data: { errors: citation.errors } })
  }

  const client = await getDatabase().connect()
  let reply
  try {
    await client.query('BEGIN')
    const topicResult = await client.query(
      `SELECT id, discussion_enabled, accept_replies FROM topics WHERE ${topicKeyPredicate('topics', '$1')} AND ${readableTopicSql('topics', '$2')} FOR UPDATE`,
      [slug, actor.id],
    )
    if (!topicResult.rows[0]) throw createError({ statusCode: 404, statusMessage: 'Topic not found.' })
    if (topicResult.rows[0].discussion_enabled === false || topicResult.rows[0].accept_replies === false) {
      throw createError({ statusCode: 409, statusMessage: 'Replies are disabled for this topic.' })
    }
    const topicId = topicResult.rows[0].id
    const parentReplyId = await requirePublishedParent(client, topicId, checked.value.parentReplyId)
    await rejectDuplicateReply(client, { topicId, authorId: actor.id, body: checked.value.body })
    const clientLabel = clientLabelFromUserAgent(event.node.req.headers['user-agent'])

    const inserted = await client.query(
      `INSERT INTO replies (topic_id, parent_reply_id, author_id, author_hidden, locale, body_markdown, client_label)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id, topic_id, parent_reply_id, author_id, locale, body_markdown, created_at, updated_at`,
      [topicId, parentReplyId, actor.id, checked.value.anonymous, checked.value.locale, checked.value.body, clientLabel],
    )
    reply = inserted.rows[0]

    if (citation?.ok) {
      const sourceResult = await client.query(
        `INSERT INTO sources (canonical_url, title, publisher, source_type, published_at)
         VALUES ($1, NULLIF($2::text, ''), NULLIF($3::text, ''), 'external', $4::date)
         ON CONFLICT (canonical_url) DO UPDATE SET
           title = coalesce(sources.title, EXCLUDED.title),
           publisher = coalesce(sources.publisher, EXCLUDED.publisher),
           published_at = coalesce(sources.published_at, EXCLUDED.published_at)
         RETURNING id`,
        [citation.value.url, citation.value.title, citation.value.publisher, citation.value.publishedAt || null],
      )
      await client.query(
        `INSERT INTO citations (topic_id, source_id, reply_id, locator, note)
         VALUES ($1, $2, $3, NULLIF($4::text, ''), NULLIF($5::text, ''))`,
        [topicId, sourceResult.rows[0].id, reply.id, citation.value.locator, citation.value.note],
      )
    }

    await client.query('UPDATE topics SET updated_at = now() WHERE id = $1', [topicId])
    await client.query(
      `INSERT INTO actor_audit_log (actor_id, action, target_type, target_id)
       VALUES ($1, 'reply_created', 'reply', $2)`,
      [actor.id, reply.id],
    )
    await notifyReply(client, {
      topicId,
      replyId: reply.id,
      authorId: actor.id,
      parentReplyId: parentReplyId || null,
    })
    await client.query(
      `UPDATE content_tasks
          SET status = 'resolved', claimed_by = NULL, claim_actor_label = NULL,
              claim_expires_at = NULL, updated_at = now()
        WHERE topic_id = $1 AND task_type = 'answer_question'
          AND status <> 'resolved'`,
      [topicId],
    )
    await ensureContentTasks(client, { topicId, creatorId: actor.id })
    await client.query('COMMIT')
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }

  let federation = null
  try {
    federation = await enqueueFederationReply(getDatabase(), { replyId: reply.id })
  } catch (error) {
    console.error('[fedify] could not queue local reply', error)
  }

  setResponseStatus(event, 201)
  return { reply: { ...reply, federationDeliveryState: federation?.state || 'none' } }
})
