import { carryHumanEdits, carryTitle } from './translation-edits.js'
import { translateDocument } from './translate.js'
import { recordRevisionDiff } from './revision-history.js'
import { topicKeyPredicate } from './page-address.js'

// A machine translation that lost numbers from the original ("Что такое 67?"
// became "What is it?") is redone. If the translator still drops them, the
// retry waits a day instead of running on every page view.
const RETRY_BROKEN_TRANSLATION_MS = 24 * 60 * 60 * 1000
const brokenTranslationRetries = new Map()

// Digit runs only, so "1,5" -> "1.5" or "1 000" -> "1,000" still count as kept.
export function translationLostNumbers(source, snapshot) {
  const target = String(snapshot.machine_title || '')
  return (String(source.title || '').match(/\d+/g) || []).some(run => !target.includes(run))
}

function shouldRetryBrokenTranslation(key, now = Date.now()) {
  const last = brokenTranslationRetries.get(key)
  if (last && now - last < RETRY_BROKEN_TRANSLATION_MS) return false
  brokenTranslationRetries.set(key, now)
  return true
}

export async function ensureTopicTranslation(database, { slug, targetLocale }) {
  const client = await database.connect()
  try {
    await client.query('BEGIN')
    const topic = await client.query(
      `SELECT id, kind FROM topics WHERE ${topicKeyPredicate('topics', '$1')} AND status IN ('published', 'unlisted')`,
      [slug],
    )
    if (!topic.rows[0]) {
      await client.query('COMMIT')
      return { status: 'skipped' }
    }
    const topicId = topic.rows[0].id
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1)::bigint)', [`translate:${topicId}:${targetLocale}`])
    const sourceResult = await client.query(
      `SELECT r.id, r.locale, r.title, r.body_markdown,
              coalesce(nullif(t.summary, ''), r.summary) AS summary,
              r.authorship_mode, r.model_name, r.human_contribution
         FROM topic_current_revisions current
         JOIN revisions r ON r.id = current.revision_id
         JOIN topics t ON t.id = $1
        WHERE current.topic_id = $1
          AND r.source_revision_id IS NULL
        ORDER BY r.created_at DESC, r.id DESC
        LIMIT 1`,
      [topicId],
    )
    const source = sourceResult.rows[0]
    if (!source || source.locale === targetLocale) {
      await client.query('COMMIT')
      return { status: 'skipped' }
    }

    const currentResult = await client.query(
      `SELECT r.id, r.title, r.body_markdown, r.summary
         FROM topic_current_revisions current
         JOIN revisions r ON r.id = current.revision_id
        WHERE current.topic_id = $1 AND current.locale = $2`,
      [topicId, targetLocale],
    )
    const current = currentResult.rows[0] || null
    const snapshot = current ? await nearestSnapshot(client, topicId, current.id) : null
    if (snapshot && snapshot.source_revision_id === source.id && (!source.summary || snapshot.machine_summary !== null)
      && (!translationLostNumbers(source, snapshot) || !shouldRetryBrokenTranslation(`${topicId}:${targetLocale}`))) {
      await client.query('COMMIT')
      return { status: 'fresh' }
    }

    const machine = await translateDocument({
      title: source.title,
      body: source.body_markdown,
      summary: source.summary,
      sourceLocale: source.locale,
      targetLocale,
    })
    const title = snapshot
      ? carryTitle(snapshot.machine_title, current.title, machine.title)
      : machine.title
    const body = snapshot
      ? carryHumanEdits(snapshot.machine_body, current.body_markdown, machine.body)
      : machine.body
    const summary = snapshot
      ? carryHumanEdits(snapshot.machine_summary || '', current.summary || '', machine.summary || '')
      : machine.summary
    if (current && title === current.title && body === current.body_markdown && (summary || null) === (current.summary || null)) {
      await client.query('COMMIT')
      return { status: 'fresh' }
    }
    const humanAdjusted = title !== machine.title || body !== machine.body || summary !== machine.summary
    const inserted = await client.query(
      `INSERT INTO revisions (
         topic_id, parent_revision_id, author_id, locale, title, body_markdown,
         summary, source_revision_id, authorship_mode, model_name, human_contribution
       )
       VALUES ($1, $2, NULL, $3, $4, $5, $6, $7, $8, $9, $10)
       RETURNING id`,
      [topicId, current?.id || null, targetLocale, title, body, summary, source.id,
        source.authorship_mode,
        source.model_name,
        source.human_contribution],
    )
    const revisionId = inserted.rows[0].id
    await recordRevisionDiff(client, {
      revisionId,
      parentRevisionId: current?.id || null,
      parentTitle: current?.title || '',
      parentBody: current?.body_markdown || '',
      title,
      body,
      origin: 'translation',
      introducedLabel: machine.provider,
    })
    await client.query(
      `INSERT INTO translation_snapshots (
         revision_id, topic_id, locale, source_revision_id, machine_title, machine_body, machine_summary, provider
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [revisionId, topicId, targetLocale, source.id, machine.title, machine.body, machine.summary, machine.provider],
    )
    await client.query(
      `INSERT INTO citations (topic_id, source_id, revision_id, locator, note)
       SELECT topic_id, source_id, $2, locator, note FROM citations WHERE revision_id = $1`,
      [source.id, revisionId],
    )
    await client.query(
      `INSERT INTO topic_current_revisions (topic_id, locale, revision_id)
       VALUES ($1, $2, $3)
       ON CONFLICT (topic_id, locale) DO UPDATE SET revision_id = EXCLUDED.revision_id`,
      [topicId, targetLocale, revisionId],
    )
    await client.query('COMMIT')
    return { status: 'ready' }
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
}

export async function presentTranslation(database, { topicId, revisionId, title, body, summary = null }) {
  const snapshot = await nearestSnapshot(database, topicId, revisionId)
  if (!snapshot) return null
  const source = await database.query(
    'SELECT locale FROM revisions WHERE id = $1',
    [snapshot.source_revision_id],
  )
  return {
    status: 'ready',
    sourceLocale: source.rows[0]?.locale || '',
    sourceRevisionId: snapshot.source_revision_id,
    provider: snapshot.provider,
    humanAdjusted: snapshot.machine_title !== title
      || snapshot.machine_body !== body
      || snapshot.machine_summary !== summary,
  }
}

async function nearestSnapshot(database, topicId, revisionId) {
  const result = await database.query(
    `WITH RECURSIVE chain AS (
       SELECT id, parent_revision_id, 0 AS depth
         FROM revisions
        WHERE id = $2 AND topic_id = $1
       UNION ALL
       SELECT r.id, r.parent_revision_id, chain.depth + 1
         FROM revisions r
         JOIN chain ON r.id = chain.parent_revision_id
        WHERE r.topic_id = $1 AND chain.depth < 30
     )
     SELECT s.machine_title, s.machine_body, s.machine_summary, s.source_revision_id, s.provider
       FROM chain
       JOIN translation_snapshots s ON s.revision_id = chain.id
      ORDER BY chain.depth
      LIMIT 1`,
    [topicId, revisionId],
  )
  return result.rows[0] || null
}
