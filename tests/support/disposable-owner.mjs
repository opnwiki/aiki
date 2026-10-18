import pg from 'pg'

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]'])

export function approvedDisposableDatabaseName(connectionString = process.env.DATABASE_URL, env = process.env) {
  if (!connectionString) return null
  let databaseUrl
  try {
    databaseUrl = new URL(connectionString)
  } catch {
    return null
  }
  if (!['postgres:', 'postgresql:'].includes(databaseUrl.protocol) || !LOOPBACK_HOSTS.has(databaseUrl.hostname)) return null
  const databaseName = decodeURIComponent(databaseUrl.pathname.replace(/^\//, ''))
  const ciDatabase = env.GITHUB_ACTIONS === 'true' && databaseName === 'aiki_test'
  const localDatabase = /^aiki_(mvp_test|live_test)_[a-z0-9_]+$/.test(databaseName)
  return ciDatabase || localDatabase ? databaseName : null
}

export function assertApprovedDisposableDatabase(connectionString = process.env.DATABASE_URL, env = process.env) {
  const databaseName = approvedDisposableDatabaseName(connectionString, env)
  if (!databaseName) {
    throw new Error('Refusing to grant owner: DATABASE_URL must be a loopback disposable database (CI aiki_test, or local aiki_mvp_test_* / aiki_live_test_*).')
  }
  return databaseName
}

export async function promoteDisposableOwner(actorId, db, connectionString = process.env.DATABASE_URL, env = process.env) {
  assertApprovedDisposableDatabase(connectionString, env)
  const promoted = await db.query(
    "UPDATE actors SET role = 'owner' WHERE id = $1 AND kind = 'human' RETURNING role",
    [actorId],
  )
  if (promoted.rows[0]?.role !== 'owner') {
    throw new Error('Disposable owner promotion did not update the fixture account.')
  }
}

export async function promoteDisposableOwnerConnection(actorId, connectionString = process.env.DATABASE_URL, env = process.env) {
  assertApprovedDisposableDatabase(connectionString, env)
  const db = new pg.Client({ connectionString })
  await db.connect()
  try {
    await promoteDisposableOwner(actorId, db, connectionString, env)
  } finally {
    await db.end()
  }
}
