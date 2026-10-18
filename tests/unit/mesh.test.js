import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { translate } from '../../app/utils/i18n.js'
import {
  DEFAULT_HUB_URL,
  acceptHubDirectory,
  meshIdentity,
  meshLinks,
  normalizeMeshOrigin,
  peerFromCard,
  presentMesh,
  syncMesh,
} from '../../server/utils/mesh.js'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

export async function run({ assert }) {
  assert.equal(DEFAULT_HUB_URL, 'https://aiki.wiki')
  assert.equal(normalizeMeshOrigin('https://aiki.wiki').endsWith('aiki.wiki'), true)
  assert.equal(normalizeMeshOrigin('https://aiki.wiki/mcp'), null)
  assert.equal(normalizeMeshOrigin('https://user:secret@aiki.wiki'), null)
  assert.equal(normalizeMeshOrigin('http://10.1.2.3'), null)
  assert.equal(normalizeMeshOrigin('http://127.0.0.1:3037'), null)
  assert.equal(normalizeMeshOrigin('http://127.0.0.1:3037', { allowLoopback: true }), 'http://127.0.0.1:3037')

  const center = meshIdentity({ siteUrl: 'https://aiki.wiki', hubUrl: 'https://aiki.wiki' })
  assert.equal(center.role, 'hub')
  const extra = meshIdentity({ siteUrl: 'https://north.example', hubUrl: '' })
  assert.equal(extra.role, 'peer')
  assert.equal(extra.hubUrl, 'https://aiki.wiki')

  const nodes = [
    { url: 'https://aiki.wiki', name: 'AiKi' },
    { url: 'https://north.example', name: 'North' },
    { url: 'https://south.example', name: 'South' },
  ]
  const links = meshLinks(nodes, 'https://aiki.wiki')
  assert.equal(links.filter(link => link.via === 'hub').length, 2)
  assert.deepEqual(links.find(link => link.via === 'directory'), { from: 'https://north.example', to: 'https://south.example', via: 'directory' })

  const mesh = presentMesh(nodes, { selfUrl: 'https://aiki.wiki', selfName: 'AiKi', hubUrl: 'https://aiki.wiki' })
  assert.equal(mesh.total, 3)
  assert.equal(mesh.nodes.find(node => node.role === 'hub').x, 160)
  assert.equal(mesh.protocol, 'aiki-mesh-0')

  const card = {
    protocol: 'aiki-mesh-0',
    self: { url: 'https://north.example', name: 'North' },
  }
  assert.equal(peerFromCard(card, 'https://north.example').name, 'North')
  assert.equal(peerFromCard(card, 'https://other.example'), null)

  const directory = {
    protocol: 'aiki-mesh-0',
    self: { url: 'https://aiki.wiki', name: 'AiKi' },
    nodes: [
      { url: 'https://aiki.wiki', name: 'AiKi' },
      { url: 'https://north.example', name: 'North' },
      { url: 'https://south.example', name: 'South' },
    ],
  }
  const accepted = acceptHubDirectory(directory, {
    selfUrl: 'https://north.example',
    selfName: 'North',
    hubUrl: 'https://aiki.wiki',
  })
  assert.deepEqual(accepted.map(node => node.url).sort(), ['https://aiki.wiki', 'https://north.example', 'https://south.example'])

  const saved = []
  const synced = await syncMesh({
    identity: { selfUrl: 'https://north.example', selfName: 'North', hubUrl: 'https://aiki.wiki', allowLoopback: false, role: 'peer' },
    nodes: [],
    fetchImpl: async (url) => String(url).endsWith('/api/mesh/announce') ? jsonResponse({ ok: true }) : jsonResponse(directory),
    save: async (next) => { saved.push(next) },
  })
  assert.equal(synced.ok, true)
  assert.equal(saved[0].some(node => node.url === 'https://south.example'), true)

  const kept = []
  await syncMesh({
    identity: { selfUrl: 'https://aiki.wiki', selfName: 'AiKi', hubUrl: 'https://aiki.wiki', allowLoopback: false, role: 'hub' },
    nodes: [{ url: 'https://aiki.wiki', name: 'AiKi', role: 'hub' }, { url: 'https://north.example', name: 'North', role: 'peer' }],
    fetchImpl: async () => { throw new Error('peer down') },
    save: async (next) => { kept.push(next) },
  })
  assert.equal(kept[0].some(node => node.url === 'https://north.example'), true)

  assert.equal(translate('ru', 'mesh.total', { count: 3 }), 'Узлов в сети: 3')
  assert.equal(translate('ru', 'mesh.directory'), 'Дополнительные узлы находят друг друга через центр.')
  assert.equal(translate('en', 'mesh.roleHub'), 'This node is the central instance.')
  const admin = await readFile(path.join(root, 'app/pages/admin.vue'), 'utf8')
  const doc = await readFile(path.join(root, 'docs/node-mesh.md'), 'utf8')
  assert.match(admin, /data-testid="mesh-panel"/)
  assert.match(admin, /data-testid="mesh-total"/)
  assert.match(admin, /NodeMeshMap/)
  const map = await readFile(path.join(root, 'app/components/NodeMeshMap.vue'), 'utf8')
  assert.match(map, /data-testid="mesh-map"/)
  assert.match(map, /max-w-xs/)
  assert.match(doc, /ActivityPub/)
  assert.match(doc, /https:\/\/aiki\.wiki/)
}
