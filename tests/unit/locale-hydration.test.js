import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')

export async function run({ assert }) {
  const source = await readFile(path.join(root, 'app/composables/useLocale.js'), 'utf8')
  assert.match(source, /const initialLocale = normalizeLocale\(localeCookie\.value\) \|\| 'en'/)
  assert.match(source, /onMounted\(\(\) => \{/)
  assert.match(source, /const preferred = detectedLocale\(\)/)
  assert.doesNotMatch(source, /useRequestHeaders\(\['accept-language'\]\)/)
}
