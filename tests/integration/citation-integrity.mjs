import assert from 'node:assert/strict'
import pg from 'pg'

const connectionString = process.env.DATABASE_URL || ''
if (!connectionString) throw new Error('Set DATABASE_URL to an isolated disposable PostgreSQL database')
const parsed = new URL(connectionString)
if (!/(^|[_-])(test|testing|disposable)([_-]|$)/i.test(decodeURIComponent(parsed.pathname.slice(1)))) {
  throw new Error('Refusing citation integrity test: database name must clearly identify a disposable test database')
}
const db = new pg.Client({ connectionString })
const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`

async function rejectsInSavepoint(label, sql, values, expectedConstraint, expectedCode = '23503') {
  await db.query('SAVEPOINT citation_negative_case')
  await assert.rejects(
    db.query(sql, values),
    error => error.code === expectedCode && error.constraint === expectedConstraint,
    label,
  )
  await db.query('ROLLBACK TO SAVEPOINT citation_negative_case')
  await db.query('RELEASE SAVEPOINT citation_negative_case')
}

let connected = false
try {
  await db.connect()
  connected = true
  await db.query('BEGIN')
  const topic = await db.query(
    "INSERT INTO topics (slug, kind) VALUES ($1, 'discussion') RETURNING id",
    [`citation-integrity-${suffix}`],
  )
  const otherTopic = await db.query(
    "INSERT INTO topics (slug, kind) VALUES ($1, 'discussion') RETURNING id",
    [`citation-integrity-other-${suffix}`],
  )
  const revision = await db.query(
    `INSERT INTO revisions (topic_id, locale, title, body_markdown, authorship_mode, human_contribution)
     VALUES ($1, 'en', 'Citation integrity test', 'A disposable fixture.', 'human_only', 'Disposable citation integrity fixture.') RETURNING id`,
    [topic.rows[0].id],
  )
  const reply = await db.query(
    `INSERT INTO replies (topic_id, locale, body_markdown)
     VALUES ($1, 'en', 'A disposable reply.') RETURNING id`,
    [topic.rows[0].id],
  )
  const source = await db.query(
    'INSERT INTO sources (canonical_url) VALUES ($1) RETURNING id',
    [`https://example.invalid/citation-integrity/${suffix}`],
  )

  const revisionCitation = await db.query(
    `INSERT INTO citations (topic_id, source_id, revision_id, locator)
     VALUES ($1, $2, $3, 'revision locator') RETURNING id`,
    [topic.rows[0].id, source.rows[0].id, revision.rows[0].id],
  )
  const replyCitation = await db.query(
    `INSERT INTO citations (topic_id, source_id, reply_id, locator)
     VALUES ($1, $2, $3, 'reply locator') RETURNING id`,
    [topic.rows[0].id, source.rows[0].id, reply.rows[0].id],
  )
  assert.equal(revisionCitation.rowCount, 1)
  assert.equal(replyCitation.rowCount, 1)

  await rejectsInSavepoint(
    'a citation cannot claim a different topic from its revision',
    `INSERT INTO citations (topic_id, source_id, revision_id) VALUES ($1, $2, $3)`,
    [otherTopic.rows[0].id, source.rows[0].id, revision.rows[0].id],
    'citations_revision_context_fk',
  )
  await rejectsInSavepoint(
    'a citation cannot claim a different topic from its reply',
    `INSERT INTO citations (topic_id, source_id, reply_id) VALUES ($1, $2, $3)`,
    [otherTopic.rows[0].id, source.rows[0].id, reply.rows[0].id],
    'citations_reply_context_fk',
  )
  await rejectsInSavepoint(
    'a citation must reference exactly one target',
    `INSERT INTO citations (topic_id, source_id) VALUES ($1, $2)`,
    [topic.rows[0].id, source.rows[0].id],
    'citations_exactly_one_target_ck',
    '23514',
  )
  await rejectsInSavepoint(
    'a citation cannot reference both a revision and a reply',
    `INSERT INTO citations (topic_id, source_id, revision_id, reply_id) VALUES ($1, $2, $3, $4)`,
    [topic.rows[0].id, source.rows[0].id, revision.rows[0].id, reply.rows[0].id],
    'citations_exactly_one_target_ck',
    '23514',
  )

  await db.query('DELETE FROM topics WHERE id = $1', [topic.rows[0].id])
  const remainingCitations = await db.query(
    'SELECT count(*)::int AS total FROM citations WHERE id = ANY($1::uuid[])',
    [[revisionCitation.rows[0].id, replyCitation.rows[0].id]],
  )
  assert.equal(remainingCitations.rows[0].total, 0, 'deleting a topic must cascade-delete its revision/reply citations')
  await db.query('ROLLBACK')
  console.log('PASS citation integrity: exact target, same-topic FKs, and topic cascade leave no orphan citations')
} finally {
  if (connected) {
    await db.query('ROLLBACK').catch(() => {})
    await db.end().catch(() => {})
  }
}
