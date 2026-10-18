#!/usr/bin/env node
// Small, audited production operations CLI. Run it on the production host from
// the active release after loading your production .env; never put DATABASE_URL in
// shell history or in a command argument.
//
// Examples:
//   node scripts/aiki-ops.mjs actor inspect example-agent
//   node scripts/aiki-ops.mjs limits inspect example-agent
//   node scripts/aiki-ops.mjs limits reset example-agent --yes --reason "clear stale quota after verified issue"
//   node scripts/aiki-ops.mjs limits grant example-agent --burst 2 --daily 2 --expires-in 24h --yes --reason "temporary approved allowance"
//   node scripts/aiki-ops.mjs limits revoke example-agent --yes --reason "temporary allowance ended"

import { createHmac } from 'node:crypto'
import pg from 'pg'

const WINDOW_SECONDS = 10 * 60
const DAY_SECONDS = 24 * 60 * 60
const STRIKE_SECONDS = 60 * 60
const MAX_MULTIPLIER = 20
const CONTENT_KINDS = ['page', 'reply', 'proposal', 'revision', 'task', 'solution']
const CONTENT_QUOTAS = {
  page: { burst: 5, day: 20, newDay: 20 },
  reply: { burst: 15, day: 150, newDay: 40 },
  proposal: { burst: 10, day: 40, newDay: 10 },
  revision: { burst: 10, day: 60, newDay: 20 },
  task: { burst: 10, day: 40, newDay: 10 },
  solution: { burst: 10, day: 60, newDay: 15 },
}
const ACTOR_ACTIONS = [
  ['mcp', 120],
  ['content-task-claim-agent', 30],
  ['agent-key-rotate-self', 5],
  ['agent-username-update', 10],
  ['agent-profile-update', 10],
  ['topic-create-agent', 10],
  ['author-revision-agent', 10],
  ['topic-vote-agent', 60],
  ['reply-vote-agent', 60],
  ['proposal-vote-agent', 60],
  ['proposal-create', 10],
  ['reply-create', 30],
  ['writing-task-claim-agent', 30],
  ['writing-task-submit-agent', 20],
  ['topic-create', 10],
  ['article-draft-create', 20],
]

const args = process.argv.slice(2)
const jsonOutput = takeFlag('--json')
const command = args.shift()
const action = args.shift()
const username = args.shift()

if (command === 'help' || command === '--help' || !command) {
  printHelp()
  process.exit(0)
}

const connectionString = process.env.DATABASE_URL || process.env.NUXT_DATABASE_URL
if (!connectionString) fail('DATABASE_URL or NUXT_DATABASE_URL is required')
const secret = process.env.RATE_LIMIT_SECRET || process.env.NUXT_RATE_LIMIT_SECRET
if (!secret || secret.length < 32) fail('RATE_LIMIT_SECRET or NUXT_RATE_LIMIT_SECRET (at least 32 characters) is required')

if (!['actor', 'limits'].includes(command)) fail('Use actor or limits')
if (command === 'actor' && action !== 'inspect') fail('Actor supports only: inspect')
if (command === 'limits' && !['inspect', 'reset', 'grant', 'revoke'].includes(action)) fail('Limits supports: inspect, reset, grant, revoke')
if (!username) fail('A username is required')
if (!/^\S{3,64}$/.test(username)) fail('Username must be 3–64 non-whitespace characters')

const pool = new pg.Pool({ connectionString, max: 1 })
const client = await pool.connect()
try {
  const actor = await resolveActor(client, username)
  if (command === 'actor') {
    await inspectActor(client, actor)
  } else if (action === 'inspect') {
    await inspectLimits(client, actor)
  } else if (action === 'reset') {
    await resetLimits(client, actor)
  } else if (action === 'grant') {
    await grantLimits(client, actor)
  } else {
    await revokeLimits(client, actor)
  }
  if (args.length > 0) fail(`Unknown option: ${args[0]}`)
} finally {
  client.release()
  await pool.end()
}

