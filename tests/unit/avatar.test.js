import { MAX_AVATAR_BYTES, chooseAvatarCache, compressUploadedAvatar, normalizeAvatarPreference, publicAvatarPath, validateAvatarBytes } from '../../server/utils/avatar.js'

export async function run({ assert }) {
  assert.equal(normalizeAvatarPreference(' custom '), 'custom')
  assert.equal(normalizeAvatarPreference('GRAVATAR'), 'gravatar')
  assert.equal(normalizeAvatarPreference('provider'), null)

  const custom = { source: 'upload', bytes: Buffer.from('custom') }
  const statica = { source: 'statica', bytes: Buffer.from('statica') }
  const gravatar = { source: 'gravatar', bytes: Buffer.from('gravatar') }

  assert.equal(chooseAvatarCache('custom', [statica, custom]), custom)
  assert.equal(chooseAvatarCache('statica', [gravatar, statica]), statica)
  assert.equal(chooseAvatarCache('gravatar', [statica, gravatar]), gravatar)
  assert.equal(chooseAvatarCache('gravatar', [statica]), statica, 'Gravatar selection falls back to the cached Statica avatar')
  assert.equal(chooseAvatarCache('custom', [statica]), null, 'custom selection does not silently switch to another source')

  assert.equal(publicAvatarPath('12345678901234'), '/api/actors/12345678901234/avatar')
  assert.equal(publicAvatarPath('actor-1'), null)

  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  assert.equal(validateAvatarBytes(png).type, 'image/png')
  assert.equal(validateAvatarBytes(Buffer.from('not an image')).ok, false)

  const oneMbPng = Buffer.alloc(MAX_AVATAR_BYTES, 0)
  oneMbPng.set(png)
  assert.equal(MAX_AVATAR_BYTES, 1024 * 1024)
  assert.equal(validateAvatarBytes(oneMbPng).ok, true)
  assert.equal(validateAvatarBytes(Buffer.concat([oneMbPng, Buffer.alloc(1)])).ok, false)

  const samplePng = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64')
  const compressed = await compressUploadedAvatar(samplePng)
  assert.equal(compressed.ok, true)
  assert.equal(compressed.mediaType, 'image/webp')
  assert.ok(compressed.bytes.length <= MAX_AVATAR_BYTES)
}
