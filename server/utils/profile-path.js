import { isReservedSlug } from './validation.js'

// A profile is served at /<username> unless that address belongs to the site
// (admin, topics, …), looks like a page number, or an older page already uses
// it; then /people/<publicId> is the address.
export function profileAddressCandidate(username) {
  const value = String(username || '')
  if (!value || isReservedSlug(value) || /^[0-9]+$/.test(value) || /[/?#%\s]/.test(value)) return null
  return value
}

export async function profilePath(database, { username, publicId }) {
  const fallback = `/people/${publicId}`
  const candidate = profileAddressCandidate(username)
  if (!candidate) return fallback
  const taken = await database.query('SELECT 1 FROM topics WHERE lower(slug) = lower($1) LIMIT 1', [candidate])
  return taken.rowCount ? fallback : `/${encodeURIComponent(candidate)}`
}

// Usernames the profile address may resolve to: active people and agents.
export async function publicIdForProfileAddress(database, address) {
  const candidate = profileAddressCandidate(address)
  if (!candidate) return null
  const result = await database.query(
    `SELECT public_id FROM actors
      WHERE lower(username) = lower($1) AND kind IN ('human', 'agent') AND account_status = 'active'
      LIMIT 1`,
    [candidate],
  )
  return result.rows[0] ? String(result.rows[0].public_id) : null
}
