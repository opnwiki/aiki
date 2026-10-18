const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]'])

export const REHEARSAL_SOURCE_DATABASE = 'aiki_mvp_test_rehearsal_src0739'
export const REHEARSAL_RESTORE_DATABASE = 'aiki_mvp_test_rehearsal_rst0739'
export const REHEARSAL_CONFIRMATION = 'I CONFIRM A BACKUP RESTORE REHEARSAL ON DISPOSABLE AIKI DATABASES'
const ALLOWED_DATABASES = new Set([REHEARSAL_SOURCE_DATABASE, REHEARSAL_RESTORE_DATABASE])

export function assertRehearsalDatabaseName(name) {
  if (!ALLOWED_DATABASES.has(name)) {
    throw new Error('Refusing to create, dump, restore, or drop a database outside the disposable rehearsal pair.')
  }
  return name
}

export function rehearsalConnection(adminUrl, databaseName) {
  assertRehearsalDatabaseName(databaseName)
  let url
  try {
    url = new URL(adminUrl)
  } catch {
    throw new Error('Rehearsal admin URL must be a loopback postgres connection to the maintenance database.')
  }
  if (!['postgres:', 'postgresql:'].includes(url.protocol) || !LOOPBACK_HOSTS.has(url.hostname)) {
    throw new Error('Rehearsal admin URL must use a loopback PostgreSQL host.')
  }
  const username = decodeURIComponent(url.username)
  if (!/^[a-z_][a-z0-9_]*$/.test(username) || username === 'postgres') {
    throw new Error('Rehearsal admin URL must use a non-superuser role that can own the disposable databases.')
  }
  const adminDatabase = decodeURIComponent(url.pathname.replace(/^\//, ''))
  if (adminDatabase !== 'postgres') {
    throw new Error('Rehearsal admin URL must point at the maintenance database named postgres, not an application database.')
  }
  url.pathname = `/${databaseName}`
  url.search = ''
  url.hash = ''
  return url.toString()
}
