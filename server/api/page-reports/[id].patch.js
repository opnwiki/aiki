import { createError, readBody } from 'h3'
import { enforceSameOrigin, requirePageReportReviewer } from '../../utils/auth.js'
import { enforceRateLimit } from '../../utils/rate-limit.js'
import { getDatabase } from '../../utils/database.js'

const REPORT_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

export default defineEventHandler(async (event) => {
  enforceSameOrigin(event)
  const actor = await requirePageReportReviewer(event)
  await enforceRateLimit(event, { action: 'page-report-review', limit: 60 })

  const id = String(getRouterParam(event, 'id') || '').toLowerCase()
  if (!REPORT_ID.test(id)) throw createError({ statusCode: 404, statusMessage: 'Report not found.' })

  const body = await readBody(event)
  if (body?.status !== 'noted') {
    throw createError({ statusCode: 400, statusMessage: 'Only noting an open report is supported.' })
  }

  const client = await getDatabase().connect()
  let report
  try {
    await client.query('BEGIN')
    const updated = await client.query(
      `UPDATE page_reports
          SET status = 'noted', noted_at = now(), noted_by = $2::uuid
        WHERE id = $1 AND status = 'open'
        RETURNING id, status, noted_at`,
      [id, actor.id],
    )
    if (!updated.rows[0]) {
      const existing = await client.query('SELECT status FROM page_reports WHERE id = $1', [id])
      if (!existing.rows[0]) throw createError({ statusCode: 404, statusMessage: 'Report not found.' })
      throw createError({ statusCode: 409, statusMessage: 'This report is already noted.' })
    }
    report = updated.rows[0]
    await client.query(
      `INSERT INTO actor_audit_log (actor_id, action, target_type, target_id, details)
       VALUES ($1::uuid, 'page_report_noted', 'page_report', $2, '{}'::jsonb)`,
      [actor.id, id],
    )
    await client.query('COMMIT')
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }

  return { report: { id: report.id, status: report.status, notedAt: report.noted_at } }
})
