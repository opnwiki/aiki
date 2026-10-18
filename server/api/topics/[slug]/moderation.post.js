import { createError, readBody } from 'h3'
import { enforceSameOrigin, requireHumanActor } from '../../../utils/auth.js'
import { getDatabase } from '../../../utils/database.js'
import { enforceRateLimit } from '../../../utils/rate-limit.js'
import { presentAccess } from '../../../utils/page-access.js'
import { checkPageContent, reviewerCanDecide } from '../../../utils/moderation.js'
import { topicKeyPredicate } from '../../../utils/page-address.js'

const SLUG_PATTERN = /^[\p{L}\p{N}]+(?:-[\p{L}\p{N}]+)*$/u

export default defineEventHandler(async (event) => {
  enforceSameOrigin(event)
  const actor = await requireHumanActor(event)
  await enforceRateLimit(event, { action: 'page-moderation', limit: 20 })
  const slug = getRouterParam(event, 'slug')
  if (!slug || !SLUG_PATTERN.test(slug)) throw createError({ statusCode: 404, statusMessage: 'Topic not found.' })
  const input = await readBody(event)
  const action = input?.action === 'approve' ? 'approve' : input?.action === 'reject' ? 'reject' : ''
  const comment = String(input?.comment || '').replace(/[\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim()
  if (!action || comment.length < 8 || comment.length > 2000) {
    throw createError({ statusCode: 400, statusMessage: 'Choose confirm or reject and write a note of 8–2000 characters.' })
  }

  const client = await getDatabase().connect()
  try {
    await client.query('BEGIN')
    const selected = await client.query(
      `SELECT id, author_id, branch_id, status
         FROM topics
        WHERE ${topicKeyPredicate('topics', '$1')}
        FOR UPDATE`,
      [slug],
    )
    const topic = selected.rows[0]
    if (!topic || topic.status === 'deleted') throw createError({ statusCode: 404, statusMessage: 'Topic not found.' })
    if (topic.status !== 'pending') throw createError({ statusCode: 409, statusMessage: 'This page is not waiting for a person.' })
    if (!(await reviewerCanDecide(client, actor, topic))) {
      throw createError({ statusCode: 403, statusMessage: 'A node moderator or a branch moderator confirms this page. The author does not.' })
    }
    const status = action === 'approve' ? 'published' : 'hidden'
    await client.query(
      `UPDATE topics SET status = $2, updated_at = now() WHERE id = $1`,
      [topic.id, status],
    )
    await client.query(
      `INSERT INTO actor_audit_log (actor_id, action, target_type, target_id, details)
       VALUES ($1::uuid, $2, 'topic', $3::text, jsonb_build_object('comment', $4::text, 'status', $5::text))`,
      [actor.id, action === 'approve' ? 'page_moderation_approved' : 'page_moderation_rejected', topic.id, comment, status],
    )
    await client.query('COMMIT')
    let finalStatus = status
    if (status === 'published') {
      const article = await client.query(
        `SELECT r.title, r.body_markdown
           FROM topic_current_revisions current
           JOIN revisions r ON r.id = current.revision_id
          WHERE current.topic_id = $1
          ORDER BY (current.locale = 'en') DESC, current.locale
          LIMIT 1`,
        [topic.id],
      )
      await checkPageContent(getDatabase(), {
        topicId: topic.id,
        trigger: 'republish',
        article: { title: article.rows[0]?.title, body: article.rows[0]?.body_markdown },
      })
      const fresh = await client.query(`SELECT status FROM topics WHERE id = $1`, [topic.id])
      finalStatus = fresh.rows[0]?.status || status
    }
    return presentAccess({ status: finalStatus, author_id: topic.author_id }, actor)
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
})
