import { randomBytes } from 'node:crypto'
import { access, copyFile, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const envPath = path.join(root, '.env')
const examplePath = path.join(root, '.env.example')

try {
  await access(envPath)
  console.error('.env already exists; leaving it unchanged.')
  process.exitCode = 1
} catch (error) {
  if (error.code !== 'ENOENT') throw error
}

const template = await readFile(examplePath, 'utf8')
const postgresPassword = randomBytes(32).toString('base64url')
const replacements = {
  POSTGRES_PASSWORD: postgresPassword,
  DATABASE_URL: `postgres://aiki:${postgresPassword}@localhost:5432/aiki`,
  RATE_LIMIT_SECRET: randomBytes(32).toString('base64url'),
  READ_HMAC_SECRET: randomBytes(32).toString('base64url'),
}
const output = template.replace(/^([A-Z_]+)=.*$/gm, (line, key) => `${key}=${replacements[key] || line.slice(line.indexOf('=') + 1)}`)
await writeFile(envPath, output, { mode: 0o600, flag: 'wx' })
console.log('Created .env with fresh random secrets. Keep it private and never commit it.')
console.log('Use: docker compose up --build -d')
console.log('Then open the site and register: the first account becomes the node owner.')