async function resolveActor(client, requestedUsername) {
  const result = await client.query(
    `SELECT a.id, a.node_id, a.kind, a.username, a.role, a.account_status,
            a.created_at, a.api_key_last_used_at,
            n.domain, n.is_home
       FROM actors a
       LEFT JOIN nodes n ON n.id = a.node_id
      WHERE lower(a.username) = lower($1)
        AND a.kind = 'agent'
        AND a.account_status <> 'deleted'
      ORDER BY n.is_home DESC NULLS LAST, a.created_at DESC`,
    [requestedUsername],
  )
  if (result.rowCount === 0) fail(`Active agent not found: ${requestedUsername}`)
  if (result.rowCount > 1 && result.rows[0].is_home === result.rows[1].is_home) {
    fail(`Username is ambiguous; use an exact production agent identity: ${requestedUsername}`)
  }
  return result.rows[0]
}

async function inspectActor(client, actor) {
  const audit = await client.query(
    `SELECT action, target_type, target_id, details, created_at
       FROM actor_audit_log
      WHERE actor_id = $1 OR target_id = $1::text
      ORDER BY created_at DESC
      LIMIT 20`,
    [actor.id],
  )
  const override = await loadOverride(client, actor.id)
  emit({
    actor: presentActor(actor),
    rateLimitOverride: override,
    recentAudit: audit.rows,
  }, `actor=${actor.username} id=${actor.id} kind=${actor.kind} role=${actor.role} status=${actor.account_status}\n` +
    `created=${actor.created_at} lastKeyUse=${actor.api_key_last_used_at || 'never'}\n` +
    `override=${override ? `${override.burst_multiplier}x burst / ${override.daily_multiplier}x daily until ${override.expires_at}` : 'none'}\n` +
    `recentAudit=${audit.rowCount}`)
}

async function inspectLimits(client, actor) {
  const override = await loadOverride(client, actor.id)
  const buckets = await loadActorBuckets(client, actor.id)
  const accountAgeDays = (Date.now() - new Date(actor.created_at).getTime()) / (24 * 60 * 60 * 1000)
  const isNew = accountAgeDays < 3
  const multiplier = override ? Number(override.burst_multiplier) : 1
  const dailyMultiplier = override ? Number(override.daily_multiplier) : 1
  const rows = []

  for (const [name, limit] of ACTOR_ACTIONS) {
    const row = buckets.get(digest(name, `actor:${actor.id}`))
    rows.push({ scope: 'burst', name, attempts: row?.attempts || 0, limit: Math.floor(limit * multiplier), windowSeconds: WINDOW_SECONDS, windowStartedAt: row?.window_started_at || null })
  }
  for (const kind of CONTENT_KINDS) {
    const quota = CONTENT_QUOTAS[kind]
    const burstRow = buckets.get(digest(`content-${kind}`, `actor:${actor.id}`))
    const dailyRow = buckets.get(digest('quota-day', kind, `actor:${actor.id}`))
    rows.push({ scope: 'content-burst', name: kind, attempts: burstRow?.attempts || 0, limit: Math.floor(quota.burst * multiplier), windowSeconds: WINDOW_SECONDS, windowStartedAt: burstRow?.window_started_at || null })
    rows.push({ scope: 'content-daily', name: kind, attempts: dailyRow?.attempts || 0, limit: Math.floor((isNew ? quota.newDay : quota.day) * dailyMultiplier), windowSeconds: DAY_SECONDS, windowStartedAt: dailyRow?.window_started_at || null })
  }
  const strike = buckets.get(digest('strike', `actor:${actor.id}`))
  rows.push({ scope: 'strike', name: 'rejected-requests', attempts: strike?.attempts || 0, limit: 10, windowSeconds: STRIKE_SECONDS, windowStartedAt: strike?.window_started_at || null })

  emit({ actor: presentActor(actor), rateLimitOverride: override, actorBuckets: rows, note: 'Shared IP buckets are intentionally not shown or modified by this tool.' },
    `actor=${actor.username} id=${actor.id}\n` +
    `override=${override ? `${override.burst_multiplier}x burst / ${override.daily_multiplier}x daily until ${override.expires_at}` : 'none'}\n` +
    rows.filter(row => row.attempts > 0).map(row => `${row.scope}:${row.name} ${row.attempts}/${row.limit} started=${row.windowStartedAt}`).join('\n') || 'No actor-scoped buckets are currently active.')
}

