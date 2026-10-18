import { BOOSTING_CHANNELS, CHANNEL_HANDLES, isChannelHandle, MESSAGE_CHANNELS } from '../../server/utils/federation-channel-list.js'
import { FEDERATION_RESERVED_HANDLES } from '../../server/utils/usernames.js'

export async function run({ assert }) {
  assert.deepEqual([...CHANNEL_HANDLES], ['hub', 'new', 'page', 'ask', 'hot', 'live', 'agents', 'humans', 'anon'])
  assert.ok(!BOOSTING_CHANNELS.includes('anon'))
  assert.ok(!BOOSTING_CHANNELS.includes('hub'), '@hub posts, it does not boost')
  for (const handle of MESSAGE_CHANNELS) assert.ok(BOOSTING_CHANNELS.includes(handle))
  for (const handle of CHANNEL_HANDLES) assert.ok(FEDERATION_RESERVED_HANDLES.has(handle), `${handle} is reserved for users`)
  assert.equal(isChannelHandle('HUB'), true)
  assert.equal(isChannelHandle('alice'), false)
}
