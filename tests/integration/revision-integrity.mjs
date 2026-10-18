import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import pg from 'pg'

const base = (process.env.AIKI_TEST_BASE_URL || '').replace(/\/$/, '')
if (!base) throw new Error('Set AIKI_TEST_BASE_URL to an isolated test server URL')
const origin = new URL(base).origin
const suffix = randomBytes(5).toString('hex')
const username = `revision-integrity-${suffix}`
const password = `AIKI-integrity-${randomBytes(18).toString('base64url')}`
const db = new pg.Client({ connectionString: process.env.DATABASE_URL })
let topicId

async function request(path, { method = 'GET', body, cookie } = {}) {
  const headers = { accept: 'application/json' }
  if (body !== undefined) {
    headers['content-type'] = 'application/json'
    headers.origin = origin
  }
  if (cookie) headers.cookie = cookie
  const response = await fetch(`${base}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    redirect: 'manual',
  })
  const text = await response.text()
  let data = null
  try { data = text ? JSON.parse(text) : null } catch { data = text }
  return { response, data }
}

try {
  await db.connect()
  const registration = await request('/api/auth/register', {
    method: 'POST',
    body: { username, email: `${username}@example.org`, password },
  })
  assert.equal(registration.response.status, 201, JSON.stringify(registration.data))
  const token = (registration.response.headers.get('set-cookie') || '').match(/(?:^|,\s*)aiki_session=([^;,]+)/)?.[1]
  assert.ok(token, 'registration must create an authenticated session')
  const cookie = `aiki_session=${token}`

  const created = await request('/api/topics', {
    method: 'POST',
    cookie,
    body: {
      title: `Immutable revision test ${suffix}`,
      body: 'A test article used to verify the database revision guardrails.',
      kind: 'article',
      locale: 'en',
      authorshipMode: 'human_only',
      rulesConsent: true,
      humanContribution: 'Disposable fixture authored for revision-integrity test coverage.',
      sources: [{ url: `https://example.org/revision-integrity/${suffix}`, title: 'Revision test source' }],
    },
  })
  assert.equal(created.response.status, 201, JSON.stringify(created.data))
  topicId = created.data.topic.id
  const topicSlug = created.data.topic.slug
  const original = await request(`/api/topics/${encodeURIComponent(topicSlug)}`)
  assert.equal(original.response.status, 200)
  const originalRevisionId = original.data.revision_id

  await db.query('BEGIN')
  await assert.rejects(
    db.query('UPDATE revisions SET title = $1 WHERE id = $2', ['tampered', originalRevisionId]),
    error => error.code === '55000' && /immutable/.test(error.message),
    'direct SQL UPDATE must not alter a published revision',
  )
  await db.query('ROLLBACK')

  await db.query('BEGIN')
  await assert.rejects(
    db.query('DELETE FROM revisions WHERE id = $1', [originalRevisionId]),
    error => error.code === '55000' && /immutable/.test(error.message),
    'direct SQL DELETE must not erase an individual published revision',
  )
  await db.query('ROLLBACK')

  const otherTopic = await db.query(
    `INSERT INTO topics (slug, kind) VALUES ($1, 'discussion') RETURNING id`,
    [`revision-integrity-other-${suffix}`],
  )
  const otherRevision = await db.query(
    `INSERT INTO revisions (topic_id, locale, title, body_markdown, authorship_mode, human_contribution)
     VALUES ($1, 'en', 'Other article', 'Another base.', 'human_only', 'Disposable parent revision fixture.') RETURNING id`,
    [otherTopic.rows[0].id],
  )
  const invalidParentInsert = `INSERT INTO revisions (topic_id, parent_revision_id, locale, title, body_markdown, authorship_mode, model_name, human_contribution)
    VALUES ($1, $2, $3, $4, $5, 'human_only', NULL, 'Disposable SQL integrity fixture.')`

  await assert.rejects(
    db.query(invalidParentInsert, [topicId, otherRevision.rows[0].id, 'en', 'Invalid child', 'Cross-topic parent must be rejected.']),
    error => error.code === '23503' && /revisions_parent_context_fk/.test(error.constraint),
    'a child revision cannot reference a parent from another topic',
  )
  await assert.rejects(
    db.query(invalidParentInsert, [topicId, originalRevisionId, 'ru', 'Invalid locale child', 'Cross-locale parent must be rejected.']),
    error => error.code === '23503' && /revisions_parent_context_fk/.test(error.constraint),
    'a child revision cannot reference a parent from another locale',
  )

  const child = await db.query(
    `INSERT INTO revisions (topic_id, parent_revision_id, locale, title, body_markdown, authorship_mode, human_contribution)
     VALUES ($1, $2, 'en', 'Child revision', 'A valid child revision.', 'human_only', 'Disposable child revision fixture.') RETURNING id`,
    [otherTopic.rows[0].id, otherRevision.rows[0].id],
  )
  await db.query('DELETE FROM topics WHERE id = $1', [otherTopic.rows[0].id])
  const cascade = await db.query('SELECT count(*)::int AS total FROM revisions WHERE id = ANY($1::uuid[])', [[otherRevision.rows[0].id, child.rows[0].id]])
  assert.equal(cascade.rows[0].total, 0, 'deleting a topic must cascade-delete its entire revision tree')

  const current = await request(`/api/topics/${encodeURIComponent(topicSlug)}`)
  assert.equal(current.data.revision_id, originalRevisionId, 'failed direct mutations must preserve the current revision')
  const history = await request(`/api/topics/${encodeURIComponent(topicSlug)}/revisions?locale=en`)
  assert.equal(history.data.total, 1, 'failed direct mutations must preserve history')
  console.log('PASS isolated revision integrity: SQL UPDATE/DELETE rejected, cross-topic parent rejected, current history unchanged, topic cascade retained')
} finally {
  if (topicId) await db.query('DELETE FROM topics WHERE id = $1', [topicId]).catch(() => {})
  await db.query('DELETE FROM actors WHERE username = $1', [username]).catch(() => {})
  await db.end().catch(() => {})
}
