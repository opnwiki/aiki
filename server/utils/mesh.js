import { isPrivateAddress } from './validation.js'

export const MESH_PROTOCOL = 'aiki-mesh-0'
export const DEFAULT_HUB_URL = 'https://aiki.wiki'
export const MESH_NODE_LIMIT = 24

export function cleanMeshName(value) {
  const name = String(value ?? '').replace(/[\u0000-\u001f]/g, '').replace(/\s+/g, ' ').trim()
  if (!name) return ''
  return name.slice(0, 40)
}

export function hostLabel(origin) {
  try {
    return new URL(origin).host
  } catch {
    return origin
  }
}

export function normalizeMeshOrigin(input, { allowLoopback = false } = {}) {
  const raw = String(input ?? '').trim()
  if (!raw || /\s/.test(raw) || raw.length > 300) return null
  let url
  try {
    url = new URL(raw)
  } catch {
    return null
  }
  if (url.username || url.password || url.search || url.hash) return null
  if (url.pathname !== '/' && url.pathname !== '') return null
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '')
  if (!host) return null
  const loopback = host === 'localhost' || host === '127.0.0.1' || host === '::1'
  if (isPrivateAddress(host) || host.endsWith('.local') || host.endsWith('.internal')) {
    if (!(allowLoopback && loopback)) return null
  }
  if (url.protocol === 'http:' && !loopback) return null
  if (loopback && !allowLoopback) return null
  return url.origin
}

export function meshIdentity({ siteUrl, hubUrl, allowLoopback = false }) {
  const selfUrl = normalizeMeshOrigin(siteUrl, { allowLoopback: true })
  const resolvedHub = normalizeMeshOrigin(hubUrl || DEFAULT_HUB_URL, { allowLoopback }) || DEFAULT_HUB_URL
  if (!selfUrl) return null
  return {
    selfUrl,
    hubUrl: resolvedHub,
    allowLoopback,
    role: selfUrl === resolvedHub ? 'hub' : 'peer',
  }
}

export function meshLinks(nodes, hubUrl) {
  const urls = nodes.map(node => node.url)
  const links = []
  for (const url of urls) {
    if (url !== hubUrl) links.push({ from: hubUrl, to: url, via: 'hub' })
  }
  const peers = urls.filter(url => url !== hubUrl).sort()
  for (let index = 0; index < peers.length; index += 1) {
    for (let next = index + 1; next < peers.length; next += 1) {
      links.push({ from: peers[index], to: peers[next], via: 'directory' })
    }
  }
  return links
}

export function placeMeshNodes(nodes, hubUrl) {
  const hub = nodes.find(node => node.url === hubUrl) || nodes[0]
  const peers = nodes.filter(node => node.url !== hub?.url).sort((a, b) => a.url.localeCompare(b.url))
  const placed = hub ? [{ ...hub, x: 160, y: 132 }] : []
  const step = peers.length <= 1 ? 0 : (peers.length === 2 ? Math.PI * 0.72 : (2 * Math.PI / peers.length))
  peers.forEach((node, index) => {
    const angle = (-Math.PI / 2) + (index * step)
    const radius = peers.length === 1 ? 92 : 96
    placed.push({
      ...node,
      x: Math.round(160 + radius * Math.cos(angle)),
      y: Math.round(132 + radius * Math.sin(angle)),
    })
  })
  return placed
}

export function presentMesh(nodes, { selfUrl, selfName, hubUrl }) {
  const byUrl = new Map()
  for (const node of nodes) {
    if (!node?.url || byUrl.has(node.url)) continue
    byUrl.set(node.url, {
      url: node.url,
      name: node.url === selfUrl ? (cleanMeshName(selfName) || hostLabel(selfUrl)) : (cleanMeshName(node.name) || hostLabel(node.url)),
      role: node.url === hubUrl ? 'hub' : 'peer',
    })
  }
  if (!byUrl.has(selfUrl)) {
    byUrl.set(selfUrl, { url: selfUrl, name: cleanMeshName(selfName) || hostLabel(selfUrl), role: selfUrl === hubUrl ? 'hub' : 'peer' })
  }
  if (!byUrl.has(hubUrl)) {
    byUrl.set(hubUrl, { url: hubUrl, name: hostLabel(hubUrl), role: 'hub' })
  }
  const hub = byUrl.get(hubUrl)
  const self = byUrl.get(selfUrl)
  const peers = [...byUrl.values()].filter(node => node.url !== hubUrl && node.url !== selfUrl).sort((a, b) => a.url.localeCompare(b.url))
  const limitedPeers = peers.slice(0, Math.max(0, MESH_NODE_LIMIT - 2))
  const list = [hub, ...(selfUrl === hubUrl ? [] : [self]), ...limitedPeers]
  const placed = placeMeshNodes(list, hubUrl).map(node => ({
    ...node,
    self: node.url === selfUrl,
  }))
  return {
    protocol: MESH_PROTOCOL,
    role: selfUrl === hubUrl ? 'hub' : 'peer',
    self: { url: selfUrl, name: self.name, role: self.role },
    hub: { url: hubUrl, name: hub.name },
    total: placed.length,
    nodes: placed,
    links: meshLinks(placed, hubUrl),
  }
}

