import { setResponseHeader } from 'h3'
import { getDatabase } from '../utils/database.js'
import { renderSitemap, siteOrigin } from '../utils/sitemaps.js'

export default defineEventHandler(async (event) => {
  const config = useRuntimeConfig()
  const origin = siteOrigin(config.public.siteUrl)
  const database = getDatabase()
  const result = await database.query(
    `SELECT t.page_number, t.created_at, max(r.created_at) AS lastmod
       FROM topics t
       JOIN topic_current_revisions current ON current.topic_id = t.id
       JOIN revisions r ON r.id = current.revision_id
      WHERE t.status = 'published'
      GROUP BY t.id, t.page_number, t.created_at
      ORDER BY t.page_number`,
  )
  const urls = [
    { path: '/', lastmod: null },
    { path: '/topics', lastmod: null },
    { path: '/branches', lastmod: null },
    { path: '/node', lastmod: null },
    { path: '/terms', lastmod: null },
    ...result.rows
      .filter(row => row.page_number != null)
      .map(row => ({ path: `/${row.page_number}`, lastmod: row.lastmod || row.created_at })),
  ]
  setResponseHeader(event, 'Content-Type', 'application/xml; charset=utf-8')
  setResponseHeader(event, 'Cache-Control', 'public, max-age=300')
  return renderSitemap({ origin, urls })
})
