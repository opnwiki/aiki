import { setResponseHeader } from 'h3'
import { getDatabase } from '../utils/database.js'
import { indexNowKeyFile } from '../utils/indexnow.js'
import { buildMachineDocument } from '../utils/machine-readable.js'
import { recordPageView } from '../utils/page-visitors.js'
import { loadPublishedTopic } from '../utils/topic-document.js'

const CONTENT_TYPES = {
  md: 'text/markdown; charset=utf-8',
  txt: 'text/plain; charset=utf-8',
  json: 'application/json; charset=utf-8',
  jsonld: 'application/ld+json; charset=utf-8',
}
const STATIC_TEXT_ROUTES = new Set(['llms.txt', 'api.txt', 'robots.txt'])

export default defineEventHandler(async (event) => {
  const path = String(event.path || '').split('?')[0]
  const indexNowKey = indexNowKeyFile(path)
  if (indexNowKey) {
    setResponseHeader(event, 'content-type', CONTENT_TYPES.txt)
    return indexNowKey
  }
  const match = path.match(/^\/([^/]+)\.(md|txt|json|jsonld)$/i)
  if (!match || STATIC_TEXT_ROUTES.has(`${match[1]}.${match[2]}`.toLowerCase())) return

  const format = match[2].toLowerCase()
  const topic = await loadPublishedTopic(event)
  const database = getDatabase()
  await recordPageView(database, topic.id, event.node.req.headers['user-agent'])
  const config = useRuntimeConfig()
  const document = buildMachineDocument(topic, {
    siteUrl: config.public.siteUrl,
    nodeDomain: config.public.nodeDomain,
  })
  const body = format === 'md' ? document.markdown
    : format === 'txt' ? document.text
      : `${JSON.stringify(format === 'jsonld' ? document.jsonld : document.json, null, 2)}\n`
  setResponseHeader(event, 'content-type', CONTENT_TYPES[format])
  setResponseHeader(event, 'content-language', document.locale)
  setResponseHeader(event, 'cache-control', 'public, max-age=60')
  setResponseHeader(event, 'x-content-type-options', 'nosniff')
  return body
})
