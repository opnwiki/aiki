import { spawn } from 'node:child_process'
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises'
import { createHash, randomUUID } from 'node:crypto'
import { parseArgs } from 'node:util'
import path from 'node:path'
import os from 'node:os'
import { fileURLToPath } from 'node:url'
import { dockerProfile, releaseTags, registryDigest, assertPlatforms } from './docker-release.js'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const { values } = parseArgs({ options: {
  'env-file': { type: 'string', default: path.join(root, '.env') },
  ref: { type: 'string', default: 'HEAD' },
  platforms: { type: 'string', default: 'linux/amd64' },
  'sensitive-env-file': { type: 'string', multiple: true, default: [] },
  wsl: { type: 'string' },
  help: { type: 'boolean' },
} })
if (values.help) {
  console.log('node scripts/publish-docker.mjs [--ref main] [--env-file /path/.env] [--platforms linux/amd64,linux/arm64] [--sensitive-env-file /path/runtime.env] [--wsl Ubuntu]')
  process.exit(0)
}
if (values.wsl && process.platform !== 'win32') throw new Error('--wsl is only needed on Windows.')
const profile = dockerProfile(await readFile(path.resolve(values['env-file']), 'utf8'))
const platforms = [...new Set(values.platforms.split(','))]
if (!platforms.length || platforms.some(platform => !['linux/amd64', 'linux/arm64'].includes(platform))) throw new Error('Use linux/amd64 and/or linux/arm64.')
const secrets = new Set([profile.token])
secrets.add(Buffer.from(`${profile.username}:${profile.token}`).toString('base64'))
const { parseEnv } = await import('node:util')
for (const file of values['sensitive-env-file']) {
  for (const [key, value] of Object.entries(parseEnv(await readFile(path.resolve(file), 'utf8')))) {
    if (!/(SECRET|TOKEN|PASSWORD|KEY|DATABASE_URL)/i.test(key) || value.length < 8) continue
    secrets.add(value)
    if (/DATABASE_URL/i.test(key)) {
      try { const password = decodeURIComponent(new URL(value).password); if (password.length >= 8) secrets.add(password) } catch {}
    }
  }
}
const cleanEnv = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^(DOCKER_TOKEN|DOCKER_USERNAME|DOCKER_REPS|DATABASE_URL|POSTGRES_|RATE_LIMIT_SECRET|READ_HMAC_SECRET|NUXT_|NITRO_|NERON_|AIKI_ACCEPT_)/i.test(key)))
const redact = text => { let safe = String(text); for (const secret of secrets) safe = safe.replaceAll(secret, '[redacted]'); return safe }
const temp = await mkdtemp(path.join(os.tmpdir(), 'aiki-publish-'))
const context = path.join(temp, 'source')
let config
const dockerBase = values.wsl ? ['-d', values.wsl, '-u', 'root', '--exec', 'docker'] : []
const dockerProgram = values.wsl ? 'wsl.exe' : 'docker'
// Systemd services alone do not keep a WSL instance alive. Hold stdin open
// during the release, then send EOF so the foreground command exits cleanly.
const wslGuard = values.wsl ? spawn('wsl.exe', ['-d', values.wsl, '-u', 'root', '--exec', 'cat'], { windowsHide: true, stdio: ['pipe', 'ignore', 'ignore'] }) : null
if (wslGuard) wslGuard.on('error', () => {})

async function run(program, args, { cwd = root, env = cleanEnv, input, quiet = false } = {}) {
  return await new Promise((resolve, reject) => {
    const child = spawn(program, args, { cwd, env, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] })
    const chunks = []
    let display = ''
    child.on('error', reject)
    for (const stream of [child.stdout, child.stderr]) stream.on('data', chunk => {
      const text = chunk.toString()
      chunks.push(text)
      if (!quiet) {
        display += text
        const lines = display.split('\n')
        display = lines.pop()
        for (const line of lines) console.log(redact(line))
      }
    })
    child.on('close', code => {
      if (!quiet && display) console.log(redact(display))
      const output = redact(chunks.join(''))
      if (code !== 0) reject(new Error(`${path.basename(program)} failed (${code}).\n${output.slice(-12000)}`))
      else resolve(output)
    })
    child.stdin.end(input)
  })
}
async function linuxPath(value) {
  return (await run('wsl.exe', ['-d', values.wsl, '-u', 'root', '--exec', 'wslpath', '-u', value.replaceAll('\\', '/')], { quiet: true })).trim()
}
function docker(args, options = {}) {
  return run(dockerProgram, [...dockerBase, ...(config ? ['--config', config] : []), ...args], options)
}
async function verifyRemote(image) {
  const manifest = JSON.parse(await docker(['buildx', 'imagetools', 'inspect', '--raw', image], { quiet: true }))
  if (manifest.manifests) assertPlatforms(manifest, platforms)
  else assertPlatforms(JSON.parse(await docker(['buildx', 'imagetools', 'inspect', '--format', '{{json .Image}}', image], { quiet: true })), platforms)
  return registryDigest(await docker(['buildx', 'imagetools', 'inspect', image], { quiet: true }))
}

