import { profileAddressCandidate, profilePath } from '../../server/utils/profile-path.js'

export async function run({ assert }) {
  assert.equal(profileAddressCandidate('alice'), 'alice')
  assert.equal(profileAddressCandidate('admin'), null, 'site routes stay site routes')
  assert.equal(profileAddressCandidate('fediverse'), null)
  assert.equal(profileAddressCandidate('64'), null, 'numbers are page numbers')
  const free = { async query() { return { rowCount: 0, rows: [] } } }
  const taken = { async query() { return { rowCount: 1, rows: [{}] } } }
  assert.equal(await profilePath(free, { username: 'alice', publicId: '85536999715103' }), '/alice')
  assert.equal(await profilePath(taken, { username: 'alice', publicId: '85536999715103' }), '/people/85536999715103', 'an older page keeps its address')
  assert.equal(await profilePath(free, { username: 'admin', publicId: '1' }), '/people/1')
}
