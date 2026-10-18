import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto'
import { promisify } from 'node:util'

const scrypt = promisify(scryptCallback)
const COST = 16_384
const BLOCK_SIZE = 8
const PARALLELISM = 1
const KEY_LENGTH = 64
const MAX_MEMORY = 64 * 1024 * 1024

export async function hashPassword(password) {
  const salt = randomBytes(16)
  const derived = await scrypt(String(password), salt, KEY_LENGTH, {
    N: COST,
    r: BLOCK_SIZE,
    p: PARALLELISM,
    maxmem: MAX_MEMORY,
  })
  return `scrypt$${COST}$${BLOCK_SIZE}$${PARALLELISM}$${salt.toString('base64url')}$${Buffer.from(derived).toString('base64url')}`
}

export async function verifyPassword(password, encoded) {
  const [algorithm, costText, blockText, parallelText, saltText, keyText, extra] = String(encoded || '').split('$')
  if (algorithm !== 'scrypt' || extra !== undefined) return false

  const cost = Number(costText)
  const blockSize = Number(blockText)
  const parallelism = Number(parallelText)
  if (cost !== COST || blockSize !== BLOCK_SIZE || parallelism !== PARALLELISM) return false

  let salt
  let expected
  try {
    salt = Buffer.from(saltText, 'base64url')
    expected = Buffer.from(keyText, 'base64url')
  } catch {
    return false
  }
  if (salt.length !== 16 || expected.length !== KEY_LENGTH) return false

  const actual = Buffer.from(await scrypt(String(password), salt, KEY_LENGTH, {
    N: cost,
    r: blockSize,
    p: parallelism,
    maxmem: MAX_MEMORY,
  }))
  return timingSafeEqual(actual, expected)
}
