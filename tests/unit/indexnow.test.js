import { indexNowKey, indexNowKeyFile } from '../../server/utils/indexnow.js'

export async function run({ assert }) {
  assert.equal(indexNowKey(''), '', 'IndexNow stays off without a node key')
  assert.equal(indexNowKey('bad key/../x'), '', 'unsafe keys are rejected')
  assert.equal(indexNowKey(' 0123456789abcdef '), '0123456789abcdef')
  assert.equal(indexNowKeyFile('/0123456789abcdef.txt', '0123456789abcdef'), '0123456789abcdef')
  assert.equal(indexNowKeyFile('/other.txt', '0123456789abcdef'), '')
  assert.equal(indexNowKeyFile('/0123456789abcdef.txt', ''), '')
}
