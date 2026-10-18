import {
  REHEARSAL_RESTORE_DATABASE,
  REHEARSAL_SOURCE_DATABASE,
  assertRehearsalDatabaseName,
  rehearsalConnection,
} from '../support/backup-rehearsal.mjs'

const adminUrl = 'postgres://aiki_test:secret@127.0.0.1:5432/postgres'

export function run({ assert }) {
  assert.equal(assertRehearsalDatabaseName(REHEARSAL_SOURCE_DATABASE), REHEARSAL_SOURCE_DATABASE)
  assert.equal(assertRehearsalDatabaseName(REHEARSAL_RESTORE_DATABASE), REHEARSAL_RESTORE_DATABASE)
  for (const name of ['aiki', 'aiki_test', 'postgres', 'aiki_mvp_test_rehearsal_src0739_extra', '']) {
    assert.throws(() => assertRehearsalDatabaseName(name), /disposable rehearsal pair/)
  }

  const source = new URL(rehearsalConnection(adminUrl, REHEARSAL_SOURCE_DATABASE))
  assert.equal(source.hostname, '127.0.0.1')
  assert.equal(source.pathname, `/${REHEARSAL_SOURCE_DATABASE}`)
  assert.equal(source.username, 'aiki_test')

  assert.throws(
    () => rehearsalConnection('postgres://aiki_test:secret@127.0.0.1:5432/aiki', REHEARSAL_SOURCE_DATABASE),
    /maintenance database/,
  )
  assert.throws(
    () => rehearsalConnection('postgres://aiki_test:secret@db.internal:5432/postgres', REHEARSAL_SOURCE_DATABASE),
    /loopback/,
  )
  assert.throws(
    () => rehearsalConnection('postgres://postgres:secret@127.0.0.1:5432/postgres', REHEARSAL_SOURCE_DATABASE),
    /non-superuser/,
  )
  assert.throws(
    () => rehearsalConnection('postgres://aiki_test:secret@127.0.0.1:5432/postgres', 'aiki'),
    /disposable rehearsal pair/,
  )
}
