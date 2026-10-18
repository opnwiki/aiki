import { createError, readBody } from 'h3'
import { enforceSameOrigin, getHumanActor } from '../../../utils/auth.js'
import { getDatabase } from '../../../utils/database.js'
import { readableTopicSql } from '../../../utils/page-access.js'
import { topicKeyPredicate } from '../../../utils/page-address.js'
import { authorVisibility } from '../../../utils/author-visibility.js'

export default defineEventHandler(async (event) => {
  enforceSameOrigin(event)
  const actor = await getHumanActor(event)
  if (!actor) throw createError({ statusCode: 401, statusMessage: 'Sign in to continue' })

  const slug = getRouterParam(event, 'slug')
  if (!slug || !/^[\p{L}\p{N}]+(?:-[\p{L}\p{N}]+)*$/u.test(slug)) {
    throw createError({ statusCode: 404, statusMessage: 'Topic not found' })
  }
  const input = await readBody(event)
  const hideAuthor = input?.hideAuthor
  if (hideAuthor !== null && typeof hideAuthor !== 'boolean') {
    throw createError({ statusCode: 400, statusMessage: 'Choose whether the author name is hidden or follows the profile default.' })
  }

  const client = await getDatabase().connect()
  try {
    await client.query('BEGIN')
    const selected = await client.query(
      `SELECT id, author_id, hide_author
         FROM topics
        WHERE ${topicKeyPredicate('topics', '$1')} AND ${readableTopicSql('topics', '$2')}
        FOR UPDATE`,
      [slug, actor.id],
    )
    const topic = selected.rows[0]
    if (!topic) throw createError({ statusCode: 404, statusMessage: 'Topic not found' })
    if (topic.author_id !== actor.id) {
      throw createError({ statusCode: 403, statusMessage: 'Only the page author can hide their name.' })
    }
    await client.query(
      `UPDATE topics SET hide_author = $2, updated_at = now() WHERE id = $1`,
      [topic.id, hideAuthor],
    )
    await client.query(
      `INSERT INTO actor_audit_log (actor_id, action, target_type, target_id, details)
       VALUES ($1, 'topic_author_visibility', 'topic', $2, jsonb_build_object('hideAuthor', $3::boolean))`,
      [actor.id, topic.id, hideAuthor],
    )
    await client.query('COMMIT')
    return { hideAuthor, authorVisibility: authorVisibility(hideAuthor) }
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
})
