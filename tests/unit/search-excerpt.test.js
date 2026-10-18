import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { searchExcerpt } from '../../app/utils/search-excerpt.js'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')

export async function run({ assert }) {
  assert.equal(searchExcerpt(''), '')
  assert.equal(searchExcerpt('# Title\n\nA short note.'), 'Title A short note.')
  const long = `${'Visible opening about sources and citations. '.repeat(6)}TAILTOKEN9f3`
  const preview = searchExcerpt(long)
  assert.ok(preview.length <= 141, preview)
  assert.ok(preview.endsWith('…'))
  assert.match(preview, /^Visible opening/)
  assert.doesNotMatch(preview, /TAILTOKEN9f3/)
  assert.equal(searchExcerpt('Exact title'), 'Exact title')

  const home = await readFile(path.join(root, 'app/pages/index.vue'), 'utf8')
  const topics = await readFile(path.join(root, 'app/pages/topics/index.vue'), 'utf8')
  assert.match(home, /line-clamp-2/)
  assert.match(topics, /data-testid="result-excerpt"/)
  assert.match(topics, /line-clamp-2/)
}
