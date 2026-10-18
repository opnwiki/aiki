import { readFile, stat } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')

export async function run({ assert }) {
  const manifest = JSON.parse(await readFile(path.join(root, 'public/site.webmanifest'), 'utf8'))
  const head = await readFile(path.join(root, 'nuxt.config.js'), 'utf8')
  const app = await readFile(path.join(root, 'app/app.vue'), 'utf8')

  assert.equal(manifest.name, 'AIKI — Open Knowledge Commons')
  assert.equal(manifest.short_name, 'AIKI')
  assert.equal(manifest.start_url, '/')
  assert.equal(manifest.scope, '/')
  assert.equal(manifest.display, 'standalone')
  assert.equal(manifest.theme_color, '#0b1d2a')
  assert.equal(manifest.background_color, '#0b1d2a')
  assert.ok(manifest.icons.some(icon => icon.sizes === '192x192' && icon.purpose === 'any'))
  assert.ok(manifest.icons.some(icon => icon.sizes === '512x512' && icon.purpose === 'any'))
  assert.ok(manifest.icons.some(icon => icon.sizes === '512x512' && icon.purpose === 'maskable'))

  assert.match(head, /rel: 'manifest', href: '\/site\.webmanifest'/)
  assert.match(head, /rel: 'apple-touch-icon'/)
  assert.match(head, /name: 'mobile-web-app-capable', content: 'yes'/)
  assert.match(head, /name: 'apple-mobile-web-app-capable', content: 'yes'/)
  assert.match(app, /\/aiki-galaxy\.webp/)
  assert.match(app, /\/aiki-wordmark\.svg/)
  assert.match(head, /#0b1d2a/)

  for (const icon of manifest.icons) {
    const imagePath = path.join(root, 'public', icon.src.replace(/^\//, ''))
    const details = await stat(imagePath)
    assert.ok(details.isFile() && details.size > 0, `${icon.src} exists and is non-empty`)
  }
  const dynamic = await readFile(path.join(root, 'server/api/webmanifest.get.js'), 'utf8')
  const admin = await readFile(path.join(root, 'app/pages/admin.vue'), 'utf8')
  assert.match(dynamic, /#0b1d2a/)
  assert.match(admin, /\/aiki-galaxy\.webp/)
  for (const icon of manifest.icons) assert.match(dynamic, new RegExp(icon.src.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
  for (const file of ['favicon.ico', 'icon-16.png', 'icon-32.png', 'icon-180.png', 'aiki-galaxy.webp', 'aiki-galaxy.png', 'aiki-app-icon.png', 'aiki-wordmark.svg']) {
    const details = await stat(path.join(root, 'public', file))
    assert.ok(details.isFile() && details.size > 0, `${file} exists and is non-empty`)
  }
}