try {
  await mkdir(context)
  const revision = (await run('git', ['rev-parse', '--verify', '--end-of-options', `${values.ref}^{commit}`], { quiet: true })).trim()
  if (!/^[a-f0-9]{40}$/.test(revision)) throw new Error('Could not resolve the source commit.')
  const archive = path.join(temp, 'source.tar')
  await run('git', ['archive', '--format=tar', `--output=${archive}`, revision], { quiet: true })
  await run('tar', ['-xf', archive, '-C', context], { quiet: true })
  // Only packaging and release checks are overlaid; uncommitted app changes stay out.
  const packaging = ['Dockerfile', '.dockerignore', 'compose.yaml', 'compose.registry.yaml', 'docker/entrypoint.sh', 'docker/buildkitd.toml', 'scripts/compose-acceptance.mjs', 'scripts/docker-release.js', 'scripts/publish-docker.mjs', 'scripts/audit-docker-images.py', 'tests/unit/docker-release.test.js', 'tests/unit/nav-drawer.test.js']
  for (const name of packaging) {
    const destination = path.join(context, name)
    await mkdir(path.dirname(destination), { recursive: true })
    const contents = (await readFile(path.join(root, name), 'utf8')).replaceAll('\r\n', '\n')
    await writeFile(destination, contents)
  }
  const version = JSON.parse(await readFile(path.join(context, 'package.json'), 'utf8')).version
  const tags = releaseTags(version, revision)
  const runtimeImage = `${profile.image}:${tags.runtime[0]}`
  const migrationImage = `${profile.image}:${tags.migrate[0]}`
  const buildContext = values.wsl ? await linuxPath(context) : context
  if (values.wsl) {
    config = `/tmp/aiki-docker-${randomUUID()}`
    await run('wsl.exe', ['-d', values.wsl, '-u', 'root', '--exec', 'mkdir', '-m', '700', config], { quiet: true })
  } else {
    config = path.join(temp, 'auth')
    await mkdir(config, { mode: 0o700 })
  }
  console.log(`Source ${revision}; version ${version}; publishing ${profile.image}`)
  const auditScript = path.join(context, 'scripts/audit-docker-images.py')
  if (values.wsl) {
    await run('wsl.exe', ['-d', values.wsl, '-u', 'root', '--exec', 'python3', `${buildContext}/scripts/audit-docker-images.py`, '--source', buildContext], { input: JSON.stringify([...secrets]), quiet: false })
  } else await run('python3', [auditScript, '--source', context], { input: JSON.stringify([...secrets]) })
  await docker(['login', '--username', profile.username, '--password-stdin'], { input: `${profile.token}\n`, quiet: true })
  await docker(['version'], { quiet: true })
  if (values.wsl) await docker(['run', '--privileged', '--rm', 'tonistiigi/binfmt', '--install', 'amd64,arm64'])
  try { await docker(['buildx', 'inspect', 'aiki-publisher'], { quiet: true }) }
  catch {
    const builderConfig = values.wsl ? await linuxPath(path.join(root, 'docker/buildkitd.toml')) : path.join(root, 'docker/buildkitd.toml')
    await docker(['buildx', 'create', '--name', 'aiki-publisher', '--driver', 'docker-container', '--driver-opt', 'memory=1024m', '--driver-opt', 'memory-swap=1792m', '--buildkitd-config', builderConfig])
  }
  await docker(['buildx', 'inspect', 'aiki-publisher', '--bootstrap'])
  const labels = ['--label', `org.opencontainers.image.version=${version}`, '--label', `org.opencontainers.image.revision=${revision}`, '--label', 'org.opencontainers.image.source=https://github.com/opnwiki/aiki']
  for (const [target, image] of [['runtime', runtimeImage], ['migrate', migrationImage]]) {
    console.log(`Building ${target}: ${platforms.join(',')}`)
    await docker(['buildx', 'build', '--builder', 'aiki-publisher', '--pull', '--load', '--platform', platforms.join(','), '--target', target, '--tag', image, ...labels, '--progress', 'plain', buildContext])
  }
  const savedImages = path.join(temp, 'images.tar')
  await docker(['save', '--output', values.wsl ? await linuxPath(savedImages) : savedImages, runtimeImage, migrationImage])
  if (values.wsl) {
    await run('wsl.exe', ['-d', values.wsl, '-u', 'root', '--exec', 'python3', `${buildContext}/scripts/audit-docker-images.py`, '--images', await linuxPath(savedImages)], { input: JSON.stringify([...secrets]) })
  } else await run('python3', [auditScript, '--images', savedImages], { input: JSON.stringify([...secrets]) })
  await rm(savedImages)
  await docker(['buildx', 'stop', 'aiki-publisher'], { quiet: true })
  for (const platform of platforms) {
    console.log(`Testing ${platform} on a disposable Compose database`)
    const testEnv = { ...cleanEnv, DOCKER_CONFIG: config, AIKI_ACCEPT_IMAGE: runtimeImage, AIKI_ACCEPT_MIGRATION_IMAGE: migrationImage, AIKI_ACCEPT_PLATFORM: platform }
    if (values.wsl) {
      await run('wsl.exe', ['-d', values.wsl, '-u', 'root', '--exec', 'env', `DOCKER_CONFIG=${config}`, `AIKI_ACCEPT_IMAGE=${runtimeImage}`, `AIKI_ACCEPT_MIGRATION_IMAGE=${migrationImage}`, `AIKI_ACCEPT_PLATFORM=${platform}`, 'node', `${buildContext}/scripts/compose-acceptance.mjs`], { cwd: context })
    } else {
      await run(process.execPath, [path.join(context, 'scripts/compose-acceptance.mjs')], { cwd: context, env: testEnv })
    }
    await docker(['run', '--rm', '--platform', platform, '--entrypoint', 'node', runtimeImage, '--input-type=module', '-e', "import fs from 'node:fs'; if(process.getuid() !== 1000) throw new Error('runtime must run as node'); for(const p of ['/app/.env','/app/.local','/app/.neron-runtime.env']) if(fs.existsSync(p)) throw new Error('unexpected private file'); console.log('PASS non-root runtime and no private files')"])
  }
  // Publish immutable artifacts first, then move aliases only when both passed.
  await docker(['push', migrationImage])
  await docker(['push', runtimeImage])
  const migrationDigest = await verifyRemote(migrationImage)
  const runtimeDigest = await verifyRemote(runtimeImage)
  for (const [source, aliases] of [[migrationImage, tags.migrate.slice(1)], [runtimeImage, tags.runtime.slice(1)]]) {
    for (const tag of aliases) {
      const image = `${profile.image}:${tag}`
      await docker(['tag', source, image])
      await docker(['push', image])
      const digest = await verifyRemote(image)
      if (digest !== (source === runtimeImage ? runtimeDigest : migrationDigest)) throw new Error('A registry alias does not match the tested image.')
    }
  }
  const report = { image: profile.image, version, revision, tag: tags.immutable, platforms, runtimeDigest, migrationDigest, secretAudit: 'source, image config and every image layer passed',
    dockerfileSha256: createHash('sha256').update(await readFile(path.join(context, 'Dockerfile'))).digest('hex'), publishedAt: new Date().toISOString() }
  await mkdir(path.join(root, '.local'), { recursive: true })
  await writeFile(path.join(root, '.local/docker-release.json'), `${JSON.stringify(report, null, 2)}\n`)
  console.log(`Published ${profile.image}:${version} and :latest\nRuntime ${runtimeDigest}\nMigration ${migrationDigest}`)
} finally {
  wslGuard?.stdin.end()
  if (config) {
    if (values.wsl) {
      if (!/^\/tmp\/aiki-docker-[a-f0-9-]{36}$/.test(config)) throw new Error('Unsafe temporary credential path.')
      await run('wsl.exe', ['-d', values.wsl, '-u', 'root', '--exec', 'rm', '-rf', '--', config], { quiet: true })
    }
  }
  if (path.dirname(temp) !== os.tmpdir() || !path.basename(temp).startsWith('aiki-publish-')) throw new Error('Unsafe temporary context path.')
  await rm(temp, { recursive: true, force: true })
}
