import { randomBytes, scrypt as scryptCallback } from 'node:crypto'
import { promisify } from 'node:util'
import pg from 'pg'

const scrypt = promisify(scryptCallback)
const connectionString = process.env.DATABASE_URL
if (!connectionString) throw new Error('DATABASE_URL is required')

const usernameArg = process.argv[2]
const emailArg = process.argv[3] || ''
if (!usernameArg || usernameArg.length < 3 || usernameArg.length > 32 || !/^[\p{L}\p{N}_-]+$/u.test(usernameArg)) {
  throw new Error('Usage: npm run admin:create -- <username> [email]')
}
if (emailArg && (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailArg) || emailArg.length > 254)) {
  throw new Error('Email address is invalid')
}

const password = await readPassword()
if (password.length < 12 || password.length > 256) throw new Error('Password must be 12–256 characters')

const salt = randomBytes(16)
const derived = await scrypt(password, salt, 64, { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 })
const passwordHash = `scrypt$16384$8$1$${salt.toString('base64url')}$${Buffer.from(derived).toString('base64url')}`
const pool = new pg.Pool({ connectionString, max: 1 })
const client = await pool.connect()
let apiKey

try {
  await client.query('BEGIN')
  await client.query('LOCK TABLE actors IN SHARE ROW EXCLUSIVE MODE')
  const existing = await client.query(`SELECT id FROM actors WHERE kind = 'human' AND account_status = 'active' LIMIT 1`)
  if (existing.rowCount > 0) throw new Error('A human administrator/account already exists; bootstrap is closed')

  const nodeResult = await client.query('SELECT id FROM nodes WHERE is_home = true LIMIT 1')
  const nodeId = nodeResult.rows[0]?.id || null
  const actorResult = await client.query(
    `INSERT INTO actors (node_id, kind, username, email, password_hash, role)
     VALUES ($1, 'human', $2, NULLIF(lower($3), ''), $4, 'owner')
     RETURNING id`,
    [nodeId, usernameArg, emailArg, passwordHash],
  )
  const actorId = actorResult.rows[0].id
  apiKey = `aiki_${randomBytes(32).toString('base64url')}`
  const apiKeyHash = Buffer.from(await scrypt(apiKey, actorId, 32, { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 })).toString('hex')
  const agentResult = await client.query(
    `INSERT INTO actors (node_id, kind, username, api_key_hash, role)
     VALUES ($1, 'agent', $2, $3, 'owner')
     RETURNING id`,
    [nodeId, `${usernameArg}-admin-agent`, apiKeyHash],
  )
  await client.query(
    `INSERT INTO actor_audit_log (actor_id, action, target_type, target_id, details)
     VALUES ($1, 'bootstrap_admin_created', 'agent', $2, jsonb_build_object('username', $3))`,
    [actorId, agentResult.rows[0].id, usernameArg],
  )
  await client.query('COMMIT')
} catch (error) {
  await client.query('ROLLBACK')
  throw error
} finally {
  client.release()
  await pool.end()
}

console.log(`Created first node owner: ${usernameArg}`)
console.log(`Initial agent ID: ${apiKey ? 'created' : 'not created'}`)
if (apiKey) console.log(`One-time API key: ${apiKey}`)
console.log('Store the API key securely; it cannot be retrieved later.')

async function readPassword() {
  if (process.env.AIKI_ADMIN_PASSWORD) return process.env.AIKI_ADMIN_PASSWORD
  if (!process.stdin.isTTY || !process.stderr.isTTY) throw new Error('Set AIKI_ADMIN_PASSWORD for non-interactive use')

  process.stderr.write('Admin password: ')
  const stdin = process.stdin
  const wasRaw = stdin.isRaw
  stdin.setRawMode(true)
  stdin.resume()
  let value = ''
  try {
    for await (const chunk of stdin) {
      const text = chunk.toString('utf8')
      if (text.includes('\n') || text.includes('\r')) break
      if (text === '\u0003') throw new Error('Cancelled')
      if (text === '\u007f' || text === '\b') value = value.slice(0, -1)
      else value += text
    }
  } finally {
    stdin.setRawMode(wasRaw)
    stdin.pause()
    process.stderr.write('\n')
  }
  return value
}
