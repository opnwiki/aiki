import { spawn, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import pg from 'pg'
import {
  REHEARSAL_CONFIRMATION,
  REHEARSAL_RESTORE_DATABASE,
  REHEARSAL_SOURCE_DATABASE,
  assertRehearsalDatabaseName,
  rehearsalConnection,
} from '../tests/support/backup-rehearsal.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const migrationsDir = path.join(root, 'database/migrations')
const previousReleaseVersion = '014'
const adminUrl = process.env.AIKI_REHEARSAL_ADMIN_URL || ''
if (process.env.AIKI_BACKUP_REHEARSAL_CONFIRM !== REHEARSAL_CONFIRMATION || !adminUrl) {
  throw new Error(`Refusing rehearsal. Set AIKI_REHEARSAL_ADMIN_URL to a loopback maintenance connection and AIKI_BACKUP_REHEARSAL_CONFIRM=${JSON.stringify(REHEARSAL_CONFIRMATION)}.`)
}

const sourceUrl = rehearsalConnection(adminUrl, REHEARSAL_SOURCE_DATABASE)
const restoreUrl = rehearsalConnection(adminUrl, REHEARSAL_RESTORE_DATABASE)
const admin = new URL(adminUrl)
const owner = decodeURIComponent(admin.username)
const tempDir = await mkdtemp(path.join(tmpdir(), 'aiki-backup-rehearsal-'))
const dumpPath = path.join(tempDir, 'pre-additive.dump')
const pgpassPath = path.join(tempDir, 'pgpass')
const appPort = 3016
let app

function postgresAdmin(args) {
  const result = spawnSync('sudo', ['-u', 'postgres', ...args], { encoding: 'utf8' })
  if (result.error) throw result.error
  if (result.status !== 0) {
    throw new Error(`postgres admin ${args[0]} failed (${result.status}): ${(result.stderr || result.stdout || '').trim()}`)
  }
}

function recreateDatabase(name) {
  assertRehearsalDatabaseName(name)
  postgresAdmin(['dropdb', '--if-exists', '--force', name])
  postgresAdmin(['createdb', '--owner', owner, name])
}

async function migrationFiles() {
  const names = (await readdir(migrationsDir)).filter(name => /^\d{3}_[a-z0-9_]+\.sql$/.test(name)).sort()
  return Promise.all(names.map(async name => {
    const sql = await readFile(path.join(migrationsDir, name), 'utf8')
    return { name, version: name.slice(0, 3), sql, checksum: createHash('sha256').update(sql).digest('hex') }
  }))
}

async function applyMigrations(connectionString, files) {
  const client = new pg.Client({ connectionString })
  await client.connect()
  try {
    await client.query('SELECT pg_advisory_lock($1)', [714120260927])
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version TEXT PRIMARY KEY,
        checksum TEXT NOT NULL,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `)
    const applied = await client.query('SELECT version FROM schema_migrations ORDER BY version')
    const appliedVersions = new Set(applied.rows.map(row => row.version))
    for (const file of files) {
      if (appliedVersions.has(file.version)) continue
      await client.query('BEGIN')
      try {
        await client.query(file.sql)
        await client.query('INSERT INTO schema_migrations (version, checksum) VALUES ($1, $2)', [file.version, file.checksum])
        await client.query('COMMIT')
      } catch (error) {
        await client.query('ROLLBACK')
        throw error
      }
    }
  } finally {
    try {
      await client.query('SELECT pg_advisory_unlock($1)', [714120260927])
    } finally {
      await client.end()
    }
  }
}

async function withClient(connectionString, fn) {
  const client = new pg.Client({ connectionString })
  await client.connect()
  try {
    return await fn(client)
  } finally {
    await client.end()
  }
}

async function ledger(connectionString) {
  return withClient(connectionString, async client => {
    const result = await client.query('SELECT version, checksum FROM schema_migrations ORDER BY version')
    return result.rows
  })
}

function assertLedger(rows, files) {
  if (rows.length !== files.length || rows.some((row, index) => row.version !== files[index].version || row.checksum !== files[index].checksum)) {
    throw new Error(`Migration ledger does not match the selected files (${rows.length} rows, ${files.length} files).`)
  }
}

async function registerLikePreviousRelease(connectionString, username) {
  return withClient(connectionString, async client => {
    await client.query('BEGIN')
    try {
      await client.query('LOCK TABLE actors IN SHARE ROW EXCLUSIVE MODE')
      const existing = await client.query("SELECT id FROM actors WHERE kind = 'human' LIMIT 1")
      const role = existing.rowCount === 0 ? 'owner' : 'member'
      const node = await client.query('SELECT id FROM nodes WHERE is_home = true LIMIT 1')
      const inserted = await client.query(
        `INSERT INTO actors (node_id, kind, username, email, password_hash, role)
         VALUES ($1, 'human', $2, NULL, $3, $4)
         RETURNING id, node_id, kind, username, email, role, created_at`,
        [node.rows[0]?.id || null, username, 'rehearsal-hash-not-a-credential', role],
      )
      const actor = inserted.rows[0]
      await client.query(
        `INSERT INTO actor_audit_log (actor_id, action, target_type, target_id, details)
         VALUES ($1::uuid, 'account_registered', 'actor', $2::text, jsonb_build_object('role', $3::text))`,
        [actor.id, actor.id, role],
      )
      await client.query('COMMIT')
      return actor
    } catch (error) {
      await client.query('ROLLBACK')
      throw error
    }
  })
}

async function previousReleaseLogin(connectionString, username) {
  return withClient(connectionString, async client => {
    const result = await client.query(
      `SELECT id, node_id, kind, username, email, role, password_hash
         FROM actors
        WHERE kind = 'human'
          AND account_status = 'active'
          AND lower(username) = lower($1)
        LIMIT 1`,
      [username],
    )
    return result.rows[0]
  })
}

async function currentReleaseLogin(connectionString, username) {
  return withClient(connectionString, async client => {
    const result = await client.query(
      `SELECT id, public_id, node_id, kind, username, email, role, password_hash
         FROM actors
        WHERE kind = 'human'
          AND account_status = 'active'
          AND lower(username) = lower($1)
        LIMIT 1`,
      [username],
    )
    return result.rows[0]
  })
}

function libpqEnv() {
  return { ...process.env, PGPASSFILE: pgpassPath }
}

function connectionTarget(databaseName) {
  assertRehearsalDatabaseName(databaseName)
  const host = admin.hostname.startsWith('[') || !admin.hostname.includes(':')
    ? admin.hostname
    : `[${admin.hostname}]`
  return `postgres://${owner}@${host}:${admin.port || 5432}/${databaseName}`
}

function dumpDatabase() {
  const result = spawnSync('pg_dump', [
    '--format=custom',
    '--no-owner',
    '--file', dumpPath,
    '--dbname', connectionTarget(REHEARSAL_SOURCE_DATABASE),
  ], { encoding: 'utf8', env: libpqEnv() })
  if (result.status !== 0) throw new Error(`pg_dump failed: ${(result.stderr || '').trim()}`)
}

function listDump() {
  const result = spawnSync('pg_restore', ['--list', dumpPath], { encoding: 'utf8' })
  if (result.status !== 0) throw new Error(`pg_restore --list failed: ${(result.stderr || '').trim()}`)
  if (!result.stdout.includes('schema_migrations')) throw new Error('Backup listing does not contain schema_migrations.')
  return result.stdout
}

function restoreDump() {
  const result = spawnSync('pg_restore', [
    '--no-owner',
    '--exit-on-error',
    '--dbname', connectionTarget(REHEARSAL_RESTORE_DATABASE),
    dumpPath,
  ], { encoding: 'utf8', env: libpqEnv() })
  if (result.status !== 0) throw new Error(`pg_restore failed: ${(result.stderr || result.stdout || '').trim()}`)
}

async function startCurrentApp(connectionString) {
  const env = { ...process.env }
  for (const name of ['NERON_API_KEY', 'NERON_API_BASE', 'NUXT_NERON_API_KEY', 'NUXT_NERON_API_BASE', 'NITRO_NERON_API_KEY', 'NITRO_NERON_API_BASE']) delete env[name]
  env.DATABASE_URL = connectionString
  env.NUXT_DATABASE_URL = connectionString
  env.NITRO_DATABASE_URL = connectionString
  env.NODE_ENV = 'production'
  env.HOST = '127.0.0.1'
  env.PORT = String(appPort)
  env.RATE_LIMIT_SECRET = 'ci-rate-limit-secret-not-for-production'
  env.NUXT_RATE_LIMIT_SECRET = env.RATE_LIMIT_SECRET
  env.READ_HMAC_SECRET = 'ci-read-hmac-secret-not-for-production'
  env.NUXT_READ_HMAC_SECRET = env.READ_HMAC_SECRET
  const child = spawn(process.execPath, [path.join(root, '.output/server/index.mjs')], {
    cwd: root,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let logs = ''
  child.stdout.on('data', chunk => { logs += chunk })
  child.stderr.on('data', chunk => { logs += chunk })
  const deadline = Date.now() + 20_000
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`Current app exited before health: ${logs}`)
    try {
      const health = await fetch(`http://127.0.0.1:${appPort}/api/health`, { signal: AbortSignal.timeout(1000) })
      if (health.ok) {
        const body = await health.json()
        if (body.status === 'ok' && body.database === 'ok') return child
      }
    } catch { /* still starting */ }
    await new Promise(resolve => setTimeout(resolve, 200))
  }
  child.kill('SIGTERM')
  throw new Error(`Current app did not become healthy: ${logs}`)
}

async function actorCount(connectionString, username) {
  return withClient(connectionString, async client => {
    const result = await client.query('SELECT count(*)::int AS count FROM actors WHERE username = $1', [username])
    return result.rows[0].count
  })
}

try {
  const files = await migrationFiles()
  const baseline = files.filter(file => file.version <= previousReleaseVersion)
  const additive = files.filter(file => file.version > previousReleaseVersion)
  if (baseline.length === 0 || additive.length === 0 || baseline.at(-1).version !== previousReleaseVersion) {
    throw new Error('Expected migrations through 014 and at least one later additive migration.')
  }

  recreateDatabase(REHEARSAL_SOURCE_DATABASE)
  recreateDatabase(REHEARSAL_RESTORE_DATABASE)
  await writeFile(pgpassPath, [
    `${admin.hostname}:${admin.port || 5432}:*:${owner}:${decodeURIComponent(admin.password)}`,
  ].join('\n'), { mode: 0o600 })

  await applyMigrations(sourceUrl, baseline)
  assertLedger(await ledger(sourceUrl), baseline)
  const before = await registerLikePreviousRelease(sourceUrl, 'rehearsal_before')
  if (!before?.id) throw new Error('Previous-release registration did not insert the baseline account.')

  dumpDatabase()
  listDump()
  const dumpBytes = await readFile(dumpPath)
  const dumpSha256 = createHash('sha256').update(dumpBytes).digest('hex')

  await applyMigrations(sourceUrl, files)
  assertLedger(await ledger(sourceUrl), files)
  const after = await registerLikePreviousRelease(sourceUrl, 'rehearsal_after')
  const rolledBackLogin = await previousReleaseLogin(sourceUrl, 'rehearsal_after')
  const currentLogin = await currentReleaseLogin(sourceUrl, 'rehearsal_after')
  if (rolledBackLogin?.id !== after.id || currentLogin?.id !== after.id) {
    throw new Error('Previous-release and current login lookups did not see the account created after the additive migration.')
  }
  if (!/^\d{14}$/.test(String(currentLogin.public_id))) {
    throw new Error('Additive migration did not assign a 14-digit public ID when the previous release omitted that column.')
  }
  await withClient(sourceUrl, client => client.query(
    `INSERT INTO actor_token_ledger (actor_id, amount, reason, source_type, source_id, idempotency_key, description)
     VALUES ($1, 1, 'article_accepted', 'writing_task', $1, 'rehearsal-previous-release-ledger', 'rehearsal previous-release ledger insert')`,
    [after.id],
  ))

  restoreDump()
  assertLedger(await ledger(restoreUrl), baseline)
  if (await actorCount(restoreUrl, 'rehearsal_before') !== 1 || await actorCount(restoreUrl, 'rehearsal_after') !== 0) {
    throw new Error('Restored database does not match the pre-additive snapshot.')
  }
  if (await actorCount(sourceUrl, 'rehearsal_before') !== 1 || await actorCount(sourceUrl, 'rehearsal_after') !== 1) {
    throw new Error('Restore changed the source database.')
  }
  const restoredLogin = await previousReleaseLogin(restoreUrl, 'rehearsal_before')
  if (restoredLogin?.id !== before.id) throw new Error('Previous-release login failed on the restored snapshot.')
  try {
    await currentReleaseLogin(restoreUrl, 'rehearsal_before')
    throw new Error('Current application SQL unexpectedly succeeded on the pre-additive snapshot.')
  } catch (error) {
    if (error.code !== '42703') throw error
  }

  app = await startCurrentApp(sourceUrl)
  console.log(`Backup/restore rehearsal passed. Dump SHA-256 ${dumpSha256}. Source ledger ${files.length}. Restored ledger ${baseline.length}. Previous-release writes still succeed after migrations ${additive.map(file => file.version).join(', ')}.`)
} finally {
  if (app) app.kill('SIGTERM')
  for (const name of [REHEARSAL_SOURCE_DATABASE, REHEARSAL_RESTORE_DATABASE]) {
    try {
      postgresAdmin(['dropdb', '--if-exists', '--force', name])
    } catch (error) {
      console.error(error.message)
    }
  }
  await rm(tempDir, { recursive: true, force: true })
}
