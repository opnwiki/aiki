export function createLineDiff(baseText, proposedText, { maxLines = 2_000, maxCells = 1_000_000, context = 3 } = {}) {
  const base = splitLines(baseText)
  const proposed = splitLines(proposedText)
  if (base.length > maxLines || proposed.length > maxLines || base.length * proposed.length > maxCells) {
    return { truncated: true, lines: [], baseLineCount: base.length, proposedLineCount: proposed.length }
  }

  const matrix = Array.from({ length: base.length + 1 }, () => new Uint32Array(proposed.length + 1))
  for (let i = base.length - 1; i >= 0; i -= 1) {
    for (let j = proposed.length - 1; j >= 0; j -= 1) {
      matrix[i][j] = base[i] === proposed[j]
        ? matrix[i + 1][j + 1] + 1
        : Math.max(matrix[i + 1][j], matrix[i][j + 1])
    }
  }

  const raw = []
  let i = 0
  let j = 0
  while (i < base.length && j < proposed.length) {
    if (base[i] === proposed[j]) {
      raw.push({ type: 'context', text: base[i] })
      i += 1
      j += 1
    } else if (matrix[i + 1][j] >= matrix[i][j + 1]) {
      raw.push({ type: 'removed', text: base[i] })
      i += 1
    } else {
      raw.push({ type: 'added', text: proposed[j] })
      j += 1
    }
  }
  while (i < base.length) raw.push({ type: 'removed', text: base[i++] })
  while (j < proposed.length) raw.push({ type: 'added', text: proposed[j++] })

  const changed = raw.map((line, index) => line.type === 'context' ? -1 : index).filter(index => index >= 0)
  if (changed.length === 0) return { truncated: false, lines: [], baseLineCount: base.length, proposedLineCount: proposed.length }

  const visible = new Set()
  for (const index of changed) {
    for (let cursor = Math.max(0, index - context); cursor <= Math.min(raw.length - 1, index + context); cursor += 1) visible.add(cursor)
  }
  const lines = []
  let previous = -2
  for (const index of [...visible].sort((a, b) => a - b)) {
    if (previous >= 0 && index > previous + 1) lines.push({ type: 'gap', text: '…' })
    lines.push(raw[index])
    previous = index
  }
  return { truncated: false, lines, baseLineCount: base.length, proposedLineCount: proposed.length }
}

export function createPatch(baseText, nextText, { maxLines = 2_000, maxCells = 1_000_000 } = {}) {
  const base = splitLines(baseText)
  const next = splitLines(nextText)
  if (base.length > maxLines || next.length > maxLines || base.length * next.length > maxCells) {
    return [
      ...base.map(text => ({ op: 'delete', text })),
      ...next.map(text => ({ op: 'insert', text })),
    ]
  }

  const matrix = Array.from({ length: base.length + 1 }, () => new Uint32Array(next.length + 1))
  for (let i = base.length - 1; i >= 0; i -= 1) {
    for (let j = next.length - 1; j >= 0; j -= 1) {
      matrix[i][j] = base[i] === next[j]
        ? matrix[i + 1][j + 1] + 1
        : Math.max(matrix[i + 1][j], matrix[i][j + 1])
    }
  }

  const ops = []
  let i = 0
  let j = 0
  while (i < base.length && j < next.length) {
    if (base[i] === next[j]) {
      ops.push({ op: 'equal', text: base[i] })
      i += 1
      j += 1
    } else if (matrix[i + 1][j] >= matrix[i][j + 1]) {
      ops.push({ op: 'delete', text: base[i] })
      i += 1
    } else {
      ops.push({ op: 'insert', text: next[j] })
      j += 1
    }
  }
  while (i < base.length) ops.push({ op: 'delete', text: base[i++] })
  while (j < next.length) ops.push({ op: 'insert', text: next[j++] })
  return ops
}

export function applyPatch(baseText, ops) {
  const base = splitLines(baseText)
  const out = []
  let index = 0
  for (const step of ops || []) {
    if (step?.op === 'equal' || step?.op === 'delete') {
      if (base[index] !== step.text) throw new Error('Stored diff does not match the previous text.')
      if (step.op === 'equal') out.push(step.text)
      index += 1
    } else if (step?.op === 'insert') {
      out.push(String(step.text ?? ''))
    } else {
      throw new Error('Stored diff contains an unknown operation.')
    }
  }
  if (index !== base.length) throw new Error('Stored diff does not cover the previous text.')
  return out.join('\n')
}

export function revertPatch(nextText, ops) {
  const next = splitLines(nextText)
  const out = []
  let index = 0
  for (const step of ops || []) {
    if (step?.op === 'equal' || step?.op === 'insert') {
      if (next[index] !== step.text) throw new Error('Stored diff does not match the later text.')
      if (step.op === 'equal') out.push(step.text)
      index += 1
    } else if (step?.op === 'delete') {
      out.push(String(step.text ?? ''))
    } else {
      throw new Error('Stored diff contains an unknown operation.')
    }
  }
  if (index !== next.length) throw new Error('Stored diff does not cover the later text.')
  return out.join('\n')
}

export function displayFromOps(ops, context = 3) {
  const raw = (Array.isArray(ops) ? ops : []).map(step => ({
    type: step?.op === 'insert' ? 'added' : step?.op === 'delete' ? 'removed' : 'context',
    text: String(step?.text ?? ''),
  }))
  const changed = raw.map((line, index) => line.type === 'context' ? -1 : index).filter(index => index >= 0)
  if (changed.length === 0) return { truncated: false, lines: [] }
  const visible = new Set()
  for (const index of changed) {
    for (let cursor = Math.max(0, index - context); cursor <= Math.min(raw.length - 1, index + context); cursor += 1) visible.add(cursor)
  }
  const lines = []
  let previous = -2
  for (const index of [...visible].sort((a, b) => a - b)) {
    if (previous >= 0 && index > previous + 1) lines.push({ type: 'gap', text: '…' })
    lines.push(raw[index])
    previous = index
  }
  return { truncated: false, lines }
}

function splitLines(value) {
  const normalized = String(value ?? '').replace(/\r\n?/g, '\n')
  return normalized === '' ? [] : normalized.split('\n')
}
