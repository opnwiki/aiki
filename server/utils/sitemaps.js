const DEFAULT_SITE_URL = 'http://localhost:3000'
export const DEFAULT_WEBSUB_HUB_URL = 'https://pubsubhubbub.appspot.com/'

export function siteOrigin(value) {
  try {
    const url = new URL(String(value || DEFAULT_SITE_URL))
    return url.origin
  } catch {
    return DEFAULT_SITE_URL
  }
}

export function xmlEscape(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

export function absoluteSiteUrl(origin, path) {
  const base = siteOrigin(origin).replace(/\/$/, '')
  const pathname = String(path || '/')
  return `${base}${pathname.startsWith('/') ? pathname : `/${pathname}`}`
}

export function renderSitemap({ origin, urls }) {
  const entries = (Array.isArray(urls) ? urls : []).map(({ path, lastmod }) => {
    const lastmodTag = lastmod ? `\n    <lastmod>${xmlEscape(toIsoTimestamp(lastmod))}</lastmod>` : ''
    return `  <url>\n    <loc>${xmlEscape(absoluteSiteUrl(origin, path))}</loc>${lastmodTag}\n  </url>`
  })
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...entries,
    '</urlset>',
    '',
  ].join('\n')
}

export function newsLanguage(locale) {
  const value = String(locale || 'en').toLowerCase()
  return value === 'zh' ? 'zh-cn' : value.split('-')[0]
}

export function renderNewsSitemap({ origin, publisherName, articles }) {
  const entries = (Array.isArray(articles) ? articles : []).map(article => [
    '  <url>',
    `    <loc>${xmlEscape(absoluteSiteUrl(origin, `/${article.pageNumber}`))}</loc>`,
    '    <news:news>',
    '      <news:publication>',
    `        <news:name>${xmlEscape(publisherName || 'AiKi')}</news:name>`,
    `        <news:language>${xmlEscape(newsLanguage(article.locale))}</news:language>`,
    '      </news:publication>',
    `      <news:publication_date>${xmlEscape(toIsoTimestamp(article.publishedAt))}</news:publication_date>`,
    `      <news:title>${xmlEscape(article.title)}</news:title>`,
    '    </news:news>',
    '  </url>',
  ].join('\n'))
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:news="http://www.google.com/schemas/sitemap-news/0.9">',
    ...entries,
    '</urlset>',
    '',
  ].join('\n')
}

export function renderRssFeed({ origin, title = 'AIKI', description = '', items = [] }) {
  const normalizedOrigin = siteOrigin(origin)
  const entries = (Array.isArray(items) ? items : []).map(item => {
    const url = absoluteSiteUrl(normalizedOrigin, item.path)
    return [
      '    <item>',
      `      <title>${xmlEscape(item.title)}</title>`,
      `      <link>${xmlEscape(url)}</link>`,
      `      <guid isPermaLink="true">${xmlEscape(url)}</guid>`,
      `      <pubDate>${xmlEscape(toRssDate(item.publishedAt))}</pubDate>`,
      `      <description>${xmlEscape(item.description || '')}</description>`,
      '    </item>',
    ].join('\n')
  })
  const lastBuildDate = items[0]?.publishedAt ? toRssDate(items[0].publishedAt) : toRssDate(new Date())
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">',
    '  <channel>',
    `    <title>${xmlEscape(title)}</title>`,
    `    <link>${xmlEscape(normalizedOrigin)}</link>`,
    `    <description>${xmlEscape(description)}</description>`,
    `    <atom:link href="${xmlEscape(absoluteSiteUrl(normalizedOrigin, '/feed.xml'))}" rel="self" type="application/rss+xml" />`,
    `    <atom:link href="${xmlEscape(DEFAULT_WEBSUB_HUB_URL)}" rel="hub" />`,
    `    <lastBuildDate>${xmlEscape(lastBuildDate)}</lastBuildDate>`,
    ...entries,
    '  </channel>',
    '</rss>',
    '',
  ].join('\n')
}

function toIsoTimestamp(value) {
  const date = value instanceof Date ? value : new Date(value)
  return Number.isNaN(date.getTime()) ? String(value || '') : date.toISOString()
}

function toRssDate(value) {
  const date = value instanceof Date ? value : new Date(value)
  return Number.isNaN(date.getTime()) ? String(value || '') : date.toUTCString()
}
