import { createError, readBody, setResponseStatus } from 'h3'
import { enforceSameOrigin, requireHumanActor } from '../../../utils/auth.js'
import { getDatabase } from '../../../utils/database.js'
import { checkPageContent } from '../../../utils/moderation.js'
import { readableTopicSql } from '../../../utils/page-access.js'
import { recordRevisionDiff } from '../../../utils/revision-history.js'
import { validateTopicRevision } from '../../../utils/validation.js'
import { topicKeyPredicate } from '../../../utils/page-address.js'
import { ensureContentTasks } from '../../../utils/content-tasks.js'
import { enforceContentQuota } from '../../../utils/rate-limit.js'

export default defineEventHandler(async (event) => {
  enforceSameOrigin(event)
  const actor = await requireHumanActor(event)
  await enforceContentQuota(event, actor, 'revision')
  const slug = getRouterParam(event, 'slug')
  if (!slug || !/^[\p{L}\p{N}]+(?:-[\p{L}\p{N}]+)*$/u.test(slug)) {
    throw createError({ statusCode: 404, statusMessage: 'Topic not found.' })
  }

  const checked = validateTopicRevision(await readBody(event))
  if (!checked.ok) {
    throw createError({ statusCode: 400, statusMessage: 'Please correct the page text.', data: { errors: checked.errors } })
  }

  const client = await getDatabase().connect()
  let saved
  try {
    await client.query('BEGIN')
    const selected = await client.query(
      `SELECT t.id, t.kind, t.author_id, t.status,
              coalesce(nullif(t.summary, ''), parent.summary) AS topic_summary,
              current_revision.revision_id, current_revision.locale,
              parent.title, parent.body_markdown, parent.summary,
              parent.authorship_mode, parent.model_name, parent.human_contribution
         FROM topics t
         JOIN topic_current_revisions current_revision ON current_revision.topic_id = t.id AND current_revision.locale = $2
         JOIN revisions parent ON parent.id = current_revision.revision_id
        WHERE ${topicKeyPredicate('t', '$1')}
          AND ${readableTopicSql('t', '$3')}
        FOR UPDATE OF t, current_revision, parent`,
      [slug, checked.value.locale, actor.id],
    )
    const topic = selected.rows[0]
    if (!topic) throw createError({ statusCode: 404, statusMessage: 'Topic not found.' })
    if (topic.author_id !== actor.id) {
      throw createError({ statusCode: 403, statusMessage: 'Only the page author can edit this page.' })
    }
    if (topic.status === 'deleted') {
      throw createError({ statusCode: 409, statusMessage: 'Deleted pages cannot be edited.' })
    }
    if (topic.title === checked.value.title
      && topic.body_markdown === checked.value.body
      && (topic.topic_summary || null) === (checked.value.summary || null)) {
      throw createError({ statusCode: 409, statusMessage: 'Make a change before saving a new revision.' })
    }

    const inserted = await client.query(
      `INSERT INTO revisions (
         topic_id, parent_revision_id, author_id, locale, title, body_markdown, summary,
         authorship_mode, model_name, human_contribution
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       RETURNING id, topic_id, parent_revision_id, author_id, locale, title, body_markdown, summary, created_at`,
      [topic.id, topic.revision_id, actor.id, topic.locale, checked.value.title, checked.value.body,
        checked.value.summary, topic.authorship_mode || 'legacy_undisclosed', topic.model_name, topic.human_contribution],
    )
    saved = inserted.rows[0]

    await recordRevisionDiff(client, {
      revisionId: saved.id,
      parentRevisionId: topic.revision_id,
      parentTitle: topic.title,
      parentBody: topic.body_markdown,
      title: saved.title,
      body: saved.body_markdown,
      origin: 'author_edit',
      introducedBy: actor.id,
      confirmedBy: actor.id,
      introducedAt: saved.created_at,
      confirmedAt: saved.created_at,
    })
    await client.query(
      `UPDATE topic_current_revisions SET revision_id = $1
        WHERE topic_id = $2 AND locale = $3 AND revision_id = $4`,
      [saved.id, topic.id, topic.locale, topic.revision_id],
    ).then((result) => {
      if (result.rowCount !== 1) throw createError({ statusCode: 409, statusMessage: 'The page changed while you were editing. Reload and try again.' })
    })
    await client.query(
      `UPDATE topics SET summary = $2, updated_at = now() WHERE id = $1`,
      [topic.id, checked.value.summary],
    )
    await client.query(
      `INSERT INTO citations (topic_id, source_id, revision_id, locator, note)
       SELECT topic_id, source_id, $2, locator, note
         FROM citations
        WHERE revision_id = $1`,
      [topic.revision_id, saved.id],
    )
    await ensureContentTasks(client, { topicId: topic.id, baseRevisionId: saved.id, creatorId: actor.id })
    await client.query(
      `INSERT INTO actor_audit_log (actor_id, action, target_type, target_id, details)
       VALUES ($1, 'topic_author_revision_created', 'topic', $2,
               jsonb_build_object('parent_revision_id', $3::text, 'revision_id', $4::text))`,
      [actor.id, topic.id, topic.revision_id, saved.id],
    )
    await client.query('COMMIT')
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }

  await checkPageContent(getDatabase(), {
    topicId: saved.topic_id,
    trigger: 'change',
    article: { title: saved.title, body: saved.body_markdown },
  })

  setResponseStatus(event, 201)
  return { revision: saved }
})
