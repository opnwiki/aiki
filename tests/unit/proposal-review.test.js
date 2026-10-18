import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')

export async function run({ assert }) {
  const route = await readFile(path.join(root, 'server/api/topics/[slug]/proposals/[proposalId].patch.js'), 'utf8')
  assert.match(route, /review_comment = \$3, result_revision_id = \$4::uuid/)
  assert.match(route, /VALUES \(\$1, NULLIF\(\$2::text, ''\), NULLIF\(\$3::text, ''\), 'external', \$4::date\)/)
  assert.match(route, /\[source\.url, source\.title, source\.publisher, source\.publishedAt \|\| null\]/)
  assert.doesNotMatch(route, /\$6::date/)
}
