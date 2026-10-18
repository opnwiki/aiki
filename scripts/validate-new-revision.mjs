// Validation probe: run the exact new-revision save path for one article
// inside a transaction and ROLL BACK, so it never persists. Confirms the SQL
// against the real schema.
import pg from 'pg'
import { recordRevisionDiff } from '../server/utils/revision-history.js'

const connectionString = process.env.DATABASE_URL
const pool = new pg.Pool({ connectionString, max: 2 })

const { rows } = await pool.query(
  `SELECT t.id::text AS topic_id, t.slug, t.page_number,
          cur.revision_id::text AS revision_id,
          r.locale, r.title, r.body_markdown AS body,
          r.author_id::text AS author_id, r.authorship_mode, r.model_name, r.human_contribution
     FROM topics t
     JOIN topic_current_revisions cur ON cur.topic_id = t.id
     JOIN revisions r ON r.id = cur.revision_id
    WHERE t.kind = 'article' AND t.status = 'published'
      AND (r.summary IS NULL OR btrim(r.summary) = '')
    ORDER BY t.page_number LIMIT 1`,
)
if (!rows.length) { console.log('no article without summary'); process.exit(0) }
const article = rows[0]
console.log('Validating new-revision SQL for', article.slug, article.locale, 'rev', article.revision_id)

const client = await pool.connect()
try {
  await client.query('BEGIN')
  const parent = await client.query(
    `SELECT title, body_markdown, author_id, authorship_mode, model_name, human_contribution
       FROM revisions WHERE id = $1::uuid FOR UPDATE`, [article.revision_id])
  const p = parent.rows[0]
  const inserted = await client.query(
    `INSERT INTO revisions (topic_id, parent_revision_id, author_id, locale, title, body_markdown,
       summary, authorship_mode, model_name, human_contribution)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING id, created_at`,
    [article.topic_id, article.revision_id, article.author_id || p.author_id, article.locale,
      p.title, p.body_markdown, 'VALIDATION-DUMMY-SUMMARY', p.authorship_mode || 'legacy_undisclosed', p.model_name, p.human_contribution])
  const rid = inserted.rows[0].id
  console.log('insert revisions -> ok, id', rid)
  await recordRevisionDiff(client, {
    revisionId: rid, parentRevisionId: article.revision_id,
    parentTitle: p.title, parentBody: p.body_markdown,
    title: p.title, body: p.body_markdown,
    origin: 'publication', introducedBy: article.author_id || p.author_id,
    confirmedBy: article.author_id || p.author_id,
    introducedAt: inserted.rows[0].created_at, confirmedAt: inserted.rows[0].created_at,
  })
  console.log('recordRevisionDiff -> ok')
  const moved = await client.query(
    `UPDATE topic_current_revisions SET revision_id = $1::uuid
      WHERE topic_id = $2::uuid AND locale = $3 AND revision_id = $4::uuid`,
    [rid, article.topic_id, article.locale, article.revision_id])
  console.log('move current -> rowCount', moved.rowCount)
  const copied = await client.query(
    `INSERT INTO citations (topic_id, source_id, revision_id, locator, note)
     SELECT topic_id, source_id, $2::uuid, locator, note FROM citations WHERE revision_id = $1::uuid`,
    [article.revision_id, rid])
  console.log('copy citations -> ', copied.rowCount, 'rows')
  await client.query('ROLLBACK')
  console.log('ROLLED BACK — nothing persisted. SQL path OK.')
} catch (e) {
  await client.query('ROLLBACK')
  console.error('VALIDATION FAILED:', e.message)
  process.exitCode = 1
} finally {
  client.release()
  await pool.end()
}