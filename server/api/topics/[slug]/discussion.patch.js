import { createError, readBody } from 'h3'
import { enforceSameOrigin, requireHumanActor } from '../../../utils/auth.js'
import { getDatabase } from '../../../utils/database.js'
import { topicKeyPredicate } from '../../../utils/page-address.js'
import { enforceRateLimit } from '../../../utils/rate-limit.js'

export default defineEventHandler(async (event) => {
  enforceSameOrigin(event)
  const actor = await requireHumanActor(event)
  await enforceRateLimit(event, { action: 'topic-discussion-settings', limit: 30, actor })
  const body = await readBody(event)
  const unknown = Object.keys(body || {}).find(key => !['acceptReplies', 'discussionEnabled', 'federationOutboundMode'].includes(key))
  if (unknown) throw createError({ statusCode: 400, statusMessage: `Unknown discussion setting: ${unknown}` })
  for (const key of ['acceptReplies', 'discussionEnabled']) {
    if (body?.[key] !== undefined && typeof body[key] !== 'boolean') throw createError({ statusCode: 400, statusMessage: `${key} must be true or false.` })
  }
  const mode = body?.federationOutboundMode === undefined ? null : String(body.federationOutboundMode)
  if (mode !== null && !['none', 'auto', 'manual'].includes(mode)) throw createError({ statusCode: 400, statusMessage: 'federationOutboundMode must be none, auto, or manual.' })
  const slug = String(getRouterParam(event, 'slug') || '').trim()
  const database = getDatabase()
  const client = await database.connect()
  try {
    await client.query('BEGIN')
    const updated = await client.query(
      `UPDATE topics
          SET accept_replies = coalesce($2::boolean, accept_replies),
              discussion_enabled = coalesce($3::boolean, discussion_enabled),
              federation_outbound_mode = coalesce($4::text, federation_outbound_mode),
              updated_at = now()
        WHERE ${topicKeyPredicate('topics', '$1')} AND topics.author_id = $5
        RETURNING id, slug, kind, accept_replies, discussion_enabled, federation_outbound_mode`,
      [slug, body?.acceptReplies ?? null, body?.discussionEnabled ?? null, mode, actor.id],
    )
    const topic = updated.rows[0]
    if (!topic) throw createError({ statusCode: 404, statusMessage: 'Topic not found or not owned by this account.' })
    if (topic.discussion_enabled === false || topic.accept_replies === false || topic.federation_outbound_mode !== 'auto') {
      await client.query(
        `UPDATE federation_reply_deliveries SET state = 'paused', updated_at = now()
          WHERE topic_id = $1 AND state IN ('queued', 'retry')`,
        [topic.id],
      )
      await client.query(`UPDATE replies SET federation_delivery_state = 'paused' WHERE topic_id = $1 AND federation_delivery_state IN ('queued', 'retry')`, [topic.id])
    } else if (topic.federation_outbound_mode === 'auto') {
      await client.query(
        `UPDATE federation_reply_deliveries SET state = 'queued', next_attempt_at = now(), updated_at = now(), last_error = NULL
          WHERE topic_id = $1 AND state = 'paused'`,
        [topic.id],
      )
      await client.query(`UPDATE replies SET federation_delivery_state = 'queued' WHERE topic_id = $1 AND federation_delivery_state = 'paused'`, [topic.id])
    }
    await client.query('COMMIT')
    return {
      topic: {
        slug: topic.slug,
        kind: topic.kind,
        acceptReplies: topic.accept_replies !== false,
        discussionEnabled: topic.discussion_enabled !== false,
        federationOutboundMode: topic.federation_outbound_mode,
      },
    }
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally { client.release() }
})
