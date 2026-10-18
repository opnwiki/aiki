import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { translate } from '../../app/utils/i18n.js'
import { termsSections } from '../../app/content/terms.js'
import { isReservedSlug, normalizePageSlug } from '../../server/utils/validation.js'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')

export async function run({ assert }) {
  assert.equal(isReservedSlug('terms'), true)
  assert.equal(normalizePageSlug('terms'), null)
  assert.equal(translate('ru', 'terms.title'), 'Условия этого узла')
  assert.equal(translate('en', 'footer.terms'), 'Terms')
  assert.equal(translate('ru', 'terms.intro', { domain: 'aiki.wiki' }).includes('aiki.wiki'), true)

  for (const locale of ['en', 'ru']) {
    const sections = termsSections(locale)
    assert.equal(sections.length >= 10, true)
    const text = sections.flatMap(section => [section.title, ...section.paragraphs]).join('\n')
    assert.equal(/public domain|общественн/i.test(text), true)
    assert.match(text, /model training|обучения моделей/i)
    assert.equal(/CC0|Creative Commons|можно всё/i.test(text), false)
    assert.match(text, /WPG/)
    assert.match(text, /\{domain\}/)
  }

  const page = await readFile(path.join(root, 'app/pages/terms.vue'), 'utf8')
  const footer = await readFile(path.join(root, 'app/app.vue'), 'utf8')
  const composer = await readFile(path.join(root, 'app/components/TopicComposer.vue'), 'utf8')
  assert.match(page, /data-testid="terms-page"/)
  assert.match(page, /termsSections/)
  assert.match(footer, /data-testid="footer-terms"/)
  assert.match(footer, /to="\/terms"/)
  assert.match(composer, /to="\/terms"/)
}
