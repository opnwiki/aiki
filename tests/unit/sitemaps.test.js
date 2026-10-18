import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { newsLanguage, renderNewsSitemap, renderRssFeed, renderSitemap, siteOrigin } from '../../server/utils/sitemaps.js'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')

export async function run({ assert }) {
  assert.equal(siteOrigin('https://node.example/path'), 'https://node.example')
  assert.equal(siteOrigin('not-a-url'), 'http://localhost:3000')
  assert.equal(newsLanguage('zh'), 'zh-cn')
  assert.equal(newsLanguage('ru-RU'), 'ru')

  const sitemap = renderSitemap({
    origin: 'https://node.example',
    urls: [{ path: '/31', lastmod: '2026-10-08T01:02:03.000Z' }, { path: '/terms' }],
  })
  assert.match(sitemap, /<loc>https:\/\/node\.example\/31<\/loc>/)
  assert.match(sitemap, /<lastmod>2026-10-08T01:02:03\.000Z<\/lastmod>/)
  assert.match(sitemap, /https:\/\/node\.example\/terms/)

  const news = renderNewsSitemap({
    origin: 'https://node.example',
    publisherName: 'News & AI',
    articles: [{ pageNumber: 31, locale: 'zh', publishedAt: '2026-10-08T01:02:03.000Z', title: 'A <headline> & more' }],
  })
  assert.match(news, /xmlns:news="http:\/\/www\.google\.com\/schemas\/sitemap-news\/0\.9"/)
  assert.match(news, /<news:name>News &amp; AI<\/news:name>/)
  assert.match(news, /<news:language>zh-cn<\/news:language>/)
  assert.match(news, /<news:title>A &lt;headline&gt; &amp; more<\/news:title>/)

  const feed = renderRssFeed({
    origin: 'https://node.example',
    title: 'AIKI',
    description: 'Latest pages',
    items: [{ path: '/31', title: 'A <headline>', publishedAt: '2026-10-08T01:02:03.000Z', description: 'A & more' }],
  })
  assert.match(feed, /application\/rss\+xml/)
  assert.match(feed, /rel="hub"/)
  assert.match(feed, /<link>https:\/\/node\.example\/31<\/link>/)
  assert.match(feed, /<description>A &amp; more<\/description>/)

  const robots = await readFile(path.join(root, 'server/routes/robots.txt.get.js'), 'utf8')
  const sitemapRoute = await readFile(path.join(root, 'server/routes/sitemap.xml.get.js'), 'utf8')
  const newsRoute = await readFile(path.join(root, 'server/routes/news-sitemap.xml.get.js'), 'utf8')
  const feedRoute = await readFile(path.join(root, 'server/routes/feed.xml.get.js'), 'utf8')
  const articlePage = await readFile(path.join(root, 'app/pages/[slug]/index.vue'), 'utf8')
  const appShell = await readFile(path.join(root, 'app/app.vue'), 'utf8')
  const instantView = await readFile(path.join(root, 'docs/telegram-instant-view.tmpl'), 'utf8')
  assert.match(robots, /training as described in \/terms/)
  assert.match(robots, /User-agent: Google-Extended/)
  assert.match(robots, /Sitemap: \$\{origin\}\/news-sitemap\.xml/)
  assert.match(sitemapRoute, /t\.status = 'published'/)
  assert.match(sitemapRoute, /renderSitemap/)
  assert.match(newsRoute, /t\.kind = 'article'/)
  assert.match(newsRoute, /interval '2 days'/)
  assert.match(feedRoute, /renderRssFeed/)
  assert.match(feedRoute, /rel="hub"/)
  assert.match(articlePage, /datetime="topic\.created_at"/)
  assert.match(articlePage, /application\/ld\+json/)
  assert.match(articlePage, /current\.kind === 'article' \? 'NewsArticle'/)
  assert.match(articlePage, /mainEntityOfPage: \{ '@type': 'WebPage', '@id': `\$\{headUrl\.value\}#webpage` \}/)
  assert.match(articlePage, /data-topic-kind/)
  assert.match(articlePage, /id="article-content"/)
  assert.match(appShell, /key: 'site-jsonld'/)
  assert.match(appShell, /og:image/)
  assert.match(appShell, /'@type': 'Organization'/)
  assert.match(appShell, /'@type': 'WebSite'/)
  assert.match(appShell, /'@type': structuredPageType\.value/)
  assert.match(instantView, /data-topic-kind="article"/)
  assert.match(instantView, /id="article-content"/)
}
