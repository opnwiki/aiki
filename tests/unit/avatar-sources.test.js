import sharp from 'sharp'
import { gravatarHash, gravatarImageUrl, refreshGravatarAvatar, refreshStaticaAvatar, staticaImageUrl, staticaSourceKey } from '../../server/utils/avatar-sources.js'

export async function run({ assert }) {
  const link = 'https://statica.me/s/abc123DEF.png'
  assert.equal(staticaImageUrl({ anonical: { link, render_ok: true } }), link)
  assert.equal(staticaImageUrl({ anonical: { link, render_ok: false } }), null)
  assert.equal(staticaImageUrl({ anonical: { link: 'https://evil.example/s/abc.png' } }), null)
  assert.equal(staticaImageUrl({ anonical: { link: 'https://statica.me/s/../x.png' } }), null)
  assert.equal(staticaImageUrl(null), null)

  const key = staticaSourceKey(link, 'secret')
  assert.match(key, /^[0-9a-f]{64}$/)
  assert.ok(!key.includes('abc123DEF'), 'the stored key must not reveal the Statica ID')
  assert.equal(staticaSourceKey(link, 'secret'), key)
  assert.notEqual(staticaSourceKey(link, 'other'), key)

  const png = await sharp({ create: { width: 8, height: 8, channels: 3, background: '#3d5c4e' } }).png().toBuffer()
  const queries = []
  const database = {
    async query(text, values) {
      queries.push({ text, values })
      if (text.includes('SELECT expires_at')) return { rows: [] }
      if (text.includes('FROM ip_statica_profiles')) return { rows: [{ payload: { anonical: { link, render_ok: true } } }] }
      return { rows: [] }
    },
  }
  const fetched = []
  const fetchImpl = async (url, options) => {
    fetched.push({ url, options })
    return new Response(png, { status: 200, headers: { 'content-type': 'image/png' } })
  }
  const stored = await refreshStaticaAvatar(database, 'actor-1', '203.0.113.7', { fetchImpl, lookupProfile: async () => ({}) })
  assert.equal(stored, true)
  assert.equal(fetched[0].url, link)
  assert.equal(fetched[0].options.redirect, 'error')
  const insert = queries.find(query => query.text.includes('INSERT INTO actor_avatars'))
  assert.ok(insert, 'the picture is cached on AIKI')
  assert.equal(insert.values[1], 'statica')
  assert.equal(insert.values[3], 'image/webp')
  assert.ok(!JSON.stringify(insert.values.slice(3)).includes('statica.me'), 'neither the URL nor the IP is stored')
  assert.ok(!JSON.stringify(insert.values.slice(3)).includes('203.0.113.7'))

  // A fresh check is remembered, so the next request does not query again.
  const before = queries.length
  assert.equal(await refreshStaticaAvatar(database, 'actor-1', '203.0.113.7', { fetchImpl, lookupProfile: async () => ({}) }), false)
  assert.equal(queries.length, before)

  // Gravatar: the documented MD5 of the trimmed, lower-cased address.
  assert.equal(gravatarHash('  MyEmailAddress@example.com '), '0bc83cb571cd1c50ba6f3e8a78ef1346')
  assert.equal(gravatarHash('not-an-email'), null)
  assert.equal(gravatarImageUrl('0bc83cb571cd1c50ba6f3e8a78ef1346'), 'https://www.gravatar.com/avatar/0bc83cb571cd1c50ba6f3e8a78ef1346?s=512&d=404')

  function gravatarDatabase(row) {
    const log = []
    return {
      log,
      async query(text, values) {
        log.push({ text, values })
        if (text.startsWith('SELECT source_key')) return { rows: row ? [row] : [] }
        return { rows: [] }
      },
    }
  }
  const hash = gravatarHash('person@example.com')
  const fresh = new Date(Date.now() + 86_400_000)

  const created = gravatarDatabase(null)
  assert.equal(await refreshGravatarAvatar(created, 'g-1', 'person@example.com', { fetchImpl: async () => new Response(png, { status: 200 }) }), true)
  const gravatarInsert = created.log.find(query => query.text.includes('INSERT INTO actor_avatars'))
  assert.equal(gravatarInsert.values[1], 'gravatar')
  assert.equal(gravatarInsert.values[5], hash, 'the source key is the email hash, not the address')
  assert.ok(!JSON.stringify(gravatarInsert.values).includes('person@example.com'))

  // A fresh picture for the same address is not downloaded again.
  let calls = 0
  const same = gravatarDatabase({ source_key: hash, expires_at: fresh })
  assert.equal(await refreshGravatarAvatar(same, 'g-2', 'person@example.com', { fetchImpl: async () => { calls += 1; return new Response(png) } }), false)
  assert.equal(calls, 0)

  // A changed address is fetched at once even though the old row is fresh.
  const changed = gravatarDatabase({ source_key: hash, expires_at: fresh })
  assert.equal(await refreshGravatarAvatar(changed, 'g-3', 'new@example.com', { fetchImpl: async () => new Response(png) }), true)

  // No Gravatar (404) or no address removes the cached picture.
  const missing = gravatarDatabase({ source_key: hash, expires_at: null })
  assert.equal(await refreshGravatarAvatar(missing, 'g-4', 'person@example.com', { fetchImpl: async () => new Response('', { status: 404 }) }), false)
  assert.ok(missing.log.some(query => query.text.startsWith('DELETE FROM actor_avatars')))
  const removed = gravatarDatabase({ source_key: hash, expires_at: fresh })
  assert.equal(await refreshGravatarAvatar(removed, 'g-5', null), false)
  assert.ok(removed.log.some(query => query.text.startsWith('DELETE FROM actor_avatars')))
}
