import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { generatePageCode, inspectPageSlug, isPageCode, topicKeyPredicate } from '../../server/utils/page-address.js'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')

export async function run({ assert }) {
  const code = generatePageCode()
  assert.equal(code.length, 5)
  assert.equal(isPageCode(code), true)
  assert.match(code, /[A-Za-z]/)
  assert.equal(inspectPageSlug(code).ok, true)
  assert.equal(inspectPageSlug('cEd43').slug, 'cEd43')
  assert.equal(inspectPageSlug('trade-talks').slug, 'trade-talks')
  assert.equal(inspectPageSlug('5').reason, 'numeric')
  assert.equal(inspectPageSlug('login').reason, 'reserved')
  assert.equal(inspectPageSlug('').reason, 'empty')
  assert.equal(inspectPageSlug('bad/path').reason, 'invalid')
  assert.match(topicKeyPredicate('t', '$1'), /t\.page_number = \$1::bigint/)
  assert.match(topicKeyPredicate('t', '$1'), /lower\(t\.slug\) = lower\(\$1\)/)

  const home = await readFile(path.join(root, 'app/pages/index.vue'), 'utf8')
  const composer = await readFile(path.join(root, 'app/components/TopicComposer.vue'), 'utf8')
  const redirect = await readFile(path.join(root, 'server/routes/n/[number].get.js'), 'utf8')
  assert.match(home, /pagePath\(item\)/)
  assert.match(composer, /data-testid="page-address"/)
  assert.match(composer, /\/api\/page-slugs/)
  assert.match(redirect, /sendRedirect\(event, `\/\$\{pageNumber\}`, 301\)/)
  assert.doesNotMatch(redirect, /encodeURIComponent\(slug\)/)
}
