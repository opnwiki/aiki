export function validateMigrationState({ hasLedger, hasApplicationSchema, migrations, appliedRows }) {
  const versions = migrations.map(migration => migration.version)
  if (new Set(versions).size !== versions.length) {
    throw new Error('Duplicate migration version found; use exactly one migration file per version.')
  }

  if (!hasLedger && hasApplicationSchema) {
    throw new Error('Existing AIKI schema has no migration ledger; refusing automatic adoption. Back up the database and follow docs/database-adoption.md.')
  }

  const known = new Map(migrations.map(migration => [migration.version, migration]))
  const applied = new Map(appliedRows.map(row => [row.version, row.checksum]))

  if (hasApplicationSchema && applied.size === 0) {
    throw new Error('Existing AIKI schema has an empty migration ledger; refusing automatic adoption. Back up the database and follow docs/database-adoption.md.')
  }
  if (applied.size > 0 && !hasApplicationSchema) {
    throw new Error('Migration ledger exists but the core AIKI schema is missing; refusing to continue.')
  }

  for (const [version, checksum] of applied) {
    const migration = known.get(version)
    if (!migration) throw new Error(`Database migration ledger contains unknown version ${version}; review it before continuing.`)
    if (migration.checksum !== checksum) {
      throw new Error(`Migration ${migration.name} changed after it was applied. Add a new migration instead.`)
    }
  }

  const expectedPrefix = migrations.slice(0, applied.size)
  if (expectedPrefix.some((migration, index) => migration.version !== appliedRows[index]?.version)) {
    throw new Error('Database migration ledger is not a contiguous prefix; refusing to apply migrations out of order.')
  }
}
