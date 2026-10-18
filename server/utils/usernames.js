import { randomInt } from 'node:crypto'

export const USERNAME_PATTERN = /^[\p{L}\p{N}_-]{3,32}$/u
export const FEDERATION_USERNAME_PATTERN = /^[a-z0-9][a-z0-9_-]{2,31}$/
export const FEDERATION_RESERVED_HANDLES = new Set(['hub', 'new', 'page', 'ask', 'hot', 'live', 'agents', 'humans', 'anon'])

const ADJECTIVES = [
  'bright', 'calm', 'clear', 'curious', 'kind', 'open', 'patient', 'quiet',
  'steady', 'thoughtful', 'wise', 'young',
]
const NOUNS = [
  'atlas', 'builder', 'explorer', 'guide', 'maker', 'reader', 'scholar',
  'thinker', 'weaver', 'writer',
]

// Gaming names follow the memorable AdjectiveNoun pattern used by
// RandomKeygen's username generator, for example ShadowNinja and CosmicDragon.
const GAMING_ADJECTIVES = [
  'swift', 'bright', 'dark', 'wild', 'calm', 'bold', 'cool', 'epic', 'fast', 'keen',
  'lucky', 'mighty', 'noble', 'quick', 'rare', 'sharp', 'silent', 'smart', 'stark', 'wise',
  'cosmic', 'cyber', 'digital', 'electric', 'frozen', 'golden', 'hidden', 'iron', 'jade', 'lunar',
  'mystic', 'neon', 'phantom', 'primal', 'quantum', 'rapid', 'shadow', 'solar', 'stellar', 'thunder',
  'ultra', 'vapor', 'vivid', 'winter', 'zero', 'alpha', 'beta', 'gamma', 'delta', 'omega',
]
const GAMING_NOUNS = [
  'wolf', 'hawk', 'fox', 'bear', 'lion', 'tiger', 'eagle', 'raven', 'dragon', 'phoenix',
  'knight', 'ninja', 'wizard', 'ranger', 'hunter', 'warrior', 'ghost', 'spirit', 'storm', 'blade',
  'comet', 'nova', 'pulse', 'spark', 'flash', 'volt', 'byte', 'pixel', 'cipher', 'vector',
  'nexus', 'zenith', 'apex', 'core', 'node', 'orbit', 'prism', 'echo', 'flux', 'matrix',
  'sage', 'scout', 'pilot', 'chief', 'captain', 'legend', 'hero', 'ace', 'maverick', 'viper',
]

const REMOTE_WORD_API = 'https://random-word-api.herokuapp.com/word?number=2&diff=2'
const REMOTE_WORD_TIMEOUT_MS = 2500

export function validateUsername(value) {
  const username = typeof value === 'string' ? value.normalize('NFKC').trim() : ''
  return { ok: USERNAME_PATTERN.test(username), value: username }
}

// A Fediverse address stays bound to its account after a rename: the actor
// keeps its /ap/actors/<old name> URI so followers and old posts stay
// attached. That old name (and any name an actor currently uses) must never
// go to another account, or @old@node would open someone else's profile.
export function federationHandleTakenSql(param, excludeActorParam = null) {
  return `SELECT 1 FROM federation_actors retired
           WHERE retired.is_local = true
             AND (lower(retired.local_handle) = lower(${param})
               OR lower(split_part(retired.actor_uri, '/ap/actors/', 2)) = lower(${param}))${excludeActorParam ? `
             AND retired.local_actor_id IS DISTINCT FROM ${excludeActorParam}::uuid` : ''}`
}

// Profiles live at /<username>, next to page addresses: a username and a page
// slug must never share a name.
export function pageSlugTakenSql(param) {
  return `SELECT 1 FROM topics slug_owner WHERE lower(slug_owner.slug) = lower(${param})`
}

export function validateFederationUsername(value) {
  const username = typeof value === 'string' ? value.normalize('NFKC').trim() : ''
  if (!FEDERATION_USERNAME_PATTERN.test(username)) {
    return { ok: false, value: username, error: 'Federation username must start with a lowercase letter or number and use only lowercase letters, numbers, underscores, or hyphens.' }
  }
  if (FEDERATION_RESERVED_HANDLES.has(username)) {
    return { ok: false, value: username, error: 'That username is reserved for an AIKI Fediverse channel.' }
  }
  return { ok: true, value: username, error: null }
}

export function generateUsernameCandidate() {
  const adjective = ADJECTIVES[randomInt(ADJECTIVES.length)]
  const noun = NOUNS[randomInt(NOUNS.length)]
  return `${adjective}-${noun}`
}

export function generateGamingUsernameCandidate({ includeNumbers = false, base = '' } = {}) {
  const adjective = base || GAMING_ADJECTIVES[randomInt(GAMING_ADJECTIVES.length)]
  const noun = base ? '' : GAMING_NOUNS[randomInt(GAMING_NOUNS.length)]
  const username = base || `${capitalize(adjective)}${capitalize(noun)}`
  return includeNumbers ? `${username}${randomInt(1, 1000)}` : username
}

function capitalize(value) {
  return `${value[0].toUpperCase()}${value.slice(1)}`
}

function normalizeRemoteWord(value) {
  const word = String(value || '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '')
  return word.length >= 3 && word.length <= 14 ? word : ''
}

// The remote provider is used only for optional username suggestions. Keeping
// this separate from registration means an outage can never block sign-up.
export async function generateApiUsernameCandidate(fetchImpl = globalThis.fetch) {
  if (typeof fetchImpl !== 'function') return null

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), REMOTE_WORD_TIMEOUT_MS)
  try {
    const response = await fetchImpl(REMOTE_WORD_API, {
      redirect: 'error',
      signal: controller.signal,
      headers: { accept: 'application/json' },
    })
    if (!response?.ok) return null

    const words = await response.json()
    if (!Array.isArray(words) || words.length < 2) return null
    const first = normalizeRemoteWord(words[0])
    const second = normalizeRemoteWord(words[1])
    if (!first || !second) return null

    const candidate = `${first}-${second}`
    return USERNAME_PATTERN.test(candidate) ? candidate : null
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}