export function peerFromCard(card, announcedUrl, { allowLoopback = false } = {}) {
  if (card?.protocol !== MESH_PROTOCOL) return null
  const announced = normalizeMeshOrigin(announcedUrl, { allowLoopback })
  const url = normalizeMeshOrigin(card.self?.url, { allowLoopback })
  if (!announced || !url || url !== announced) return null
  return { url, name: cleanMeshName(card.self?.name) || hostLabel(url), role: 'peer' }
}

export function acceptHubDirectory(card, { selfUrl, selfName, hubUrl, allowLoopback = false }) {
  if (card?.protocol !== MESH_PROTOCOL) return null
  const spoke = normalizeMeshOrigin(card.self?.url, { allowLoopback })
  if (spoke !== hubUrl) return null
  const nodes = []
  for (const item of Array.isArray(card.nodes) ? card.nodes : []) {
    const url = normalizeMeshOrigin(item?.url, { allowLoopback })
    if (!url) continue
    nodes.push({ url, name: cleanMeshName(item?.name) || hostLabel(url), role: url === hubUrl ? 'hub' : 'peer' })
  }
  if (!nodes.some(node => node.url === selfUrl)) nodes.push({ url: selfUrl, name: cleanMeshName(selfName) || hostLabel(selfUrl), role: 'peer' })
  if (!nodes.some(node => node.url === hubUrl)) nodes.push({ url: hubUrl, name: cleanMeshName(card.self?.name) || hostLabel(hubUrl), role: 'hub' })
  return presentMesh(nodes.map(node => ({
    ...node,
    name: node.url === selfUrl ? selfName : node.name,
  })), { selfUrl, selfName, hubUrl }).nodes.map(({ url, name, role }) => ({ url, name, role }))
}

export async function fetchMeshCard(origin, { fetchImpl = fetch, allowLoopback = false, timeoutMs = 4000 } = {}) {
  const normalized = normalizeMeshOrigin(origin, { allowLoopback })
  if (!normalized) return { ok: false }
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetchImpl(`${normalized}/api/mesh`, {
      method: 'GET',
      redirect: 'manual',
      headers: { accept: 'application/json' },
      signal: controller.signal,
    })
    if (!response.ok) return { ok: false }
    const text = await response.text()
    if (!text || text.length > 100_000) return { ok: false }
    const card = JSON.parse(text)
    if (!peerFromCard(card, normalized, { allowLoopback })) return { ok: false }
    return { ok: true, card }
  } catch {
    return { ok: false }
  } finally {
    clearTimeout(timer)
  }
}

export async function syncMesh({ identity, fetchImpl = fetch, nodes, save }) {
  if (identity.role === 'hub') {
    const next = []
    for (const node of nodes) {
      if (node.url === identity.selfUrl) {
        next.push({ url: node.url, name: identity.selfName, role: 'hub' })
        continue
      }
      const card = await fetchMeshCard(node.url, { fetchImpl, allowLoopback: identity.allowLoopback })
      const peer = card.ok ? peerFromCard(card.card, node.url, { allowLoopback: identity.allowLoopback }) : null
      next.push(peer || { url: node.url, name: node.name, role: 'peer' })
    }
    await save(next)
    return { ok: true }
  }

  let announce
  try {
    announce = await fetchImpl(`${identity.hubUrl}/api/mesh/announce`, {
      method: 'POST',
      headers: { accept: 'application/json', 'content-type': 'application/json' },
      body: JSON.stringify({ url: identity.selfUrl }),
      redirect: 'manual',
    })
  } catch {
    return { ok: false }
  }
  if (!announce.ok) return { ok: false }
  const hub = await fetchMeshCard(identity.hubUrl, { fetchImpl, allowLoopback: identity.allowLoopback })
  if (!hub.ok) return { ok: false }
  const accepted = acceptHubDirectory(hub.card, identity)
  if (!accepted) return { ok: false }
  await save(accepted)
  return { ok: true }
}
