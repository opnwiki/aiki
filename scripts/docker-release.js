import { parseEnv } from 'node:util'

export function dockerProfile(text) {
  const values = parseEnv(text)
  const username = values.DOCKER_USERNAME?.trim()
  const repository = values.DOCKER_REPS?.trim()
  const token = values.DOCKER_TOKEN?.trim()
  if (!username || !repository || !token) throw new Error('Set DOCKER_USERNAME, DOCKER_REPS and DOCKER_TOKEN in the env file.')
  if (!/^[a-z0-9][a-z0-9_-]*$/.test(username) || !/^[a-z0-9][a-z0-9._-]*(?:\/[a-z0-9][a-z0-9._-]*)?$/.test(repository)) throw new Error('Use a Docker Hub username and one repository name in DOCKER_REPS.')
  return { username, token, image: repository.includes('/') ? repository : `${username}/${repository}` }
}

export function releaseTags(version, revision, date = new Date()) {
  if (!/^\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?$/.test(version) || !/^[a-f0-9]{40}$/.test(revision)) throw new Error('A package version and full Git commit are required.')
  const stamp = date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z')
  const immutable = `${version}-${revision.slice(0, 7)}-${stamp}`
  return { immutable, runtime: [immutable, version, 'latest'], migrate: [`${immutable}-migrate`, `${version}-migrate`, 'latest-migrate'] }
}

export function registryDigest(output) {
  const digest = /^Digest:\s*(sha256:[a-f0-9]{64})\s*$/m.exec(output)?.[1]
  if (!digest) throw new Error('The registry did not return an image digest.')
  return digest
}

export function assertPlatforms(manifest, expected = ['linux/amd64', 'linux/arm64']) {
  const platforms = new Set((manifest.manifests || []).map(item => `${item.platform?.os}/${item.platform?.architecture}`))
  if (manifest.os && manifest.architecture) platforms.add(`${manifest.os}/${manifest.architecture}`)
  if (expected.some(platform => !platforms.has(platform))) throw new Error('The requested platforms must exist in the registry manifest.')
}
