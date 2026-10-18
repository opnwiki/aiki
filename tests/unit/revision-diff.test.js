import { readFileSync } from 'node:fs'
import { applyPatch, createLineDiff, createPatch, revertPatch } from '../../server/utils/revision-diff.js'

export function run({ assert }) {
  const changed = createLineDiff('one\nold\nthree', 'one\nnew\nthree')
  assert.equal(changed.truncated, false)
  assert.deepEqual(changed.lines.map(line => line.type), ['context', 'removed', 'added', 'context'])
  assert.deepEqual(changed.lines.map(line => line.text), ['one', 'old', 'new', 'three'])
  assert.deepEqual(createLineDiff('same', 'same').lines, [])

  const sparse = createLineDiff('a\nb\nc\nd\ne\nf\ng\nh\ni', 'a\nb\nC\nd\ne\nf\ng\nh\nI', { context: 1 })
  assert.equal(sparse.lines.filter(line => line.type === 'gap').length, 1)
  assert.deepEqual(sparse.lines.filter(line => line.type !== 'gap').map(line => line.type), [
    'context', 'removed', 'added', 'context', 'context', 'removed', 'added',
  ])

  const tooLarge = createLineDiff('a\nb\nc', 'x\ny\nz', { maxLines: 2 })
  assert.equal(tooLarge.truncated, true)
  assert.equal(tooLarge.lines.length, 0)
  assert.equal(tooLarge.baseLineCount, 3)
  assert.equal(tooLarge.proposedLineCount, 3)
  const tooManyCells = createLineDiff('a\nb\nc\nd', 'a\nb\nc\nd', { maxCells: 8 })
  assert.equal(tooManyCells.truncated, true)

  const base = 'one\nold line\nthree'
  const next = 'one\nnew line\nthree\nfour'
  const patch = createPatch(base, next)
  assert.equal(applyPatch(base, patch), next)
  assert.equal(revertPatch(next, patch), base)
  assert.equal(applyPatch('', createPatch('', 'Компьютер')), 'Компьютер')
  assert.equal(revertPatch('Компьютер', createPatch('', 'Компьютер')), '')

  const replaced = createPatch('alpha\nbeta\ngamma', 'ONE\nTWO', { maxLines: 2 })
  assert.equal(applyPatch('alpha\nbeta\ngamma', replaced), 'ONE\nTWO')
  assert.equal(revertPatch('ONE\nTWO', replaced), 'alpha\nbeta\ngamma')
  assert.throws(() => applyPatch('different', patch), /previous text/)

  const history = readFileSync(new URL('../../app/components/RevisionHistoryPanel.vue', import.meta.url), 'utf8')
  const revisionPage = readFileSync(new URL('../../app/pages/[slug]/revisions/[revisionId].vue', import.meta.url), 'utf8')
  for (const source of [history, revisionPage]) {
    assert.match(source, /data-testid="revision-change"/)
    assert.match(source, /data-testid="revision-introduced"/)
    assert.match(source, /data-testid="revision-confirmed"/)
    assert.match(source, /data-testid="revision-diff"/)
  }
  assert.match(history, /role="dialog" aria-modal="true"/)
  assert.match(history, /backdrop-blur-sm/)
  assert.match(history, /event\.key === 'Escape'/)
  assert.match(history, /\.reverse\(\)/)
  assert.match(history, /<slot \/>/)
  assert.match(history, /t\('topics\.previous'\)/)
  assert.match(history, /t\('topics\.next'\)/)
  assert.doesNotMatch(history, /t\('topic\.(previous|next)'\)/)
}
