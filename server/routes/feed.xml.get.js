import { setResponseHeader } from 'h3'
import { getDatabase } from '../utils/database.js'
import { absoluteSiteUrl, DEFAULT_WEBSUB_HUB_URL, renderRssFeed, siteOrigin } from '../utils/sitemaps.js'

export default defineEventHandler(async (event) => {
  const config = useRuntimeConfig()
  const origin = siteOrigin(config.public.siteUrl)
  const database = getDatabase()
  const result = await database.query(
    `SELECT t.page_number, t.created_at AS published_at,
            current.title, current.summary, current.body_markdown
       FROM topics t
       JOIN LATERAL (
         SELECT r.title, r.summary, r.body_markdown
           FROM topic_current_revisions pointer
           JOIN revisions r ON r.id = pointer.revision_id
          WHERE pointer.topic_id = t.id
          ORDER BY (r.source_revision_id IS NULL) DESC, (r.locale = 'en') DESC, r.created_at DESC
          LIMIT 1
       ) current ON true
      WHERE t.status = 'published'
      ORDER BY t.created_at DESC, t.page_number DESC
      LIMIT 100`,
  )
  const items = result.rows
    .filter(row => row.page_number != null && row.title)
    .map(row => ({
      path: `/${row.page_number}`,
      title: row.title,
      publishedAt: row.published_at,
      description: row.summary || String(row.body_markdown || '').replace(/[#>*_`\[\]()!-]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 300),
    }))
  setResponseHeader(event, 'Content-Type', 'application/rss+xml; charset=utf-8')
  setResponseHeader(event, 'Cache-Control', 'public, max-age=300')
  setResponseHeader(event, 'Link', `<${DEFAULT_WEBSUB_HUB_URL}>; rel="hub", <${absoluteSiteUrl(origin, '/feed.xml')}>; rel="self"`)
  return renderRssFeed({
    origin,
    title: 'AIKI — Open knowledge, built together',
    description: 'Latest public knowledge pages from AIKI.',
    items,
  })
})
