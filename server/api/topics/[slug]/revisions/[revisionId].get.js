import { createError } from 'h3'
import { getHumanActor } from '../../../../utils/auth.js'
import { queryDatabase, getDatabase } from '../../../../utils/database.js'
import { readableTopicSql } from '../../../../utils/page-access.js'
import { renderSafeMarkdown } from '../../../../utils/markdown.js'
import { ensureTopicDiffs, presentChange, REVISION_DIFF_COLUMNS, REVISION_DIFF_JOIN } from '../../../../utils/revision-history.js'
import { maskAuthorName, maskPerson } from '../../../../utils/author-privacy.js'
import { topicKeyPredicate } from '../../../../utils/page-address.js'
import { actorDisplayNameSql } from '../../../../utils/actor-display.js'
import { effectiveAuthorHidden } from '../../../../utils/author-visibility.js'
import { loadImportProvenance } from '../../../../utils/integration-imports.js'

export default defineEventHandler(async (event) => {
  const slug = getRouterParam(event, 'slug')
  const revisionId = getRouterParam(event, 'revisionId')
  if (!slug || !/^[\p{L}\p{N}]+(?:-[\p{L}\p{N}]+)*$/u.test(slug)
    || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(revisionId || '')) {
    throw createError({ statusCode: 404, statusMessage: 'Revision not found.' })
  }

  const viewer = await getHumanActor(event)
  const topic = await queryDatabase(
    `SELECT id FROM topics WHERE ${topicKeyPredicate('topics', '$1')} AND ${readableTopicSql('topics', '$2')} LIMIT 1`,
    [slug, viewer?.id || null],
  )
  if (!topic.rows[0]) throw createError({ statusCode: 404, statusMessage: 'Revision not found.' })
  await ensureTopicDiffs(getDatabase(), topic.rows[0].id)

  const result = await queryDatabase(
    `SELECT t.id AS topic_id, t.slug, t.hide_author, steward.show_author AS steward_show_default, steward.username AS steward_username,
            revision.id, revision.parent_revision_id, revision.locale, revision.title, revision.body_markdown,
            revision.summary, revision.created_at,
            (revision.summary IS DISTINCT FROM parent_revision.summary) AS summary_changed,
            author.username AS author, ${actorDisplayNameSql('author', 'NULL')} AS author_display_name, (current.revision_id = revision.id) AS is_current,
            ${REVISION_DIFF_COLUMNS}
       FROM topics t
       JOIN revisions revision ON revision.topic_id = t.id
       LEFT JOIN revisions parent_revision ON parent_revision.id = revision.parent_revision_id
       LEFT JOIN topic_current_revisions current ON current.topic_id = revision.topic_id AND current.locale = revision.locale
       LEFT JOIN actors author ON author.id = revision.author_id
       LEFT JOIN actors steward ON steward.id = t.author_id
       ${REVISION_DIFF_JOIN}
      WHERE t.id = $1 AND revision.id = $2
      LIMIT 1`,
    [topic.rows[0].id, revisionId],
  )
  const revision = result.rows[0]
  if (!revision) throw createError({ statusCode: 404, statusMessage: 'Revision not found.' })

  const [citations, parent] = await Promise.all([
    queryDatabase(
      `SELECT s.id, s.canonical_url, s.title, s.publisher, c.locator, c.note
         FROM citations c JOIN sources s ON s.id = c.source_id
        WHERE c.revision_id = $1 ORDER BY c.retrieved_at, c.id`,
      [revision.id],
    ),
    revision.parent_revision_id
      ? queryDatabase('SELECT id, title, body_markdown FROM revisions WHERE id = $1 AND topic_id = $2 AND locale = $3', [revision.parent_revision_id, revision.topic_id, revision.locale])
      : Promise.resolve({ rows: [] }),
  ])

  const hiddenName = effectiveAuthorHidden(revision.hide_author, revision.steward_show_default)
    ? revision.steward_username
    : null
  const change = presentChange(revision)
  if (change && hiddenName) {
    change.introducedBy = maskPerson(change.introducedBy, hiddenName)
    change.confirmedBy = maskPerson(change.confirmedBy, hiddenName)
  }
  return {
    topic_id: revision.topic_id,
    slug: revision.slug,
    id: revision.id,
    parent_revision_id: revision.parent_revision_id,
    locale: revision.locale,
    title: revision.title,
    body_markdown: revision.body_markdown,
    summary: revision.summary,
    summary_changed: Boolean(revision.summary_changed),
    created_at: revision.created_at,
    author: maskAuthorName(revision.author, hiddenName),
    author_display_name: hiddenName && revision.author === hiddenName ? null : revision.author_display_name,
    authorHidden: Boolean(hiddenName && revision.author === hiddenName),
    is_current: revision.is_current,
    import: await loadImportProvenance(getDatabase(), revision.topic_id, revision.id, { hideAuthor: Boolean(hiddenName) }),
    html: renderSafeMarkdown(revision.body_markdown, { citations: citations.rows }),
    citations: citations.rows,
    parent: parent.rows[0] || null,
    change,
  }
})
