import { createError, getQuery } from 'h3'
import { getDatabase } from '../../utils/database.js'
import { enforceRateLimit } from '../../utils/rate-limit.js'
import { FEDERATION_RESERVED_HANDLES, federationHandleTakenSql, pageSlugTakenSql, generateApiUsernameCandidate, generateGamingUsernameCandidate, generateUsernameCandidate, validateUsername } from '../../utils/usernames.js'

export default defineEventHandler(async (event) => {
  await enforceRateLimit(event, { action: 'username-availability', limit: 60 })
  const query = getQuery(event)
  const raw = typeof query.username === 'string' ? query.username : ''
  const requested = raw.normalize('NFKC').trim()
  const database = getDatabase()
  const node = await database.query('SELECT id FROM nodes WHERE is_home LIMIT 1')
  const nodeId = node.rows[0]?.id || null

  if (requested) {
    const checked = validateUsername(requested)
    if (!checked.ok) return { username: requested, available: false, reason: 'invalid' }
    if (FEDERATION_RESERVED_HANDLES.has(checked.value.toLowerCase())) return { username: checked.value, available: false, reason: 'reserved' }
    const result = await database.query(
      `SELECT 1 FROM actors
        WHERE node_id IS NOT DISTINCT FROM $1
          AND lower(username) = lower($2)
       UNION ALL ${federationHandleTakenSql('$2')}
       UNION ALL ${pageSlugTakenSql('$2')}
        LIMIT 1`,
      [nodeId, checked.value],
    )
    return { username: checked.value, available: result.rowCount === 0, reason: result.rowCount === 0 ? null : 'taken' }
  }

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const username = generateGamingUsernameCandidate()
    const result = await database.query(
      `SELECT 1 FROM actors
        WHERE node_id IS NOT DISTINCT FROM $1
          AND lower(username) = lower($2)
        LIMIT 1`,
      [nodeId, username],
    )
    if (result.rowCount === 0) return { username, available: true, reason: null }

    const numberedUsername = generateGamingUsernameCandidate({ includeNumbers: true, base: username })
    const numberedResult = await database.query(
      `SELECT 1 FROM actors
        WHERE node_id IS NOT DISTINCT FROM $1
          AND lower(username) = lower($2)
        LIMIT 1`,
      [nodeId, numberedUsername],
    )
    if (numberedResult.rowCount === 0) return { username: numberedUsername, available: true, reason: null }
  }

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const username = await generateApiUsernameCandidate()
    if (!username) break
    const result = await database.query(
      `SELECT 1 FROM actors
        WHERE lower(username) = lower($1)
        LIMIT 1`,
      [username],
    )
    if (result.rowCount === 0) return { username, available: true, reason: null }
  }

  for (let attempt = 0; attempt < 40; attempt += 1) {
    const base = generateUsernameCandidate()
    const username = attempt < 30 ? base : `${base}-${attempt - 29}`
    const result = await database.query(
      `SELECT 1 FROM actors
        WHERE lower(username) = lower($1)
        LIMIT 1`,
      [username],
    )
    if (result.rowCount === 0) return { username, available: true, reason: null }
  }

  throw createError({ statusCode: 503, statusMessage: 'Could not suggest a username right now.' })
})
