# Adoption of databases initialized from the historical bootstrap

`database/init/001_initial.sql` is a historical bootstrap, not a migration and is not run by the current Compose stack. Never point the current migration runner at an existing or valuable database until its origin, backup, schema, and data have been reviewed. This runbook is an operator checklist; it does not automatically adopt, modify, or delete any database.

## Safety properties

- Stop all application writers before inspection/adoption and record the maintenance window.
- Take a PostgreSQL-native, encrypted, off-host backup; verify the backup can be listed and record its checksum. A backup that has not been restore-tested is not a recovery plan.
- Do not run `docker compose down -v`, `DROP`, `TRUNCATE`, `CREATE TABLE IF NOT EXISTS` migrations, or the migration runner against a valuable database as an inspection technique.
- Work first on a disposable restore/clone, never the live source. Keep a rollback path and preserve the original database untouched until acceptance is complete.
- The adoption decision is explicit and human-reviewed. No script in this repository performs adoption.

## 1. Identify the candidate

Record the database server/version, database name, owner, application release, the historical SQL file/checksum if known, and counts for important user tables. Confirm the database really originated from `database/init/001_initial.sql`, rather than assuming that a matching table name proves schema equivalence.

## 2. Backup and restore rehearsal

Create a custom-format backup using the site's approved secret handling and transfer it off-host. For example, with credentials supplied through a protected `PGPASSFILE` (not shell arguments/history):

```sh
pg_dump --host "$PGHOST" --username "$PGUSER" --dbname "$PGDATABASE" --format=custom --no-owner --file=aiki-pre-adoption.dump
pg_restore --list aiki-pre-adoption.dump
sha256sum aiki-pre-adoption.dump
```

The example intentionally omits credentials and must be adapted to the operator's environment. Restore the dump into a newly created, isolated disposable database, then confirm representative rows and application-level reads. Do not overwrite the original while rehearsing.

## 3. Compare schema and data on the disposable clone

1. Keep the current application stopped against the clone.
2. Compare tables, columns, types, nullability, defaults, constraints, indexes, extensions, sequences, triggers, and grants against the intended schema. Review `database/init/001_initial.sql` and every numbered migration; check database-wide constraint names, not only their names, since some historical migrations test names without schema qualification.
3. Compare fixture rows and user data. The historical bootstrap and migration 001 are nearly the same, but migration 002 adds account/audit fields, 003 adds auth limits, 004 adds password-change state, 005 adds topic reader tracking, 006 adds edit-proposal review metadata/context integrity, 007 validates same-topic/same-locale revision parents and prevents individual revision mutation, and 008 enforces citation target and topic integrity. Migration 008 backfills each citation's topic from its target and fails if any existing citation has no valid target. Data may be present even if some tables are missing or partially upgraded.
4. Confirm there are no duplicate/colliding migration versions, no existing `schema_migrations` with unknown checksums, and no running writers. Record before/after counts and schema diffs.
5. Reject adoption on any unknown, extra, missing, or mismatched schema element. Resolve it with a reviewed, separately tested forward migration/repair plan; do not force the ledger to match.

## 4. Explicit ledger adoption decision

The migration runner trusts a matching `schema_migrations` row and skips that migration. Therefore a false ledger entry can silently skip required SQL. A ledger row may be inserted only after a reviewer establishes that the candidate schema and data satisfy the exact postconditions of that migration, using the exact SHA-256 of the checked-in migration bytes. Migration 006 adds nullable review metadata and a `NOT VALID` composite foreign key: existing rows are not implicitly scanned for that relationship by the migration, while PostgreSQL enforces it for new/updated rows. Migration 007 validates every existing parent relationship, rejects any cross-topic/locale or orphaned parent, and installs revision immutability enforcement. Migration 008 backfills citation topic ownership, validates that every citation has exactly one existing same-topic revision or reply target, and installs cascading target foreign keys; inspect and verify its data postconditions on the disposable clone before considering its checksum satisfied.

For a database proven to be exactly the historical bootstrap, the operator may consider recording migration `001` as already satisfied **on the disposable restored clone only**. This must be a deliberate, reviewed transaction after schema verification, using the exact checksum computed from the checked-out file. Do not normalize SQL, copy a checksum from another deployment, or mark migrations 002–008 as applied unless each one's full postconditions have independently been verified. If uncertain, do not adopt: migrate a fresh database and plan a reviewed data transfer instead.

After any proposed ledger operation on the disposable clone:

- Query every ledger version/checksum and compare it byte-for-byte with the source files.
- Run the migration runner twice; the second run must be a no-op and ledger checksums must remain unchanged.
- Verify foreign keys, unique constraints, representative reads/writes, row counts, and application health.
- Restore the original backup into another clean test database and rehearse rollback.
- Obtain explicit owner/operator approval before repeating the reviewed procedure on the actual database.

## 5. Post-adoption acceptance

Keep writes disabled until the database has passed migration checksum verification, application/API smoke tests against a disposable copy, restore/rollback rehearsal, and a read-only data comparison. Capture the approved schema diff, checksum ledger, row counts, test outputs, and operator identity in the change record. Monitor the actual production database only after a separate approval; this repository change does not authorize production writes or restart.

## Compose acceptance on a disposable host

With Docker Engine and Compose v2 installed, run `npm run test:compose`. The harness creates a random Compose project name, an isolated temporary `.env` with fresh secrets, and a temporary database volume. It checks Compose configuration, clean migrations and checksums, a no-op second migration run, app/DB health, marker data surviving a service restart, isolated volume reset, and successful clean reinitialization. It always runs `down -v` for its unique project and removes its temporary secrets file. Never change the harness project naming or cleanup target to a shared/prod project; review the script before using it on any host with valuable data.
