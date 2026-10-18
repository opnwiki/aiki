import { readdir } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const roots = ['app', 'server', 'scripts', 'tests']
const files = []

async function collect(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const fullPath = path.join(directory, entry.name)
    if (entry.isDirectory()) await collect(fullPath)
    else if (entry.name.endsWith('.js') || entry.name.endsWith('.mjs')) files.push(fullPath)
  }
}

for (const name of roots) await collect(path.join(root, name))
files.push(path.join(root, 'nuxt.config.js'))

for (const file of files) {
  const result = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' })
  if (result.status !== 0) {
    process.stderr.write(result.stderr)
    process.exit(result.status || 1)
  }
}

console.log(`Syntax checked ${files.length} JavaScript files.`)
