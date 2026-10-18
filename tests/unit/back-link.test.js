import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { translate } from '../../app/utils/i18n.js'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')

export async function run({ assert }) {
  const messages = await readFile(path.join(root, 'app/utils/i18n.js'), 'utf8')
  const component = await readFile(path.join(root, 'app/components/BackLink.vue'), 'utf8')
  const config = await readFile(path.join(root, 'nuxt.config.js'), 'utf8')
  assert.doesNotMatch(messages, /←/)
  assert.match(component, /i-lucide-chevron-left/)
  assert.match(component, /rounded-full/)
  assert.doesNotMatch(component, /arrow-left/)
  assert.match(component, /rtl:-scale-x-100/)
  assert.match(config, /lucide:chevron-left/)
  assert.doesNotMatch(config, /lucide:arrow-left/)
  assert.equal(translate('ru', 'account.home'), 'На главную')
  assert.equal(translate('ru', 'topic.all'), 'Все темы')
  assert.equal(translate('en', 'topics.home'), 'Home')
  assert.equal(translate('en', 'topic.backToArticle'), 'Back to article')
  for (const page of ['app/pages/account.vue', 'app/pages/login.vue', 'app/pages/topics/index.vue', 'app/pages/[slug]/index.vue', 'app/pages/admin.vue']) {
    const source = await readFile(path.join(root, page), 'utf8')
    assert.match(source, /<BackLink\b/, `${page} should use the icon back link`)
    assert.doesNotMatch(source, /←/)
  }
}
