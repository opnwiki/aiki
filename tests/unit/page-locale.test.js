import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')

export async function run({ assert }) {
  const page = await readFile(path.join(root, 'app/pages/[slug]/index.vue'), 'utf8')
  const api = await readFile(path.join(root, 'server/api/topics/[slug].get.js'), 'utf8')
  const locale = await readFile(path.join(root, 'app/composables/useLocale.js'), 'utf8')

  // /31/ru and /31/en render the same page in a pinned language.
  assert.match(page, /alias: \['\/:slug\/:lang\(en\|zh\|ru\|es\|ja\|de\|fr\|ar\)'\]/)
  assert.match(page, /routeLang\.value \|\| \(followUiLocale\.value \? locale\.value : 'original'\)/)
  assert.match(page, /useCookie\('aiki-locale-explicit'\)/)
  assert.match(page, /followUiLocale\.value = true/)
  assert.match(page, /query: computed\(\(\) => \(\{ locale: contentLocale\.value/)
  assert.match(page, /query: \{ locale: contentLocale\.value, repliesLimit: 100, repliesOffset: offset/)
  assert.match(locale, /aiki-locale-explicit/)
  assert.match(locale, /explicitLocaleCookie\.value = '1'/)
  // Link previews get the right language in title, og:locale, lang and hreflang.
  assert.match(page, /htmlAttrs: topic\.value\?\.locale \? \{ lang: topic\.value\.locale \}/)
  assert.match(page, /hreflang: code, href: localizedUrl\(code\)/)
  assert.match(page, /hreflang: 'x-default'/)
  assert.match(page, /ogLocale: \(\) => OG_LOCALES\[topic\.value\?\.locale\]/)

  assert.match(api, /topicQuery\.locale === 'original' && originalLocale/)
  assert.match(api, /ORDER BY r\.created_at ASC, r\.id ASC/)
  assert.match(api, /topic\.available_locales = /)
}
