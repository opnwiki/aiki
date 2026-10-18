import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { translate } from '../../app/utils/i18n.js'
import { isReservedSlug, normalizePageSlug } from '../../server/utils/validation.js'
import { parsePageNumber, shortPagePath, withShortPath } from '../../server/utils/page-number.js'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')

export async function run({ assert }) {
  assert.equal(parsePageNumber('1'), '1')
  assert.equal(parsePageNumber('42'), '42')
  assert.equal(parsePageNumber('9223372036854775807'), '9223372036854775807')
  assert.equal(parsePageNumber('0'), null)
  assert.equal(parsePageNumber('01'), null)
  assert.equal(parsePageNumber('-3'), null)
  assert.equal(parsePageNumber('9223372036854775808'), null)
  assert.equal(parsePageNumber('12a'), null)
  assert.equal(shortPagePath('7'), '/7')
  assert.equal(shortPagePath('01'), null)
  assert.deepEqual(withShortPath({ slug: 'sunlight', page_number: '7' }), { slug: 'sunlight', page_number: '7', short_path: '/7' })
  assert.deepEqual(withShortPath({ slug: null, page_number: null }), { slug: null, page_number: null })

  assert.equal(isReservedSlug('n'), true)
  assert.equal(normalizePageSlug('n'), null)
  assert.equal(translate('ru', 'topic.pageNumber', { number: 4 }), '№ 4')
  assert.equal(translate('en', 'topic.pageNumber', { number: 4 }), 'No. 4')

  const migration = await readFile(path.join(root, 'database/migrations/023_page_numbers.sql'), 'utf8')
  assert.match(migration, /topic_page_number_seq/)
  assert.match(migration, /topics_page_number_unique/)
  assert.match(migration, /page numbers are immutable/)

  const page = await readFile(path.join(root, 'app/pages/[slug]/index.vue'), 'utf8')
  assert.match(page, /data-testid="page-canonical-url"/)
  assert.match(page, /data-testid="page-short-url"/)
  assert.match(page, /data-testid="page-number"/)
  assert.match(page, /min-w-0 max-w-full cursor-pointer truncate/)
  assert.doesNotMatch(page, /blur-sm/)
  assert.match(page, /copyCanonical/)
  const aside = page.slice(page.indexOf('<aside'))
  assert.ok(aside.indexOf("t('topic.contents')") < aside.indexOf('page-details-heading'))
  assert.match(page, /class="topic-stage"/)
  assert.match(page, /class="topic-main min-w-0"/)
  assert.match(page, /class="topic-aside min-w-0 space-y-5"/)
  assert.match(page, /grid-column: 2/)
  assert.match(page, /minmax\(36rem, min\(44rem, calc\(100% - 42rem\)\)\)/)
  // The overview stays in flow but must contain its absolutely positioned glow.
  assert.match(page, /\.topic-overview-desktop \{[^}]*position: relative !important;/)
  assert.doesNotMatch(page, /\.topic-overview-desktop \{[^}]*position: static/)
  assert.match(page, /\.topic-aside \{[\s\S]*position: sticky !important;[\s\S]*top: var\(--topic-aside-top, 6rem\) !important;/)
  assert.doesNotMatch(page, /\.topic-overview-desktop \{[^}]*position: sticky;/)
    const shell = await readFile(path.join(root, 'app/app.vue'), 'utf8')
  assert.match(shell, /route\.meta\.fullBleed/)
  assert.equal(translate('ru', 'topic.linkCopied'), 'Ссылка скопирована')
  const redirect = await readFile(path.join(root, 'server/routes/n/[number].get.js'), 'utf8')
  assert.match(redirect, /301/)
}
