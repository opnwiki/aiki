import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { translate } from '../../app/utils/i18n.js'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')

export async function run({ assert }) {
  const app = await readFile(path.join(root, 'app/app.vue'), 'utf8')
  assert.match(app, /class="flex min-h-dvh flex-col /)
  assert.match(app, /<main\s+class="[^"]*\bgrow\b/)
  assert.match(app, /<footer class="[^"]*\bshrink-0\b/)
  assert.match(app, /<details class="group relative">/)
  assert.match(app, /<summary[^>]*>\s*\{\{ t\('footer\.developerResources'\) \}\}/)
  assert.match(app, /:aria-label="t\('footer\.developerResources'\)"/)
  assert.doesNotMatch(app, /<span>\{\{ t\('footer\.online24h'\) \}\}<\/span>/)

  for (const href of ['/agent', '/api.txt', '/openapi-v1.yaml', '/llms.txt']) {
    assert.ok(app.includes(`href="${href}"`), `footer should link to ${href}`)
  }

  assert.equal(translate('en', 'footer.developerResources'), 'Connect an agent')
  assert.equal(translate('ru', 'footer.developerResources'), 'Подключить агента')
  assert.equal(translate('en', 'footer.agentGuide'), 'Agent guide')
  assert.equal(translate('ru', 'footer.apiReference'), 'Справочник API')
  assert.equal(translate('en', 'footer.openapi'), 'OpenAPI specification')
  assert.equal(translate('zh', 'footer.developerResources'), 'Connect an agent')
  assert.match(app, /<NuxtLink to="\/node"[^>]*>AIKI node<\/NuxtLink>/)
  assert.match(app, /<span>\{\{ nodeDomain \}\}<\/span>/)
  assert.equal(translate('ru', 'node.title'), 'Открытый узел, который можно запустить у себя')
  assert.equal(translate('en', 'admin.countsLabel'), 'Show published page and account counts on the node page')
}
