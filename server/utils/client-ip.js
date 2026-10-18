import { BlockList, isIP } from 'node:net'

/**
 * Normalize IP literals before deriving a reader identity. IPv4-mapped IPv6
 * addresses collapse to their IPv4 form so one client does not count twice.
 */
export function normalizeIpAddress(value) {
  if (typeof value !== 'string') return null
  const input = value.trim()
  const family = isIP(input)
  if (!family) return null
  if (family === 4) return input

  let normalized
  try {
    normalized = new URL(`http://[${input}]/`).hostname.slice(1, -1).toLowerCase()
  } catch {
    return null
  }

  if (!normalized.startsWith('::ffff:')) return normalized
  const mapped = normalized.slice('::ffff:'.length)
  if (isIP(mapped) === 4) return mapped

  const halves = mapped.split(':')
  if (halves.length !== 2) return null
  const value32 = (Number.parseInt(halves[0], 16) * 0x10000) + Number.parseInt(halves[1], 16)
  return [24, 16, 8, 0].map(shift => (value32 >>> shift) & 0xff).join('.')
}

function isLoopbackAddress(address) {
  if (!address) return false
  if (isIP(address) === 4) return Number(address.split('.')[0]) === 127
  return address === '::1'
}

let trustedProxyCache = { source: null, list: null }

/**
 * Parses AIKI_TRUSTED_PROXIES: comma-separated IP addresses or CIDR ranges of
 * reverse proxies allowed to set X-Real-IP, e.g. the Docker bridge gateway
 * `172.16.0.0/12`. Invalid entries are ignored.
 */
export function parseTrustedProxies(value = '') {
  const list = new BlockList()
  for (const entry of String(value || '').split(',').map(item => item.trim()).filter(Boolean)) {
    const [rawAddress, rawPrefix] = entry.split('/')
    const address = normalizeIpAddress(rawAddress)
    if (!address) continue
    const type = isIP(address) === 4 ? 'ipv4' : 'ipv6'
    if (rawPrefix === undefined) {
      list.addAddress(address, type)
      continue
    }
    const prefix = Number(rawPrefix)
    if (Number.isInteger(prefix) && prefix >= 0 && prefix <= (type === 'ipv4' ? 32 : 128)) list.addSubnet(address, prefix, type)
  }
  return list
}

function configuredTrustedProxies() {
  const source = process.env.AIKI_TRUSTED_PROXIES || ''
  if (trustedProxyCache.source !== source) trustedProxyCache = { source, list: parseTrustedProxies(source) }
  return trustedProxyCache.list
}

/**
 * A peer may supply proxy headers when it is loopback (a reverse proxy on the
 * same host) or listed in AIKI_TRUSTED_PROXIES (for example Docker's gateway).
 */
export function isTrustedProxyPeer(peerAddress, trustedProxies = configuredTrustedProxies()) {
  if (!peerAddress) return false
  if (isLoopbackAddress(peerAddress)) return true
  return trustedProxies.check(peerAddress, isIP(peerAddress) === 4 ? 'ipv4' : 'ipv6')
}

/**
 * The app is bound to loopback behind a reverse proxy. Only trust X-Real-IP
 * when the TCP peer is a trusted proxy; the proxy overwrites it with the
 * client's address. Ignore X-Forwarded-For entirely.
 */
export function getTrustedClientIp(headers = {}, socketAddress = '', trustedProxies = configuredTrustedProxies()) {
  const peerAddress = normalizeIpAddress(socketAddress)
  if (!peerAddress) return 'unknown'

  if (isTrustedProxyPeer(peerAddress, trustedProxies)) {
    const proxyAddress = normalizeIpAddress(headers['x-real-ip'])
    if (proxyAddress) return proxyAddress
  }
  return peerAddress
}

/**
 * Agent IDs are deliberately ignored until authenticated agent keys exist;
 * public headers cannot establish an agent identity.
 */
export function getReadIdentity(headers = {}, socketAddress = '') {
  return { readerType: 'web', identity: getTrustedClientIp(headers, socketAddress) }
}
