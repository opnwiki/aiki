import { randomInt } from 'node:crypto'
import { isReservedSlug, normalizePageSlug } from './validation.js'
import { federationHandleTakenSql } from './usernames.js'

// Unambiguous letters and digits. A code always includes a letter so it cannot
// occupy a numeric page link such as /5.
const ALPHABET = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789'
const CODE_PATTERN = /^[A-HJ-NP-Za-km-z2-9]{5}$/

export function generatePageCode() {
  let code = ''
  do {
    code = ''
    for (let index = 0; index < 5; index += 1) code += ALPHABET[randomInt(ALPHABET.length)]
  } while (!/[A-Za-z]/.test(code) || isReservedSlug(code))
  return code
}

export function isPageCode(value) {
  return CODE_PATTERN.test(String(value || '')) && /[A-Za-z]/.test(String(value || '')) && !isReservedSlug(value)
}

export function inspectPageSlug(input) {
  const raw = String(input ?? '').normalize('NFKC').trim()
  if (!raw) return { ok: false, slug: '', reason: 'empty' }
  if (isPageCode(raw)) return { ok: true, slug: raw, reason: 'free' }
  const slug = normalizePageSlug(raw)
  if (!slug) return { ok: false, slug: raw.slice(0, 96), reason: isReservedSlug(raw) ? 'reserved' : 'invalid' }
  if (/^[0-9]+$/.test(slug)) return { ok: false, slug, reason: 'numeric' }
  return { ok: true, slug, reason: 'free' }
}

export function topicKeyPredicate(alias, placeholder) {
  const prefix = alias ? `${alias}.` : ''
  return `(CASE WHEN ${placeholder} ~ '^[1-9][0-9]{0,18}$' THEN ${prefix}page_number = ${placeholder}::bigint ELSE lower(${prefix}slug) = lower(${placeholder}) END)`
}

// Page addresses share the root with profiles (/<username>): a slug that is
// someone's username, or a Fediverse handle kept after a rename, is taken.
async function slugTaken(client, slug) {
  const taken = await client.query(
    `SELECT 1 FROM topics WHERE lower(slug) = lower($1)
     UNION ALL SELECT 1 FROM actors WHERE lower(username) = lower($1) AND kind IN ('human', 'agent')
     UNION ALL ${federationHandleTakenSql('$1')}
     LIMIT 1`,
    [slug],
  )
  return taken.rowCount > 0
}

export async function allocateTopicSlug(client, requested) {
  const raw = requested == null ? '' : String(requested).trim()
  if (!raw) {
    for (let attempt = 0; attempt < 12; attempt += 1) {
      const code = generatePageCode()
      if (!(await slugTaken(client, code))) return code
    }
    const error = new Error('Could not allocate a page address.')
    error.statusCode = 503
    throw error
  }
  const inspected = inspectPageSlug(raw)
  if (!inspected.ok) {
    const error = new Error(inspected.reason === 'numeric'
      ? 'A page address cannot be only a number.'
      : 'That page address cannot be used.')
    error.statusCode = 400
    throw error
  }
  if (await slugTaken(client, inspected.slug)) {
    const error = new Error('That page address is already used.')
    error.statusCode = 409
    throw error
  }
  return inspected.slug
}

export async function pageSlugAvailability(client, requested) {
  const inspected = inspectPageSlug(requested)
  if (!inspected.ok) return { slug: inspected.slug, available: false, reason: inspected.reason }
  const taken = await slugTaken(client, inspected.slug)
  return {
    slug: inspected.slug,
    available: !taken,
    reason: taken ? 'taken' : 'free',
  }
}
