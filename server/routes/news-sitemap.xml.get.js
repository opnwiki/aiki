import { setResponseHeader } from 'h3'
import { getDatabase } from '../utils/database.js'
import { renderNewsSitemap, siteOrigin } from '../utils/sitemaps.js'

export default defineEventHandler(async (event) => {
  const config = useRuntimeConfig()
  const origin = siteOrigin(config.public.siteUrl)
  const database = getDatabase()
  const result = await database.query(
    `SELECT t.page_number, t.created_at AS published_at, source.locale, source.title,
            coalesce((SELECT display_name FROM nodes WHERE is_home LIMIT 1), 'AiKi') AS publisher_name
       FROM topics t
       JOIN LATERAL (
         SELECT r.locale, r.title
           FROM topic_current_revisions current
           JOIN revisions r ON r.id = current.revision_id
          WHERE current.topic_id = t.id
          ORDER BY (r.source_revision_id IS NULL) DESC, (r.locale = 'en') DESC, r.locale
          LIMIT 1
       ) source ON true
      WHERE t.status = 'published'
        AND t.kind = 'article'
        AND t.created_at >= now() - interval '2 days'
      ORDER BY t.created_at DESC, t.page_number DESC
      LIMIT 1000`,
  )
  const publisherName = result.rows[0]?.publisher_name || 'AiKi'
  const articles = result.rows
    .filter(row => row.page_number != null && row.title)
    .map(row => ({
      pageNumber: row.page_number,
      publishedAt: row.published_at,
      locale: row.locale,
      title: row.title,
    }))
  setResponseHeader(event, 'Content-Type', 'application/xml; charset=utf-8')
  setResponseHeader(event, 'Cache-Control', 'public, max-age=300')
  return renderNewsSitemap({ origin, publisherName, articles })
})
