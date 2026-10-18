import { createError } from 'h3'
import { getDatabase } from './database.js'
import { shownBrandName, loadNodeFacts } from './node-profile.js'
import {
  DEFAULT_HUB_URL,
  MESH_NODE_LIMIT,
  cleanMeshName,
  fetchMeshCard,
  hostLabel,
  meshIdentity,
  normalizeMeshOrigin,
  peerFromCard,
  presentMesh,
  syncMesh,
} from './mesh.js'

export async function readMeshIdentity(client) {
  const config = useRuntimeConfig()
  const facts = await loadNodeFacts(client)
  const stored = await client.query('SELECT mesh_hub_url FROM nodes WHERE is_home LIMIT 1')
  const hubInput = stored.rows[0]?.mesh_hub_url || config.hubUrl || DEFAULT_HUB_URL
  const allowLoopback = config.meshAllowLoopback === true
  const identity = meshIdentity({
    siteUrl: config.public.siteUrl,
    hubUrl: hubInput,
    allowLoopback,
  })
  if (!identity) throw createError({ statusCode: 409, statusMessage: 'This node has no public address for the mesh.' })
  return {
    ...identity,
    selfName: shownBrandName(facts.displayName),
    hubInput: normalizeMeshOrigin(hubInput, { allowLoopback }) || DEFAULT_HUB_URL,
  }
}

export async function readMeshRows(client) {
  const result = await client.query('SELECT base_url, display_name, role FROM mesh_nodes ORDER BY base_url')
  return result.rows.map(row => ({ url: row.base_url, name: row.display_name, role: row.role }))
}

export async function saveMeshNodes(client, nodes) {
  const unique = []
  const seen = new Set()
  for (const node of nodes) {
    if (!node?.url || seen.has(node.url)) continue
    seen.add(node.url)
    unique.push({
      url: node.url,
      name: cleanMeshName(node.name) || hostLabel(node.url),
      role: node.role === 'hub' ? 'hub' : 'peer',
    })
  }
  const urls = unique.map(node => node.url)
  await client.query('DELETE FROM mesh_nodes WHERE NOT (base_url = ANY($1::text[]))', [urls.length ? urls : ['']])
  for (const node of unique) {
    await client.query(
      `INSERT INTO mesh_nodes (base_url, display_name, role, last_seen_at)
       VALUES ($1, $2, $3, now())
       ON CONFLICT (base_url) DO UPDATE
         SET display_name = EXCLUDED.display_name,
             role = EXCLUDED.role,
             last_seen_at = now()`,
      [node.url, node.name, node.role],
    )
  }
}

export async function ensureMeshRows(client, identity) {
  const rows = await readMeshRows(client)
  const mesh = presentMesh(rows, identity)
  const missingSelf = !rows.some(row => row.url === identity.selfUrl)
  const missingHub = !rows.some(row => row.url === identity.hubUrl)
  if (missingSelf || missingHub || rows.some(row => row.url === identity.selfUrl && row.name !== identity.selfName)) {
    await saveMeshNodes(client, mesh.nodes)
  }
  return presentMesh(await readMeshRows(client), identity)
}

export async function admitMeshPeer(client, identity, rawUrl, fetchImpl = fetch) {
  if (identity.role !== 'hub') {
    throw createError({ statusCode: 403, statusMessage: 'Only the central instance accepts nodes.' })
  }
  const announced = normalizeMeshOrigin(rawUrl, { allowLoopback: identity.allowLoopback })
  if (!announced) throw createError({ statusCode: 400, statusMessage: 'Enter a public node address.' })
  if (announced === identity.selfUrl) throw createError({ statusCode: 409, statusMessage: 'The central instance is already in the map.' })
  const count = await client.query('SELECT count(*)::int AS total FROM mesh_nodes')
  if (Number(count.rows[0].total) >= MESH_NODE_LIMIT && !(await readMeshRows(client)).some(row => row.url === announced)) {
    throw createError({ statusCode: 409, statusMessage: 'The node map is full.' })
  }
  const card = await fetchMeshCard(announced, { fetchImpl, allowLoopback: identity.allowLoopback })
  const peer = card.ok ? peerFromCard(card.card, announced, { allowLoopback: identity.allowLoopback }) : null
  if (!peer) throw createError({ statusCode: 422, statusMessage: 'That address did not confirm it is this node.' })
  const rows = await readMeshRows(client)
  const without = rows.filter(row => row.url !== peer.url && row.url !== identity.selfUrl)
  await saveMeshNodes(client, [{ url: identity.selfUrl, name: identity.selfName, role: 'hub' }, ...without, peer])
  return peer
}

export async function removeMeshPeer(client, identity, rawUrl) {
  const url = normalizeMeshOrigin(rawUrl, { allowLoopback: identity.allowLoopback })
  if (!url) throw createError({ statusCode: 400, statusMessage: 'Enter a public node address.' })
  if (url === identity.selfUrl || url === identity.hubUrl) {
    throw createError({ statusCode: 409, statusMessage: 'The center stays on the map.' })
  }
  await client.query('DELETE FROM mesh_nodes WHERE base_url = $1', [url])
}

export async function setMeshHub(client, identity, rawUrl) {
  const hubUrl = normalizeMeshOrigin(rawUrl, { allowLoopback: identity.allowLoopback })
  if (!hubUrl) throw createError({ statusCode: 400, statusMessage: 'Enter a public node address.' })
  const updated = await client.query(
    'UPDATE nodes SET mesh_hub_url = $1 WHERE is_home RETURNING id',
    [hubUrl],
  )
  if (!updated.rows[0]) throw createError({ statusCode: 409, statusMessage: 'This node has no home record to update.' })
  await client.query('DELETE FROM mesh_nodes')
  return hubUrl
}

export async function refreshMesh(client, identity) {
  const rows = await readMeshRows(client)
  const result = await syncMesh({
    identity,
    nodes: rows,
    save: async (nodes) => saveMeshNodes(client, nodes),
  })
  if (!result.ok) throw createError({ statusCode: 422, statusMessage: 'The central instance did not confirm the directory.' })
}

export async function meshView(client, identity) {
  const mesh = await ensureMeshRows(client, identity)
  return { mesh, hubUrl: identity.hubInput }
}

export function meshDatabase() {
  return getDatabase()
}
