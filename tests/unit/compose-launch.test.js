import { spawnSync } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')

export async function run({ assert }) {
  const dockerfile = await readFile(path.join(root, 'Dockerfile'), 'utf8')
  const compose = await readFile(path.join(root, 'compose.yaml'), 'utf8')
  const readme = await readFile(path.join(root, 'README.md'), 'utf8')
  const entrypoint = await readFile(path.join(root, 'docker/entrypoint.sh'), 'utf8')

  assert.match(dockerfile, /FROM node:22-alpine AS deps/)
  assert.match(dockerfile, /FROM deps AS build/)
  assert.match(dockerfile, /FROM node:22-alpine AS migrate-deps/)
  assert.match(dockerfile, /FROM alpine:3\.22 AS migrate/)
  assert.match(dockerfile, /COPY database\/migrations database\/migrations/)
  assert.match(dockerfile, /COPY scripts\/migrate\.js scripts\/migrate\.js/)
  assert.match(dockerfile, /CMD \["node", "scripts\/migrate\.js"\]/)
  assert.match(dockerfile, /FROM alpine:3\.22 AS runtime/)
  assert.equal(dockerfile.trim().lastIndexOf('FROM '), dockerfile.lastIndexOf('FROM alpine:3.22 AS runtime'))
  assert.match(dockerfile, /ENTRYPOINT \["\/entrypoint\.sh"\]/)
  assert.doesNotMatch(dockerfile, /npm run db:migrate/)

  assert.match(compose, /target: migrate/)
  assert.match(compose, /command: \["node", "scripts\/migrate\.js"\]/)
  assert.match(compose, /condition: service_completed_successfully/)
  assert.doesNotMatch(compose, /npm run db:migrate/)
  assert.match(readme, /docker compose up --build -d/)

  if (process.platform !== 'win32') {
    const mapped = spawnSync('sh', [path.join(root, 'docker/entrypoint.sh'), 'sh', '-c', "printf '%s\\n' \"$NUXT_DATABASE_URL\" \"$NUXT_RATE_LIMIT_SECRET\" \"$NUXT_READ_HMAC_SECRET\""], {
      env: {
        PATH: process.env.PATH,
        DATABASE_URL: 'postgres://aiki:secret@db:5432/aiki',
        RATE_LIMIT_SECRET: 'rate-secret',
        READ_HMAC_SECRET: 'read-secret',
      },
      encoding: 'utf8',
    })
    assert.equal(mapped.status, 0, mapped.stderr)
    assert.equal(mapped.stdout, 'postgres://aiki:secret@db:5432/aiki\nrate-secret\nread-secret\n')

    const explicit = spawnSync('sh', [path.join(root, 'docker/entrypoint.sh'), 'sh', '-c', 'printf %s "$NUXT_DATABASE_URL"'], {
      env: {
        PATH: process.env.PATH,
        DATABASE_URL: 'postgres://from-database',
        NUXT_DATABASE_URL: 'postgres://from-nuxt',
      },
      encoding: 'utf8',
    })
    assert.equal(explicit.status, 0, explicit.stderr)
    assert.equal(explicit.stdout, 'postgres://from-nuxt')
  }
  assert.match(entrypoint, /NUXT_DATABASE_URL/)
}
