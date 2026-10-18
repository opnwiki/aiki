import { rm } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const output = resolve(root, '.output')

// Nitro writes a large route tree and Windows can reject mkdir when a previous
// build left part of that tree behind. .output is generated and ignored, so a
// clean before every release build is safe and keeps the command repeatable.
await rm(output, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 })
