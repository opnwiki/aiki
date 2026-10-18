import { readdir } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import assert from 'node:assert/strict'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const testRoot = path.join(root, 'tests')
const files = []

async function collect(directory) {
  let entries
  try {
    entries = await readdir(directory, { withFileTypes: true })
  } catch (error) {
    if (error.code === 'ENOENT') return
    throw error
  }

  for (const entry of entries) {
    const fullPath = path.join(directory, entry.name)
    if (entry.isDirectory()) await collect(fullPath)
    else if (entry.name.endsWith('.test.js')) files.push(fullPath)
  }
}

await collect(testRoot)
if (files.length === 0) {
  console.error('No tests found under tests/.')
  process.exitCode = 1
} else {
  let failed = 0
  for (const file of files.sort()) {
    try {
      const suite = await import(pathToFileURL(file).href)
      assert.equal(typeof suite.run, 'function', `${path.relative(root, file)} must export async/sync run()`)
      await suite.run({ assert })
      console.log(`PASS ${path.relative(root, file)}`)
    } catch (error) {
      failed += 1
      console.error(`FAIL ${path.relative(root, file)}`)
      console.error(error?.stack || error)
    }
  }

  console.log(`Ran ${files.length} test file(s); ${failed} failed.`)
  if (failed > 0) process.exitCode = 1
}
