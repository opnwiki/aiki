import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')

export async function run({ assert }) {
  const route = await readFile(path.join(root, 'server/api/article-drafts.post.js'), 'utf8')
  const home = await readFile(path.join(root, 'app/pages/index.vue'), 'utf8')
  const login = await readFile(path.join(root, 'app/pages/login.vue'), 'utf8')
  const apiGuide = await readFile(path.join(root, 'server/routes/api.txt.get.js'), 'utf8')
  const openapi = await readFile(path.join(root, 'server/routes/openapi-v1.yaml.get.js'), 'utf8')

  assert.match(route, /requireHumanActor\(event\)/)
  assert.match(route, /INSERT INTO topics[\s\S]*'page', 'unlisted'/)
  assert.match(route, /INSERT INTO revisions/)
  assert.match(route, /classify_page/)
  assert.match(route, /requestedKind/)
  assert.match(route, /initial \$\{requestedKind\} intent/)
  assert.match(route, /page_created_from_search/)
  assert.doesNotMatch(route, /article_order|checkPageContent/)
  assert.match(home, /\$fetch\('\/api\/article-drafts'/)
  assert.doesNotMatch(home, /\/api\/article-orders/)
  assert.match(home, /path: '\/login'/)
  assert.match(home, /encodeURIComponent\(query\)/)
  assert.match(login, /redirectAfterLogin/)
  assert.match(apiGuide, /POST \/api\/article-drafts \(human session required\)/)
  assert.match(openapi, /operationId: createArticleDraft/)

  const { draftTitle, buildDraftBody, isLongDraftQuery } = await import('../../server/utils/article-drafts.js')
  assert.equal(isLongDraftQuery('Short search'), false)
  assert.equal(draftTitle('Short search'), 'Short search')
  assert.match(buildDraftBody('Short search', 'en'), /search request “Short search”/)
  const composed = '# How tides work\n\nExplain the moon and the sun.\nAdd sources.'
  assert.equal(isLongDraftQuery(composed), true)
  assert.equal(draftTitle(composed), 'How tides work')
  assert.ok(buildDraftBody(composed, 'ru').startsWith(composed))
  const longLine = 'word '.repeat(60).trim()
  assert.ok(draftTitle(longLine).length <= 160)
  assert.ok(draftTitle(longLine).endsWith('…'))
}
