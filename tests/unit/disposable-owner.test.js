import { approvedDisposableDatabaseName } from '../support/disposable-owner.mjs'

const ciEnv = { GITHUB_ACTIONS: 'true' }
const localEnv = {}

export function run({ assert }) {
  assert.equal(
    approvedDisposableDatabaseName('postgres://aiki_test:secret@127.0.0.1:5432/aiki_test', ciEnv),
    'aiki_test',
  )
  assert.equal(
    approvedDisposableDatabaseName('postgres://aiki_test:secret@127.0.0.1:5432/aiki_test', localEnv),
    null,
    'the exact CI database name is approved only while GitHub Actions is running',
  )
  assert.equal(
    approvedDisposableDatabaseName('postgresql://aiki:secret@localhost:5432/aiki_mvp_test_abc123', localEnv),
    'aiki_mvp_test_abc123',
  )
  assert.equal(
    approvedDisposableDatabaseName('postgres://aiki:secret@[::1]:5432/aiki_live_test_abc123', localEnv),
    'aiki_live_test_abc123',
  )
  assert.equal(approvedDisposableDatabaseName('postgres://aiki:secret@127.0.0.1:5432/aiki', ciEnv), null)
  assert.equal(approvedDisposableDatabaseName('postgres://aiki:secret@db.internal:5432/aiki_test', ciEnv), null)
  assert.equal(approvedDisposableDatabaseName('postgres://aiki:secret@127.0.0.1:5432/aiki_test_extra', ciEnv), null)
  assert.equal(approvedDisposableDatabaseName('', ciEnv), null)
  assert.equal(approvedDisposableDatabaseName('not a url', ciEnv), null)
}
