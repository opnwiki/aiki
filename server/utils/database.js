import pg from 'pg'

const { Pool } = pg
let pool

export function getDatabase() {
  const { databaseUrl } = useRuntimeConfig()
  if (!databaseUrl) {
    throw createError({ statusCode: 503, statusMessage: 'Database is not configured' })
  }
  pool ||= new Pool({ connectionString: databaseUrl, max: 10, idleTimeoutMillis: 30_000 })
  return pool
}

export async function queryDatabase(text, values = []) {
  try {
    return await getDatabase().query(text, values)
  } catch (error) {
    console.error('[database] query failed', error.message)
    throw createError({ statusCode: 503, statusMessage: 'Database temporarily unavailable' })
  }
}
