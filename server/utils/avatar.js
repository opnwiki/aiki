import { createHash } from 'node:crypto'
import sharp from 'sharp'

export const AVATAR_PREFERENCES = Object.freeze(['custom', 'statica', 'gravatar'])
export const MAX_AVATAR_BYTES = 1024 * 1024
export const MAX_AVATAR_DIMENSION = 512
const AVATAR_WEBP_QUALITIES = Object.freeze([82, 72, 62, 52, 42])

export function normalizeAvatarPreference(value) {
  const normalized = typeof value === 'string' ? value.trim().toLowerCase() : ''
  return AVATAR_PREFERENCES.includes(normalized) ? normalized : null
}

export function chooseAvatarCache(preference, rows = []) {
  const normalized = normalizeAvatarPreference(preference) || 'statica'
  const sourceOrder = normalized === 'custom'
    ? ['upload']
    : normalized === 'gravatar'
      ? ['gravatar', 'statica']
      : ['statica']

  const bySource = new Map(rows.filter(row => row?.source && row?.bytes).map(row => [row.source, row]))
  for (const source of sourceOrder) {
    const row = bySource.get(source)
    if (row) return row
  }
  return null
}

export function publicAvatarPath(publicId) {
  const value = String(publicId || '')
  if (!/^\d{14}$/.test(value)) return null
  return `/api/actors/${encodeURIComponent(value)}/avatar`
}

export function sniffAvatarType(bytes) {
  if (!Buffer.isBuffer(bytes)) return null
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return 'image/png'
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg'
  if (bytes.length >= 12 && bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP') return 'image/webp'
  return null
}

export function validateAvatarBytes(bytes) {
  const type = sniffAvatarType(bytes)
  if (!type || bytes.length < 1 || bytes.length > MAX_AVATAR_BYTES) return { ok: false, type: null, sha256: null }
  return { ok: true, type, sha256: createHash('sha256').update(bytes).digest('hex') }
}

export async function compressUploadedAvatar(bytes) {
  const checked = validateAvatarBytes(bytes)
  if (!checked.ok) return { ok: false, reason: 'invalid' }

  try {
    for (const quality of AVATAR_WEBP_QUALITIES) {
      const compressed = await sharp(bytes, {
        failOn: 'error',
        limitInputPixels: MAX_AVATAR_DIMENSION * MAX_AVATAR_DIMENSION * 64,
      })
        .rotate()
        .resize({
          width: MAX_AVATAR_DIMENSION,
          height: MAX_AVATAR_DIMENSION,
          fit: 'inside',
          withoutEnlargement: true,
        })
        .webp({ quality, effort: 4 })
        .toBuffer()

      if (compressed.length <= MAX_AVATAR_BYTES) {
        return {
          ok: true,
          bytes: compressed,
          mediaType: 'image/webp',
          sha256: createHash('sha256').update(compressed).digest('hex'),
        }
      }
    }
  } catch {
    return { ok: false, reason: 'invalid' }
  }

  return { ok: false, reason: 'too-large' }
}
