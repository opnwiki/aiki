import { createError, readBody } from 'h3'
import { enforceSameOrigin, getHumanActor } from '../../../utils/auth.js'
import { getDatabase } from '../../../utils/database.js'
import { nextTopicStatus, presentAccess, readableTopicSql } from '../../../utils/page-access.js'
import { checkPageContent } from '../../../utils/moderation.js'
import { topicKeyPredicate } from '../../../utils/page-address.js'

export default defineEventHandler(async (event) => {
  enforceSameOrigin(event)
  const actor = await getHumanActor(event)
  if (!actor) throw createError({ statusCode: 401, statusMessage: 'Sign in to continue' })

  const slug = getRouterParam(event, 'slug')
  if (!slug || !/^[\p{L}\p{N}]+(?:-[\p{L}\p{N}]+)*$/u.test(slug)) {
    throw createError({ statusCode: 404, statusMessage: 'Topic not found' })
  }
  const access = String((await readBody(event))?.access || '')
  const client = await getDatabase().connect()
  try {
    await client.query('BEGIN')
    const selected = await client.query(
      `SELECT id, author_id, status
         FROM topics
        WHERE ${topicKeyPredicate('topics', '$1')} AND ${readableTopicSql('topics', '$2')}
        FOR UPDATE`,
      [slug, actor.id],
    )
    const topic = selected.rows[0]
    if (!topic) throw createError({ statusCode: 404, statusMessage: 'Topic not found' })
    const status = nextTopicStatus(topic, actor, access)
    if (!status) throw createError({ statusCode: 400, statusMessage: 'Choose a page access this account can set.' })
    const updated = await client.query(
      `UPDATE topics SET status = $2, updated_at = now() WHERE id = $1 RETURNING id, author_id, status`,
      [topic.id, status],
    )
    await client.query(
      `INSERT INTO actor_audit_log (actor_id, action, target_type, target_id, details)
       VALUES ($1, 'topic_access', 'topic', $2, jsonb_build_object('from', $3::text, 'to', $4::text))`,
      [actor.id, topic.id, topic.status, status],
    )
    await client.query('COMMIT')
    let presented = updated.rows[0]
    if (presented.status === 'published' && topic.status !== 'published') {
      const article = await client.query(
        `SELECT r.title, r.body_markdown
           FROM topic_current_revisions current
           JOIN revisions r ON r.id = current.revision_id
          WHERE current.topic_id = $1
          ORDER BY (current.locale = 'en') DESC, current.locale
          LIMIT 1`,
        [presented.id],
      )
      await checkPageContent(getDatabase(), {
        topicId: presented.id,
        trigger: 'republish',
        article: { title: article.rows[0]?.title, body: article.rows[0]?.body_markdown },
      })
      const fresh = await client.query(`SELECT id, author_id, status FROM topics WHERE id = $1`, [presented.id])
      presented = fresh.rows[0] || presented
    }
    return presentAccess(presented, actor)
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
})
