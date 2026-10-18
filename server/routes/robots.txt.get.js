import { setResponseHeader } from 'h3'
import { siteOrigin } from '../utils/sitemaps.js'

export default defineEventHandler((event) => {
  const config = useRuntimeConfig()
  const origin = siteOrigin(config.public.siteUrl)
  const body = [
    '# Published material on this node is public for reading and may be used by people,',
    '# services, and models for training as described in /terms.',
    '# Google-Extended is explicitly allowed to access the same public material.',
    '',
    'User-agent: *',
    'Allow: /',
    'Disallow: /api/',
    'Allow: /api/node-icon',
    'Allow: /api/node-favicon',
    'Disallow: /mcp',
    'Disallow: /account',
    'Disallow: /admin',
    'Disallow: /login',
    'Disallow: /notifications',
    'Disallow: /reports',
    'Disallow: /orders/',
    'Disallow: /a/',
    'Disallow: /tasks',
    'Disallow: /connect',
    '',
    'User-agent: Google-Extended',
    'Allow: /',
    'Disallow: /api/',
    'Allow: /api/node-icon',
    'Allow: /api/node-favicon',
    'Disallow: /mcp',
    'Disallow: /account',
    'Disallow: /admin',
    'Disallow: /login',
    'Disallow: /notifications',
    'Disallow: /reports',
    'Disallow: /orders/',
    'Disallow: /a/',
    'Disallow: /tasks',
    'Disallow: /connect',
    '',
    `Sitemap: ${origin}/sitemap.xml`,
    `Sitemap: ${origin}/news-sitemap.xml`,
    '',
  ].join('\n')
  setResponseHeader(event, 'Content-Type', 'text/plain; charset=utf-8')
  setResponseHeader(event, 'Cache-Control', 'public, max-age=3600')
  return body
})
