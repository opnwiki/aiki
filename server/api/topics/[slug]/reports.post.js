import { createError, readBody, setResponseStatus } from 'h3'
import { enforceSameOrigin, getHumanActor } from '../../../utils/auth.js'
import { getDatabase } from '../../../utils/database.js'
import { enforceRateLimit } from '../../../utils/rate-limit.js'
import { SUPPORTED_LOCALES, validatePageReport } from '../../../utils/validation.js'
import { topicKeyPredicate } from '../../../utils/page-address.js'

export default defineEventHandler(async (event) => {
  enforceSameOrigin(event)
  const actor = await getHumanActor(event)
  await enforceRateLimit(event, { action: 'page-report', limit: 5 })

  const slug = getRouterParam(event, 'slug')
  if (!slug || !/^[\p{L}\p{N}]+(?:-[\p{L}\p{N}]+)*$/u.test(slug)) {
    throw createError({ statusCode: 404, statusMessage: 'Topic not found.' })
  }

  const body = await readBody(event)
  const checked = validatePageReport(body)
  if (!checked.ok) throw createError({ statusCode: 400, statusMessage: 'Please correct the report.', data: { errors: checked.errors } })

  const requestedLocale = String(body?.locale || 'en')
  const locale = SUPPORTED_LOCALES.includes(requestedLocale) ? requestedLocale : 'en'

  const client = await getDatabase().connect()
  let report
  try {
    await client.query('BEGIN')
    const topicResult = await client.query(
      `SELECT t.id AS topic_id, current.revision_id
         FROM topics t
         JOIN topic_current_revisions current ON current.topic_id = t.id AND current.locale = $2
        WHERE ${topicKeyPredicate('t', '$1')} AND t.status = 'published'`,
      [slug, locale],
    )
    if (!topicResult.rows[0]) throw createError({ statusCode: 404, statusMessage: 'Topic not found.' })

    const inserted = await client.query(
      `INSERT INTO page_reports (topic_id, revision_id, reporter_id, reason, details)
       VALUES ($1, $2, $3::uuid, $4, $5)
       RETURNING id, reason, status, created_at`,
      [topicResult.rows[0].topic_id, topicResult.rows[0].revision_id, actor?.id || null, checked.value.reason, checked.value.details],
    )
    report = inserted.rows[0]
    await client.query(
      `INSERT INTO actor_audit_log (actor_id, action, target_type, target_id, details)
       VALUES ($1::uuid, 'page_reported', 'page_report', $2, $3::jsonb)`,
      [actor?.id || null, String(report.id), JSON.stringify({ reason: report.reason, slug })],
    )
    await client.query('COMMIT')
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }

  setResponseStatus(event, 201)
  return {
    report: {
      id: report.id,
      reason: report.reason,
      status: report.status,
      createdAt: report.created_at,
    },
  }
})
