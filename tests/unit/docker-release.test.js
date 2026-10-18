import { dockerProfile, releaseTags, registryDigest, assertPlatforms } from '../../scripts/docker-release.js'

export function run({ assert }) {
  const token = 'fixture-token-not-a-secret'
  assert.deepEqual(dockerProfile(`DOCKER_USERNAME=example\nDOCKER_REPS=aiki\nDOCKER_TOKEN="${token}"`), { username: 'example', image: 'example/aiki', token })
  assert.equal(dockerProfile(`DOCKER_USERNAME=example\nDOCKER_REPS=team/aiki\nDOCKER_TOKEN=${token}`).image, 'team/aiki')
  for (const repository of ['aiki:latest', '../aiki', 'aiki;echo nope', 'aiki,other', 'https://docker.io/aiki']) {
    assert.throws(() => dockerProfile(`DOCKER_USERNAME=example\nDOCKER_REPS=${repository}\nDOCKER_TOKEN=${token}`))
  }
  assert.throws(() => dockerProfile('DOCKER_USERNAME=example\nDOCKER_REPS=aiki'), /DOCKER_TOKEN/)
  const tags = releaseTags('1.2.11', 'a'.repeat(40), new Date('2026-10-04T01:02:03Z'))
  assert.equal(tags.immutable, '1.2.11-aaaaaaa-20261004T010203Z')
  assert.equal(tags.migrate[0], `${tags.runtime[0]}-migrate`)
  assert.deepEqual(tags.runtime.slice(1), ['1.2.11', 'latest'])
  assert.throws(() => releaseTags('bad version', 'a'.repeat(40)))
  const digest = `sha256:${'b'.repeat(64)}`
  assert.equal(registryDigest(`Name: example/aiki\nDigest: ${digest}\n`), digest)
  assert.throws(() => registryDigest('push failed'))
  assertPlatforms({ manifests: [{ platform: { os: 'linux', architecture: 'arm64' } }, { platform: { os: 'linux', architecture: 'amd64' } }] })
  assert.throws(() => assertPlatforms({ manifests: [{ platform: { os: 'linux', architecture: 'amd64' } }] }))
  assertPlatforms({ os: 'linux', architecture: 'amd64' }, ['linux/amd64'])
  assert.throws(() => assertPlatforms({ os: 'linux', architecture: 'arm64' }, ['linux/amd64']))
}
