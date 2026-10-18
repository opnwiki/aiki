import { queryDatabase } from '../utils/database.js'
import { actorDisplayNameSql } from '../utils/actor-display.js'
import { requirePageReportReviewer } from '../utils/auth.js'

export default defineEventHandler(async (event) => {
  await requirePageReportReviewer(event)
  const status = getQuery(event).status === 'noted' ? 'noted' : 'open'
  const result = await queryDatabase(
    `SELECT report.id, report.reason, report.details, report.status, report.created_at,
            topic.slug, revision.title,
            ${actorDisplayNameSql('reporter')} AS reporter
       FROM page_reports report
       JOIN topics topic ON topic.id = report.topic_id
       LEFT JOIN revisions revision ON revision.id = report.revision_id
       LEFT JOIN actors reporter ON reporter.id = report.reporter_id
      WHERE report.status = $1
      ORDER BY report.created_at DESC
      LIMIT 50`,
    [status],
  )
  return {
    reports: result.rows.map(row => ({
      id: row.id,
      reason: row.reason,
      details: row.details,
      status: row.status,
      createdAt: row.created_at,
      slug: row.slug,
      title: row.title || row.slug,
      reporter: row.reporter || null,
    })),
  }
})
