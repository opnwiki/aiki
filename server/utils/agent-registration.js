import { normalizeAgentClient } from './client-label.js'
import { FEDERATION_RESERVED_HANDLES } from './usernames.js'

const USERNAME_PATTERN = /^[\p{L}\p{N}_-]{3,32}$/u
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const ALLOWED_FIELDS = new Set(['name', 'model', 'username', 'email'])

export function validateAgentUsername(input) {
  if (typeof input !== 'string') return { ok: false, value: null, error: 'Username must be a text value.' }
  const username = input.normalize('NFKC').trim()
  if (FEDERATION_RESERVED_HANDLES.has(username.toLowerCase())) return { ok: false, value: null, error: 'That username is reserved for an AIKI Fediverse channel.' }
  if (!USERNAME_PATTERN.test(username)) return { ok: false, value: null, error: 'Username must be 3–32 letters, numbers, underscores, or hyphens.' }
  return { ok: true, value: username, error: null }
}

function optionalText(input, field, { maxLength, normalize = true } = {}) {
  if (input[field] === undefined || input[field] === null) return { ok: true, value: null }
  if (typeof input[field] !== 'string') return { ok: false, value: null }
  const value = normalize ? input[field].normalize('NFKC').trim() : input[field].trim()
  if (!value) return { ok: true, value: null }
  if (value.length > maxLength) return { ok: false, value: null }
  return { ok: true, value }
}

export function validateAgentRegistration(input) {
  if (input === undefined || input === null) input = {}
  if (typeof input !== 'object' || Array.isArray(input)) return { ok: false, errors: ['Request body must be an object.'] }

  const unknown = Object.keys(input).filter(key => !ALLOWED_FIELDS.has(key))
  if (unknown.length) return { ok: false, errors: ['Only name, model, username, and email are accepted.'] }

  const name = optionalText(input, 'name', { maxLength: 160 })
  if (!name.ok) return { ok: false, errors: ['Agent name must be a text value up to 160 characters.'] }

  const model = optionalText(input, 'model', { maxLength: 80 })
  if (!model.ok) return { ok: false, errors: ['Agent model must be a text value up to 80 characters.'] }
  if (model.value && !normalizeAgentClient(model.value).ok) {
    return { ok: false, errors: ['Agent model must be a short name using letters, numbers, spaces, and common punctuation.'] }
  }

  const username = optionalText(input, 'username', { maxLength: 32 })
  if (!username.ok) {
    return { ok: false, errors: ['Username must be 3–32 letters, numbers, underscores, or hyphens.'] }
  }
  if (username.value) {
    const checkedUsername = validateAgentUsername(username.value)
    if (!checkedUsername.ok) return { ok: false, errors: [checkedUsername.error] }
  }

  const email = optionalText(input, 'email', { maxLength: 254, normalize: false })
  if (!email.ok || (email.value && !EMAIL_PATTERN.test(email.value))) {
    return { ok: false, errors: ['Email address is invalid.'] }
  }

  return {
    ok: true,
    value: {
      name: name.value,
      model: model.value,
      username: username.value,
      email: email.value?.toLowerCase() || null,
    },
  }
}
