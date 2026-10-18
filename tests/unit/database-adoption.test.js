import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { validateMigrationState } from '../../server/utils/migration-safety.js'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const initialLegacy = await readFile(path.join(root, 'database/init/001_initial.sql'), 'utf8')
const initialMigration = await readFile(path.join(root, 'database/migrations/001_initial.sql'), 'utf8')
const migrationNames = ['001_initial.sql', '002_accounts_and_audit.sql', '003_auth_rate_limits.sql', '004_bootstrap_and_rate_limit_secret.sql', '005_topic_readers.sql', '006_edit_proposal_review.sql', '007_revision_integrity.sql', '008_citation_context_integrity.sql', '009_agent_credentials.sql', '010_article_authorship_disclosure.sql', '011_search_article_orders.sql', '012_article_writing_tasks.sql', '013_writing_authorship_modes.sql', '014_wpg_ledger.sql', '015_public_actor_ids.sql', '016_agent_run_wallet.sql', '017_node_public_counts.sql', '018_reply_thread_indexes.sql']

export async function run({ assert }) {
  assert.equal(initialLegacy.replace(/\r\n/g, '\n').replace(/\n-- Starter records are clearly-labelled local fixtures, not production examples\.\n/, '\n'), initialMigration.replace(/\r\n/g, '\n'), 'historical bootstrap and v001 differ only by its removed explanatory comment')
  const initialChecksum = createHash('sha256').update(initialMigration).digest('hex')
  assert.match(initialChecksum, /^[a-f0-9]{64}$/)
  for (const name of migrationNames) {
    const migration = await readFile(path.join(root, 'database/migrations', name), 'utf8')
    assert.ok(migration.length > 0, `${name} should be present and non-empty`)
    assert.match(name, /^\d{3}_[a-z0-9_]+\.sql$/)
  }
  const orders = await readFile(path.join(root, 'database/migrations/011_search_article_orders.sql'), 'utf8')
  assert.match(orders, /client_ip INET NOT NULL/)
  assert.match(orders, /statica_response JSONB NOT NULL/)
  assert.match(orders, /BEFORE UPDATE OR DELETE/)
  assert.match(orders, /ON DELETE RESTRICT/)
  assert.doesNotMatch(orders, /DELETE FROM article_order_assessments/i)

  const tokenLedger = await readFile(path.join(root, 'database/migrations/014_wpg_ledger.sql'), 'utf8')
  assert.match(tokenLedger, /CREATE TABLE IF NOT EXISTS actor_token_ledger/)
  assert.match(tokenLedger, /actor_id UUID NOT NULL REFERENCES actors\(id\) ON DELETE RESTRICT/)
  assert.match(tokenLedger, /amount BIGINT NOT NULL CHECK \(amount <> 0\)/)
  assert.match(tokenLedger, /idempotency_key TEXT NOT NULL UNIQUE/)
  assert.match(tokenLedger, /BEFORE UPDATE OR DELETE/)
  assert.match(tokenLedger, /no cash value or redemption policy is implied/i)
  assert.doesNotMatch(tokenLedger, /INSERT INTO actor_token_ledger/i, 'migration must not grant unbacked starter tokens')

  const publicCounts = await readFile(path.join(root, 'database/migrations/017_node_public_counts.sql'), 'utf8')
  assert.match(publicCounts, /ADD COLUMN IF NOT EXISTS show_public_counts BOOLEAN NOT NULL DEFAULT true/)
  const taskMigration = await readFile(path.join(root, "database/migrations/012_article_writing_tasks.sql"), "utf8")
  assert.match(taskMigration, /CREATE TABLE IF NOT EXISTS article_writing_tasks/)
  const adoptionGuide = await readFile(path.join(root, 'docs/database-adoption.md'), 'utf8')
  assert.match(adoptionGuide, /does not automatically adopt, modify, or delete/i)
  assert.match(adoptionGuide, /disposable restored clone/i)
  assert.match(adoptionGuide, /Do not .*mark migrations 002–008 as applied/i)
  assert.match(adoptionGuide, /Migration 008 backfills citation topic ownership/i)
  assert.match(adoptionGuide, /backup/i)

  migrationNames.push("012_article_writing_tasks.sql", "013_writing_authorship_modes.sql")
  const migrations = migrationNames.map((name, index) => ({ version: String(index + 1).padStart(3, '0'), name, checksum: `checksum-${index + 1}` }))
  assert.throws(() => validateMigrationState({ hasLedger: false, hasApplicationSchema: false, migrations: [migrations[0], { ...migrations[1], version: '001' }], appliedRows: [] }), /Duplicate migration version/i)
  assert.throws(() => validateMigrationState({ hasLedger: false, hasApplicationSchema: true, migrations, appliedRows: [] }), /no migration ledger.*refusing automatic adoption/i)
  assert.throws(() => validateMigrationState({ hasLedger: true, hasApplicationSchema: true, migrations, appliedRows: [] }), /empty migration ledger/i)
  assert.throws(() => validateMigrationState({ hasLedger: true, hasApplicationSchema: true, migrations, appliedRows: [{ version: '001', checksum: 'wrong' }] }), /changed after it was applied/i)
  assert.throws(() => validateMigrationState({ hasLedger: true, hasApplicationSchema: true, migrations, appliedRows: [{ version: '999', checksum: 'unknown' }] }), /unknown version 999/i)
  assert.throws(() => validateMigrationState({ hasLedger: true, hasApplicationSchema: true, migrations, appliedRows: [{ version: '001', checksum: 'checksum-1' }, { version: '003', checksum: 'checksum-3' }] }), /not a contiguous prefix/i)
  assert.throws(() => validateMigrationState({ hasLedger: true, hasApplicationSchema: false, migrations, appliedRows: [{ version: '001', checksum: 'checksum-1' }] }), /core AIKI schema is missing/i)
  assert.doesNotThrow(() => validateMigrationState({ hasLedger: false, hasApplicationSchema: false, migrations, appliedRows: [] }))
  assert.doesNotThrow(() => validateMigrationState({ hasLedger: true, hasApplicationSchema: true, migrations, appliedRows: migrations.slice(0, 2).map(({ version, checksum }) => ({ version, checksum })) }))
}
