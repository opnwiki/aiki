import { spawnSync } from 'node:child_process'
import { createServer } from 'node:net'
import { randomBytes, createHash } from 'node:crypto'
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const migrationsDir = path.join(root, 'database/migrations')
const project = `aiki-accept-${randomBytes(8).toString('hex')}`
const tempDir = await mkdtemp(path.join(os.tmpdir(), 'aiki-compose-accept-'))
const envFile = path.join(tempDir, '.env')
let composePrefix = []
let failure = null
let cleanupFailure = null

function docker(args, { allowFailure = false, timeout = 600_000 } = {}) {
  const result = spawnSync('docker', [...composePrefix, ...args], {
    cwd: root,
    encoding: 'utf8',
    timeout,
    maxBuffer: 8 * 1024 * 1024,
  })
  if (result.error) throw result.error
  if (!allowFailure && result.status !== 0) {
    const details = [result.stdout, result.stderr].filter(Boolean).join('\n').trim()
    throw new Error(`docker ${composePrefix.join(' ')} ${args.join(' ')} failed (${result.status}):\n${details}`)
  }
  return result
}

async function unusedLoopbackPort() {
  const server = createServer()
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const { port } = server.address()
  await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
  return port
}

function sql(query) {
  const result = docker(['exec', '-T', 'db', 'psql', '-v', 'ON_ERROR_STOP=1', '-U', 'aiki', '-d', 'aiki', '-Atqc', query])
  return result.stdout.trim()
}

async function waitForApp() {
  const probe = "const r = await fetch('http://127.0.0.1:3000/api/health'); if (!r.ok) process.exit(1); const b = await r.json(); if (b.status !== 'ok' || b.database !== 'ok') process.exit(1)"
  for (let attempt = 0; attempt < 90; attempt += 1) {
    const result = docker(['exec', '-T', 'app', 'node', '--input-type=module', '-e', probe], { allowFailure: true, timeout: 10_000 })
    if (result.status === 0) return
    await new Promise(resolve => setTimeout(resolve, 1_000))
  }
  throw new Error('Compose app/database did not become healthy within 90 seconds')
}

async function expectedMigrations() {
  const files = (await readdir(migrationsDir)).filter(name => /^\d{3}_[a-z0-9_]+\.sql$/.test(name)).sort()
  if (files.length === 0) throw new Error('No versioned migrations found')
  return Promise.all(files.map(async name => {
    const contents = await readFile(path.join(migrationsDir, name))
    return [name.slice(0, 3), createHash('sha256').update(contents).digest('hex')]
  }))
}

function assertLedger(expected) {
  const rows = sql('SELECT version || \'=\' || checksum FROM schema_migrations ORDER BY version')
    .split('\n').filter(Boolean)
  const actual = rows.map(row => row.split('='))
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`Migration ledger does not match source files. Expected ${expected.length} exact version/checksum entries; found ${actual.length}.`)
  }
}

try {
  const version = spawnSync('docker', ['compose', 'version'], { encoding: 'utf8', timeout: 10_000 })
  if (version.error) throw version.error
  if (version.status !== 0) throw new Error('Docker Compose v2 is required for this disposable acceptance test')

  const hostPort = await unusedLoopbackPort()
  const secret = () => randomBytes(32).toString('hex')
  await writeFile(envFile, [
    'POSTGRES_DB=aiki',
    'POSTGRES_USER=aiki',
    `POSTGRES_PASSWORD=${secret()}`,
    `RATE_LIMIT_SECRET=${secret()}`,
    `READ_HMAC_SECRET=${secret()}`,
    `AIKI_HOST_PORT=${hostPort}`,
    'NODE_DOMAIN=compose-acceptance.invalid',
    'SITE_URL=http://127.0.0.1',
    '',
  ].join('\n'), { mode: 0o600 })

  composePrefix = ['compose', '-p', project, '--env-file', envFile, '-f', 'compose.yaml']
  if (process.env.AIKI_ACCEPT_IMAGE) {
    const image = process.env.AIKI_ACCEPT_IMAGE
    const migrationImage = process.env.AIKI_ACCEPT_MIGRATION_IMAGE
    const platform = process.env.AIKI_ACCEPT_PLATFORM || 'linux/amd64'
    if (!/^[a-z0-9][a-z0-9._/-]*:[A-Za-z0-9_.-]+$/.test(image) || !/^[a-z0-9][a-z0-9._/-]*:[A-Za-z0-9_.-]+$/.test(migrationImage || '')) throw new Error('Invalid acceptance image reference')
    if (!['linux/amd64', 'linux/arm64'].includes(platform)) throw new Error('Invalid acceptance platform')
    const override = path.join(tempDir, 'images.yaml')
    await writeFile(override, `services:\n  app:\n    image: ${image}\n    platform: ${platform}\n    build: !reset null\n  migrate:\n    image: ${migrationImage}\n    platform: ${platform}\n    build: !reset null\n  db:\n    platform: ${platform}\n`)
    composePrefix.push('-f', override)
  }
  console.log(`Compose acceptance project: ${project}`)
  docker(['config', '-q'])
  const migrations = await expectedMigrations()

  docker(['up', '--build', '-d'])
  await waitForApp()
  assertLedger(migrations)

  const repeat = docker(['run', '--rm', 'migrate'])
  if (!/Database schema is current/.test(repeat.stdout)) {
    throw new Error('A second migration run did not report an already-current schema')
  }
  assertLedger(migrations)

  const marker = randomBytes(12).toString('hex')
  sql(`CREATE TABLE acceptance_restart_marker (marker TEXT PRIMARY KEY); INSERT INTO acceptance_restart_marker(marker) VALUES ('${marker}')`)
  docker(['restart', 'db', 'app'])
  await waitForApp()
  if (sql('SELECT marker FROM acceptance_restart_marker') !== marker) {
    throw new Error('Disposable database marker did not survive service restart')
  }

  docker(['down', '-v', '--remove-orphans'])
  docker(['up', '--build', '-d'])
  await waitForApp()
  if (sql("SELECT coalesce(to_regclass('public.acceptance_restart_marker')::text, '')") !== '') {
    throw new Error('Documented disposable reset did not remove the isolated test volume')
  }
  assertLedger(migrations)
  console.log(`PASS Compose config, clean migrations (${migrations.length}), repeat migration, restart persistence, isolated volume reset, and clean reinitialization`)
} catch (error) {
  failure = error
} finally {
  if (composePrefix.length) {
    const cleanup = docker(['down', '-v', '--remove-orphans'], { allowFailure: true, timeout: 120_000 })
    if (cleanup.error || cleanup.status !== 0) {
      cleanupFailure = cleanup.error || new Error([cleanup.stdout, cleanup.stderr].filter(Boolean).join('\n').trim() || `docker compose cleanup exited ${cleanup.status}`)
    }
  }
  await rm(tempDir, { recursive: true, force: true })
}

if (failure) {
  console.error(failure.stack || failure)
  if (cleanupFailure) console.error(`Disposable project cleanup also failed; inspect only project ${project}: ${cleanupFailure.message}`)
  process.exitCode = 1
} else if (cleanupFailure) {
  console.error(`Disposable project cleanup failed; inspect only project ${project}: ${cleanupFailure.message}`)
  process.exitCode = 1
}
