import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')

export async function run({ assert }) {
  const doc = await readFile(path.join(root, 'docs/use-cases.md'), 'utf8')
  for (const marker of [
    'documentation',
    'proposal',
    'fandom',
    'API',
    'GET /api/mesh',
    '/n/',
    'internet',
  ]) {
    assert.ok(doc.includes(marker), marker)
  }
  const mesh = await readFile(path.join(root, 'docs/node-mesh.md'), 'utf8')
  assert.ok(mesh.includes('use-cases.md'), 'mesh doc points at the examples')
  const readme = await readFile(path.join(root, 'README.md'), 'utf8')
  assert.ok(readme.includes('docs/use-cases.md'), 'readme points at the examples')
}
