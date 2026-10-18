import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { translate } from '../../app/utils/i18n.js'
import {
  DEFAULT_ACCENT_DARK,
  DEFAULT_ACCENT_LIGHT,
  accentDeclaration,
  accentInk,
  normalizeAccent,
  relativeLuminance,
} from '../../app/utils/accent.js'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')

function contrast(background, foreground) {
  const lighter = Math.max(relativeLuminance(background), relativeLuminance(foreground))
  const darker = Math.min(relativeLuminance(background), relativeLuminance(foreground))
  return (lighter + 0.05) / (darker + 0.05)
}

export async function run({ assert }) {
  assert.equal(normalizeAccent('#3D5C4E'), '#3d5c4e')
  assert.equal(normalizeAccent('3d5c4e'), null)
  assert.equal(normalizeAccent('#fff'), null)
  assert.equal(accentInk(DEFAULT_ACCENT_LIGHT), '#f4f7f5')
  assert.equal(accentInk(DEFAULT_ACCENT_DARK), '#14201a')
  assert.ok(contrast(DEFAULT_ACCENT_LIGHT, accentInk(DEFAULT_ACCENT_LIGHT)) >= 4.5)
  assert.ok(contrast(DEFAULT_ACCENT_DARK, accentInk(DEFAULT_ACCENT_DARK)) >= 4.5)
  assert.match(accentDeclaration({}), /--aiki-accent-light:#3d5c4e/)
  assert.match(accentDeclaration({ light: '#2244aa', dark: 'nope' }), /--aiki-accent-light:#2244aa/)
  assert.match(accentDeclaration({ light: '#2244aa', dark: 'nope' }), /--aiki-accent-dark:#8aa899/)

  const admin = await readFile(path.join(root, 'app/pages/admin.vue'), 'utf8')
  const css = await readFile(path.join(root, 'app/assets/css/main.css'), 'utf8')
  assert.match(admin, /data-testid="accent-light"/)
  assert.match(admin, /data-testid="accent-dark"/)
  assert.match(css, /\.aiki-button/)
  assert.match(css, /button\.bg-primary/)
  assert.equal(translate('ru', 'admin.accentTitle'), 'Акцентные цвета')
  assert.equal(translate('en', 'admin.accentLight'), 'Light theme')
}
