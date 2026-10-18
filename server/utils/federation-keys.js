import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

const DEFAULT_PRODUCTION_KEY_FILE = '/var/lib/aiki/federation-private-key.jwk'
const DEFAULT_DEVELOPMENT_KEY_FILE = path.resolve('.local/federation-private-key.jwk')

export function federationKeyFilePath(env = process.env) {
  const configured = env.NUXT_FEDERATION_PRIVATE_KEY_FILE || env.FEDERATION_PRIVATE_KEY_FILE
  if (configured) return configured
  return env.NODE_ENV === 'production' ? DEFAULT_PRODUCTION_KEY_FILE : DEFAULT_DEVELOPMENT_KEY_FILE
}

export function readFederationKeyPayload(env = process.env) {
  const fromEnvironment = env.NUXT_FEDERATION_PRIVATE_KEY_JWK || env.FEDERATION_PRIVATE_KEY_JWK
  if (fromEnvironment) return { value: fromEnvironment, source: 'environment', path: null }

  const filePath = federationKeyFilePath(env)
  try {
    return { value: fs.readFileSync(filePath, 'utf8'), source: 'file', path: filePath }
  } catch (error) {
    if (error?.code === 'ENOENT') return { value: null, source: null, path: filePath }
    throw new Error(`Federation signing key file cannot be read: ${error instanceof Error ? error.message : String(error)}`)
  }
}

export function parseFederationKeyPayload(value) {
  if (!value) return null
  const parsed = typeof value === 'string' ? JSON.parse(value) : value
  const rsa = parsed?.rsa || parsed?.httpSignature || parsed
  const rsaPrivate = rsa?.privateKeyJwk || rsa?.private || rsa
  if (rsaPrivate?.kty !== 'RSA' || typeof rsaPrivate.d !== 'string' || rsaPrivate.d.length < 20) return null
  return parsed
}

export function hasUsableFederationKey(env = process.env) {
  try {
    return Boolean(parseFederationKeyPayload(readFederationKeyPayload(env).value))
  } catch {
    return false
  }
}

export async function ensureFederationSigningKey(env = process.env) {
  const configured = readFederationKeyPayload(env)
  if (configured.value) {
    if (!parseFederationKeyPayload(configured.value)) {
      throw new Error('Configured federation signing key is invalid.')
    }
    return { created: false, source: configured.source, path: configured.path }
  }

  const filePath = configured.path || federationKeyFilePath(env)
  const payload = generateFederationKeyPayload()
  const serialized = JSON.stringify(payload)
  fs.mkdirSync(path.dirname(filePath), { recursive: true, mode: 0o700 })
  const tempPath = `${filePath}.tmp.${process.pid}.${Date.now()}`
  try {
    const descriptor = fs.openSync(tempPath, 'wx', 0o600)
    try {
      fs.writeFileSync(descriptor, serialized, { encoding: 'utf8' })
      fs.fsyncSync(descriptor)
    } finally {
      fs.closeSync(descriptor)
    }
    fs.chmodSync(tempPath, 0o600)
    try {
      fs.renameSync(tempPath, filePath)
    } catch (error) {
      // Some Windows sandbox filesystems reject same-directory rename while
      // still allowing the equivalent atomic-enough copy of a closed file.
      if (error?.code !== 'EPERM' && error?.code !== 'EXDEV') throw error
      fs.copyFileSync(tempPath, filePath)
      fs.chmodSync(filePath, 0o600)
      fs.unlinkSync(tempPath)
    }
  } catch (error) {
    try { fs.unlinkSync(tempPath) } catch {}
    if (error?.code !== 'EEXIST') throw error
    const existing = readFederationKeyPayload({ ...env, FEDERATION_PRIVATE_KEY_FILE: filePath, NUXT_FEDERATION_PRIVATE_KEY_FILE: filePath })
    if (!parseFederationKeyPayload(existing.value)) throw new Error('Federation signing key file already exists but is invalid.')
    return { created: false, source: 'file', path: filePath }
  }
  return { created: true, source: 'file', path: filePath }
}

function generateFederationKeyPayload() {
  const rsa = keyPairPayload(crypto.generateKeyPairSync('rsa', { modulusLength: 2048 }), 'RS256')
  const ed25519 = keyPairPayload(crypto.generateKeyPairSync('ed25519'), null)
  return { rsa, ed25519 }
}

function keyPairPayload(pair, alg) {
  const privateKeyJwk = pair.privateKey.export({ format: 'jwk' })
  const publicKeyJwk = pair.publicKey.export({ format: 'jwk' })
  if (alg) {
    privateKeyJwk.alg = alg
    publicKeyJwk.alg = alg
  }
  return { privateKeyJwk, publicKeyJwk }
}