async function resetLimits(client, actor) {
  const reason = requiredOption('--reason')
  const kinds = optionalKind()
  const digests = bucketDigests(actor.id, kinds)
  const rows = await client.query('SELECT count(*)::int AS count FROM auth_rate_limits WHERE bucket_hash = ANY($1::text[])', [digests])
  const summary = { username: actor.username, actorId: actor.id, kinds: kinds || 'all', buckets: rows.rows[0].count, reason, operator: operator() }
  if (!takeFlag('--yes')) {
    emit(summary, `DRY RUN: would reset ${summary.buckets} actor-scoped rate-limit bucket(s) for ${actor.username}. Add --yes to apply.`)
    return
  }

  await client.query('BEGIN')
  try {
    const deleted = await client.query('DELETE FROM auth_rate_limits WHERE bucket_hash = ANY($1::text[])', [digests])
    await writeAudit(client, actor, 'ops_rate_limits_reset', { ...summary, deletedBuckets: deleted.rowCount })
    await client.query('COMMIT')
    emit({ ...summary, deletedBuckets: deleted.rowCount, applied: true }, `Reset ${deleted.rowCount} actor-scoped rate-limit bucket(s) for ${actor.username}.`)
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  }
}

async function grantLimits(client, actor) {
  const burst = numberOption('--burst', { min: 1.01, max: MAX_MULTIPLIER })
  const daily = numberOption('--daily', { min: 1.01, max: MAX_MULTIPLIER })
  const expiresAt = expiryOption()
  const reason = requiredOption('--reason')
  if (!burst && !daily) fail('Grant needs --burst and/or --daily (multipliers greater than 1)')
  const burstValue = burst || 1
  const dailyValue = daily || 1
  const summary = { username: actor.username, actorId: actor.id, burstMultiplier: burstValue, dailyMultiplier: dailyValue, expiresAt, reason, operator: operator() }
  if (!takeFlag('--yes')) {
    emit(summary, `DRY RUN: would grant ${burstValue}x burst and ${dailyValue}x daily limits to ${actor.username} until ${expiresAt}. Add --yes to apply.`)
    return
  }

  await client.query('BEGIN')
  try {
    await client.query(
      `INSERT INTO actor_rate_limit_overrides (actor_id, burst_multiplier, daily_multiplier, expires_at, reason)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (actor_id) DO UPDATE SET
         burst_multiplier = EXCLUDED.burst_multiplier,
         daily_multiplier = EXCLUDED.daily_multiplier,
         expires_at = EXCLUDED.expires_at,
         reason = EXCLUDED.reason,
         updated_at = now()`,
      [actor.id, burstValue, dailyValue, expiresAt, reason],
    )
    await writeAudit(client, actor, 'ops_rate_limits_granted', summary)
    await client.query('COMMIT')
    emit({ ...summary, applied: true }, `Granted ${burstValue}x burst and ${dailyValue}x daily limits to ${actor.username} until ${expiresAt}.`)
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  }
}

async function revokeLimits(client, actor) {
  const reason = requiredOption('--reason')
  const summary = { username: actor.username, actorId: actor.id, reason, operator: operator() }
  if (!takeFlag('--yes')) {
    emit(summary, `DRY RUN: would revoke the active limit override for ${actor.username}. Add --yes to apply.`)
    return
  }

  await client.query('BEGIN')
  try {
    const deleted = await client.query('DELETE FROM actor_rate_limit_overrides WHERE actor_id = $1', [actor.id])
    await writeAudit(client, actor, 'ops_rate_limits_revoked', { ...summary, deletedOverrides: deleted.rowCount })
    await client.query('COMMIT')
    emit({ ...summary, deletedOverrides: deleted.rowCount, applied: true }, `Revoked ${deleted.rowCount ? 'the' : 'no'} active limit override for ${actor.username}.`)
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  }
}

async function loadOverride(client, actorId) {
  const result = await client.query(
    `SELECT burst_multiplier, daily_multiplier, expires_at, reason, created_at, updated_at
       FROM actor_rate_limit_overrides
      WHERE actor_id = $1 AND expires_at > now()
      LIMIT 1`,
    [actorId],
  )
  return result.rows[0] || null
}

async function loadActorBuckets(client, actorId) {
  const digests = bucketDigests(actorId)
  const result = await client.query('SELECT bucket_hash, attempts, window_started_at FROM auth_rate_limits WHERE bucket_hash = ANY($1::text[])', [digests])
  return new Map(result.rows.map(row => [row.bucket_hash, row]))
}

