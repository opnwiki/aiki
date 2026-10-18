import { meshIdentity, normalizeMeshOrigin } from './mesh.js'

export const PRODUCT_VERSION = '1.2.11'

const VERSION_TEXT = /^\d{1,6}(?:\.\d{1,6}){0,3}$/

export function parseVersion(value) {
  const text = String(value ?? '').trim()
  if (!VERSION_TEXT.test(text)) return null
  const parts = text.split('.').map(part => Number(part))
  while (parts.length < 4) parts.push(0)
  return parts
}

export function compareVersions(left, right) {
  const a = parseVersion(left)
  const b = parseVersion(right)
  if (!a || !b) return null
  for (let index = 0; index < 4; index += 1) {
    if (a[index] !== b[index]) return a[index] > b[index] ? 1 : -1
  }
  return 0
}

export function isNewerVersion(candidate, current) {
  return compareVersions(candidate, current) === 1
}

function hostOf(origin) {
  try {
    return new URL(origin).hostname.toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '')
  } catch {
    return ''
  }
}

function isLoopbackHost(host) {
  return host === 'localhost' || host === '127.0.0.1' || host === '::1'
}

export function shouldAskHubForRelease({ siteUrl, hubUrl, allowLoopback = false }) {
  const identity = meshIdentity({ siteUrl, hubUrl, allowLoopback })
  if (!identity || identity.role === 'hub') return false
  const siteHost = hostOf(identity.selfUrl)
  const hubHost = hostOf(identity.hubUrl)
  if (isLoopbackHost(siteHost) && hubHost === 'aiki.wiki') return false
  return Boolean(normalizeMeshOrigin(identity.hubUrl, { allowLoopback: identity.allowLoopback }))
}

export function versionFromNodePayload(payload) {
  const version = payload?.node?.version
  if (typeof version !== 'string') return null
  const text = version.trim()
  return parseVersion(text) ? text : null
}

export async function fetchHubRelease(origin, { fetchImpl = fetch, allowLoopback = false, timeoutMs = 4000 } = {}) {
  const normalized = normalizeMeshOrigin(origin, { allowLoopback })
  if (!normalized) return { ok: false }
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetchImpl(`${normalized}/api/node`, {
      method: 'GET',
      redirect: 'manual',
      headers: { accept: 'application/json' },
      signal: controller.signal,
    })
    if (!response?.ok || response.status >= 300) return { ok: false }
    const text = await response.text()
    if (!text || text.length > 100_000) return { ok: false }
    const version = versionFromNodePayload(JSON.parse(text))
    if (!version) return { ok: false }
    return { ok: true, version }
  } catch {
    return { ok: false }
  } finally {
    clearTimeout(timer)
  }
}

export async function assessHubRelease({ siteUrl, hubUrl, allowLoopback = false, fetchImpl = fetch, timeoutMs = 4000 }) {
  const version = PRODUCT_VERSION
  if (!shouldAskHubForRelease({ siteUrl, hubUrl, allowLoopback })) {
    return { version, hubVersion: null, updateAvailable: false }
  }
  const identity = meshIdentity({ siteUrl, hubUrl, allowLoopback })
  const remote = await fetchHubRelease(identity.hubUrl, { fetchImpl, allowLoopback, timeoutMs })
  if (!remote.ok) return { version, hubVersion: null, updateAvailable: false }
  return {
    version,
    hubVersion: remote.version,
    updateAvailable: isNewerVersion(remote.version, version),
  }
}
