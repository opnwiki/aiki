import { createHash } from 'node:crypto'

export function normalizeArticleText(value) {
  return String(value ?? '')
    .replace(/\r\n?/g, '\n')
    .normalize('NFC')
    .split('\n')
    .map(line => line.replace(/[ \t]+$/g, ''))
    .join('\n')
    .trim()
}

export function articleFingerprint(title, body) {
  const text = `${normalizeArticleText(title)}\n\n${normalizeArticleText(body)}`
  return createHash('sha256').update(text, 'utf8').digest('hex')
}

function revisedAt(value) {
  const time = Date.parse(value || '')
  return Number.isFinite(time) ? time : 0
}

function groupKey(hit) {
  if (hit?.workKey) return `work:${hit.workKey}`
  if (hit?.fingerprint) return `text:${hit.fingerprint}`
  return `alone:${hit?.nodeUrl || ''}:${hit?.canonicalPath || ''}`
}

export function groupSearchHits(hits) {
  const groups = new Map()
  for (const hit of hits || []) {
    const key = groupKey(hit)
    const list = groups.get(key)
    if (list) list.push(hit)
    else groups.set(key, [hit])
  }
  return [...groups.values()].map(presentGroup)
}

function presentGroup(copies) {
  const sorted = [...copies].sort((left, right) => {
    const byTime = revisedAt(right.revisedAt) - revisedAt(left.revisedAt)
    if (byTime !== 0) return byTime
    return String(left.nodeUrl || '').localeCompare(String(right.nodeUrl || ''))
  })
  const lead = sorted[0]
  const fingerprints = new Set(sorted.map(item => item.fingerprint).filter(Boolean))
  const sameText = fingerprints.size <= 1
  return {
    title: lead.title,
    workKey: lead.workKey || null,
    fingerprint: lead.fingerprint || null,
    sameText,
    newerElsewhere: !sameText && sorted.length > 1,
    lead,
    copies: sorted,
  }
}
