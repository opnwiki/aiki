import { readRemoteProfile, remoteActorAvatarPath } from '../../server/utils/federation-remote-actors.js'

export async function run({ assert }) {
  const actor = {
    id: new URL('https://toot.io/users/alice'),
    preferredUsername: 'alice',
    name: '  Dev   Storm ',
    url: new URL('https://toot.io/@alice'),
    getIcon: async () => ({ url: new URL('https://files.toot.io/avatars/1.png') }),
  }
  assert.deepEqual(await readRemoteProfile(actor), {
    acct: 'alice@toot.io',
    displayName: 'Dev Storm',
    profileUrl: 'https://toot.io/@alice',
    iconUrl: 'https://files.toot.io/avatars/1.png',
  })
  // Plain-http icons are never fetched; a missing name falls back to the handle.
  const bare = await readRemoteProfile({ id: new URL('https://a.example/u/x'), preferredUsername: 'x', getIcon: async () => ({ url: new URL('http://a.example/i.png') }) })
  assert.equal(bare.iconUrl, null)
  assert.equal(bare.displayName, 'x')
  assert.equal(bare.profileUrl, 'https://a.example/u/x')
  assert.equal(remoteActorAvatarPath('6c3a37ac-7bd1-42b5-9108-f5991190e5c2'), '/api/federation-actors/6c3a37ac-7bd1-42b5-9108-f5991190e5c2/avatar')
  assert.equal(remoteActorAvatarPath('../etc'), null)
}
