import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { articleFingerprint, groupSearchHits, normalizeArticleText } from '../../server/utils/article-identity.js'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')

export async function run({ assert }) {
  assert.equal(normalizeArticleText(' Маяк \r\n'), 'Маяк')
  const left = articleFingerprint('Маяк', 'Установка\n')
  const right = articleFingerprint('Маяк', 'Установка')
  assert.equal(left, right)
  assert.equal(left.length, 64)
  assert.notEqual(articleFingerprint('Маяк', 'Установка'), articleFingerprint('Маяк', 'Установка. Тёмная тема.'))

  const sameText = groupSearchHits([
    { nodeUrl: 'https://north.example', canonicalPath: '/ustanovka', pageNumber: '4', title: 'Установка', fingerprint: left, revisedAt: '2026-10-01T00:00:00.000Z' },
    { nodeUrl: 'https://south.example', canonicalPath: '/setup', pageNumber: '9', title: 'Установка', fingerprint: left, revisedAt: '2026-10-03T00:00:00.000Z' },
  ])
  assert.equal(sameText.length, 1)
  assert.equal(sameText[0].sameText, true)
  assert.equal(sameText[0].newerElsewhere, false)
  assert.equal(sameText[0].copies.length, 2)
  assert.deepEqual(sameText[0].copies.map(item => item.pageNumber).sort(), ['4', '9'])

  const independent = groupSearchHits([
    { nodeUrl: 'https://north.example', canonicalPath: '/a', pageNumber: '1', title: 'Север', fingerprint: articleFingerprint('Север', 'А'), revisedAt: '2026-10-02T00:00:00.000Z' },
    { nodeUrl: 'https://south.example', canonicalPath: '/b', pageNumber: '1', title: 'Юг', fingerprint: articleFingerprint('Юг', 'Б'), revisedAt: '2026-10-02T00:00:00.000Z' },
  ])
  assert.equal(independent.length, 2)

  const older = articleFingerprint('Маяк', 'Старый текст')
  const newer = articleFingerprint('Маяк', 'Новый текст')
  const diverged = groupSearchHits([
    { nodeUrl: 'https://south.example', canonicalPath: '/ustanovka', pageNumber: '2', title: 'Установка', workKey: 'work-mayak', fingerprint: newer, revisedAt: '2026-10-03T00:00:00.000Z' },
    { nodeUrl: 'https://north.example', canonicalPath: '/ustanovka', pageNumber: '8', title: 'Установка', workKey: 'work-mayak', fingerprint: older, revisedAt: '2026-10-01T00:00:00.000Z' },
  ])
  assert.equal(diverged.length, 1)
  assert.equal(diverged[0].newerElsewhere, true)
  assert.equal(diverged[0].lead.nodeUrl, 'https://south.example')
  assert.equal(diverged[0].lead.fingerprint, newer)
  assert.equal(diverged[0].copies[1].fingerprint, older)

  const doc = await readFile(path.join(root, 'docs/cross-node-search.md'), 'utf8')
  for (const marker of ['SHA-256', 'work', '/n/', 'GET /api/mesh', 'groupSearchHits', 'aiki.wiki']) {
    assert.ok(doc.includes(marker), marker)
  }
  const mesh = await readFile(path.join(root, 'docs/node-mesh.md'), 'utf8')
  assert.ok(mesh.includes('cross-node-search.md'))
  const examples = await readFile(path.join(root, 'docs/use-cases.md'), 'utf8')
  assert.ok(examples.includes('cross-node-search.md'))
}