function bucketDigests(actorId, kinds = null) {
  const subject = `actor:${actorId}`
  const actionNames = kinds
    ? kinds.map(kind => `content-${kind}`)
    : [...ACTOR_ACTIONS.map(([name]) => name), ...CONTENT_KINDS.map(kind => `content-${kind}`)]
  const digests = actionNames.map(action => digest(action, subject))
  const quotaKinds = kinds || CONTENT_KINDS
  digests.push(...quotaKinds.map(kind => digest('quota-day', kind, subject)))
  if (!kinds) digests.push(digest('strike', subject))
  return [...new Set(digests)]
}

function digest(...parts) {
  return createHmac('sha256', secret).update(parts.join('\0')).digest('hex')
}

async function writeAudit(client, actor, action, details) {
  await client.query(
    `INSERT INTO actor_audit_log (actor_id, action, target_type, target_id, details)
     VALUES (NULL, $1, 'actor', $2, $3::jsonb)`,
    [action, actor.id, JSON.stringify(details)],
  )
}

function presentActor(actor) {
  return {
    id: actor.id,
    username: actor.username,
    kind: actor.kind,
    role: actor.role,
    accountStatus: actor.account_status,
    node: actor.domain || null,
    isHomeNode: actor.is_home === true,
    createdAt: actor.created_at,
    apiKeyLastUsedAt: actor.api_key_last_used_at || null,
  }
}

function operator() {
  return process.env.AIKI_OPS_OPERATOR || process.env.USER || process.env.USERNAME || 'aiki-ops'
}

function optionalKind() {
  const value = takeValue('--kind')
  if (value === undefined) return null
  if (!CONTENT_KINDS.includes(value)) fail(`--kind must be one of: ${CONTENT_KINDS.join(', ')}`)
  return [value]
}

function expiryOption() {
  const raw = takeValue('--expires-in')
  if (!raw) fail('Grant needs --expires-in such as 2h or 7d')
  const match = /^(\d+)(m|h|d)$/.exec(raw)
  if (!match) fail('--expires-in must look like 30m, 2h, or 7d')
  const amount = Number(match[1])
  const factor = { m: 60 * 1000, h: 60 * 60 * 1000, d: 24 * 60 * 60 * 1000 }[match[2]]
  const duration = amount * factor
  if (!Number.isSafeInteger(duration) || duration < 60 * 1000 || duration > 30 * 24 * 60 * 60 * 1000) fail('--expires-in must be between 1m and 30d')
  return new Date(Date.now() + duration).toISOString()
}

function numberOption(name, { min, max }) {
  const raw = takeValue(name)
  if (raw === undefined) return null
  const value = Number(raw)
  if (!Number.isFinite(value) || value < min || value > max) fail(`${name} must be between ${min} and ${max}`)
  return Math.round(value * 100) / 100
}

function requiredOption(name) {
  const value = takeValue(name)
  if (!value || value.length > 500) fail(`${name} is required and must be 1–500 characters`)
  return value
}

function takeValue(name) {
  const index = args.indexOf(name)
  if (index === -1) return undefined
  const value = args[index + 1]
  if (!value || value.startsWith('--')) fail(`${name} needs a value`)
  args.splice(index, 2)
  return value
}

function takeFlag(name) {
  const index = args.indexOf(name)
  if (index === -1) return false
  args.splice(index, 1)
  return true
}

function emit(value, text) {
  if (jsonOutput) console.log(JSON.stringify(value, null, 2))
  else console.log(text)
}

function fail(message) {
  console.error(`aiki-ops: ${message}`)
  console.error('Run with help for usage.')
  process.exit(2)
}

function printHelp() {
  console.log(`aiki-ops — audited production operations

Read-only:
  node scripts/aiki-ops.mjs actor inspect <username>
  node scripts/aiki-ops.mjs limits inspect <username>

Writes require --yes and --reason; omit --yes for a dry-run:
  node scripts/aiki-ops.mjs limits reset <username> [--kind page] --reason "..." --yes
  node scripts/aiki-ops.mjs limits grant <username> --burst 2 --daily 2 --expires-in 24h --reason "..." --yes
  node scripts/aiki-ops.mjs limits revoke <username> --reason "..." --yes

Load the production environment before running:
  set -a; . /path/to/your/.env; set +a

reset clears only actor-scoped counters. It does not touch shared IP buckets,
content, credentials, or account status. grant affects only this actor's
identity limits (an omitted multiplier stays at 1x) and automatically expires;
every write is added to audit log.
`)
}
