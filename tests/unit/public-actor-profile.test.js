import { readFile } from 'node:fs/promises'
import { loadPublicActorProfile, presentPublicActor, presentPublicActorPage } from '../../server/utils/public-actor-profile.js'
import { isReservedSlug } from '../../server/utils/validation.js'

export async function run({ assert }) {
  const actor = { id: 'private-uuid', public_id: '12345678901234', username: 'ext-example', display_name: 'Original Channel', kind: 'external', account_status: 'active', external_avatar_url: 'https://media.example.org/channel.webp', external_profile_url: 'https://t.me/example', email: 'secret@example.org', subject_key: '-100123', role: 'member', provider: 'telegram' }
  assert.deepEqual(presentPublicActor(actor), { publicId: '12345678901234', username: 'ext-example', displayName: 'Original Channel', kind: 'external', avatarUrl: actor.external_avatar_url, profileUrl: actor.external_profile_url })
  assert.equal(presentPublicActor({ ...actor, account_status: 'suspended' }), null)
  assert.equal(presentPublicActor({ ...actor, kind: 'system' }), null)
  assert.equal(presentPublicActor({ ...actor, external_avatar_url: 'https://api.telegram.org/file/bot123:SECRET/avatar.jpg' }).avatarUrl, null)
  const custom = presentPublicActor({ ...actor, kind: 'human', avatar_preference: 'custom', has_custom_avatar: true })
  assert.equal(custom.avatarUrl, '/api/actors/12345678901234/avatar', 'a linked person keeps their selected local avatar')
  assert.equal(presentPublicActor({ ...actor, kind: 'human', avatar_preference: 'custom' }).avatarUrl, null, 'missing custom avatar must not silently switch sources')

  const published = { page_number: '42', title: 'Public author page', locale: 'ru', kind: 'article', status: 'published', hide_author: null, show_author: true, updated_at: '2026-10-12' }
  assert.equal(presentPublicActorPage(published).path, '/42')
  for (const status of ['unlisted', 'hidden', 'deleted', 'pending']) assert.equal(presentPublicActorPage({ ...published, status }), null, `profile must not disclose ${status} pages`)
  assert.equal(presentPublicActorPage({ ...published, hide_author: true }), null)
  assert.equal(presentPublicActorPage({ ...published, show_author: false }), null)
  assert.equal(presentPublicActorPage({ ...published, show_author: false, hide_author: false }).path, '/42', 'a page can explicitly show the author despite the profile default')

  const calls = []
  const db = { async query(sql, values) { calls.push({ sql, values }); return { rows: calls.length === 1 ? [actor] : [published, { ...published, page_number: '43', status: 'hidden' }, { ...published, page_number: '44', hide_author: true }] } } }
  const result = await loadPublicActorProfile(db, actor.public_id, { locale: 'ru', limit: 2000 })
  assert.equal(result.pages.length, 1)
  // Up to 30 history items; pages and messages are read together.
  assert.deepEqual(calls[1].values, [actor.id, 'ru', 60])
  assert.match(calls[1].sql, /t\.author_id = \$1 AND t\.status = 'published'/)
  assert.match(calls[1].sql, /NOT \(t\.hide_author IS TRUE OR \(t\.hide_author IS NULL AND a\.show_author IS FALSE\)\)/)
  assert.doesNotMatch(calls[0].sql, /subject_key|verified_at|account_linked_at|email|credential_id|password_hash/)
  assert.doesNotMatch(JSON.stringify(result), /private-uuid|-100123|secret@example|telegram/)
  const blocked = { async query() { return { rows: [{ ...actor, account_status: 'deleted' }] } } }
  await assert.rejects(() => loadPublicActorProfile(blocked, actor.public_id), /not found/)
  await assert.rejects(() => loadPublicActorProfile(db, 'not-a-public-id'), /not found/)
  assert.equal(isReservedSlug('people'), true)
  assert.equal(isReservedSlug('integration-account'), true)
  const route = await readFile(new URL('../../server/api/actors/[publicId].get.js', import.meta.url), 'utf8')
  assert.doesNotMatch(route, /requireIntegration|requireHuman|integrationsEnabled/)
  // The profile markup lives in a component shared by /people/<id> and /<username>.
  const page = await readFile(new URL('../../app/components/PublicProfile.vue', import.meta.url), 'utf8')
  assert.match(page, /referrerpolicy="no-referrer"/)
  assert.match(await readFile(new URL('../../app/pages/people/[publicId].vue', import.meta.url), 'utf8'), /<PublicProfile/)
  assert.doesNotMatch(page, /verified|ownership|claim/i, 'external metadata must not imply channel ownership')
}
