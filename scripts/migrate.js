import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
import pg from 'pg'
import { validateMigrationState } from '../server/utils/migration-safety.js'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const migrationsDir = path.join(root, 'database/migrations')
const connectionString = process.env.DATABASE_URL || process.env.NUXT_DATABASE_URL
if (!connectionString) throw new Error('DATABASE_URL or NUXT_DATABASE_URL is required')

const migrations = (await readdir(migrationsDir))
  .filter(name => /^\d{3}_[a-z0-9_]+\.sql$/.test(name))
  .sort()

if (migrations.length === 0) throw new Error('No versioned SQL migrations found')

const migrationFiles = await Promise.all(migrations.map(async name => {
  const sql = await readFile(path.join(migrationsDir, name), 'utf8')
  return { name, version: name.slice(0, 3), sql, checksum: sha256(sql) }
}))

const pool = new pg.Pool({ connectionString, max: 2 })
const client = await pool.connect()
try {
  await client.query('SELECT pg_advisory_lock($1)', [714120260927])

  const ledgerExistsResult = await client.query("SELECT to_regclass('public.schema_migrations') IS NOT NULL AS exists")
  const hasLedger = ledgerExistsResult.rows[0].exists
  const schemaResult = await client.query(`
    SELECT EXISTS (
      SELECT 1
        FROM pg_class relation
        JOIN pg_namespace schema ON schema.oid = relation.relnamespace
       WHERE schema.nspname = 'public'
         AND relation.relkind IN ('r', 'p')
         AND relation.relname <> 'schema_migrations'
    ) AS exists
  `)
  const hasApplicationSchema = schemaResult.rows[0].exists

  let appliedRows = []
  if (hasLedger) {
    const appliedResult = await client.query('SELECT version, checksum FROM schema_migrations ORDER BY version')
    appliedRows = appliedResult.rows
  }
  validateMigrationState({ hasLedger, hasApplicationSchema, migrations: migrationFiles, appliedRows })

  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version TEXT PRIMARY KEY,
      checksum TEXT NOT NULL,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `)

  for (const { name, version, sql, checksum } of migrationFiles) {
    if (appliedRows.some(row => row.version === version)) continue

    await client.query('BEGIN')
    try {
      await client.query(sql)
      await client.query('INSERT INTO schema_migrations (version, checksum) VALUES ($1, $2)', [version, checksum])
      await client.query('COMMIT')
      console.log(`Applied ${name}`)
      appliedRows.push({ version, checksum })
    } catch (error) {
      await client.query('ROLLBACK')
      throw error
    }
  }

  console.log(`Database schema is current (${migrationFiles.length} migration(s) known).`)
} finally {
  try {
    await client.query('SELECT pg_advisory_unlock($1)', [714120260927])
  } finally {
    client.release()
    await pool.end()
  }
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex')
}
