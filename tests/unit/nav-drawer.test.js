import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { translate } from '../../app/utils/i18n.js'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')

export async function run({ assert }) {
  const app = await readFile(path.join(root, 'app/app.vue'), 'utf8')
  assert.match(app, /data-testid="nav-menu"/)
  assert.match(app, /data-testid="nav-drawer"/)
  assert.match(app, /class="[^"]*\blg:hidden\b[^"]*"/)
  assert.match(app, /<nav class="[^\"]*\bhidden\b[^\"]*\blg:flex\b[^\"]*" aria-label="Main navigation"/)
  assert.match(app, /role="dialog"/)
  assert.match(app, /aria-modal="true"/)
  assert.equal(translate('ru', 'nav.tasks'), 'Задания')
  assert.equal(translate('en', 'nav.tasks'), 'Assignments')
  assert.match(app, /label: t\('nav\.tasks'\)/)
  assert.doesNotMatch(app, /to: '\/admin'/)
  assert.equal(translate('ru', 'nav.menu'), 'Меню')
  assert.equal(translate('ru', 'nav.openMenu'), 'Открыть меню')
  assert.equal(translate('en', 'nav.closeMenu'), 'Close menu')
}
