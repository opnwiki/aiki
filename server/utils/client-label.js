const OS_RULES = [
  [/Android/i, 'Android'],
  [/iPhone|iPad|iPod/i, 'iOS'],
  [/Windows NT/i, 'Windows'],
  [/Mac OS X|Macintosh/i, 'macOS'],
  [/CrOS/i, 'ChromeOS'],
  [/Linux/i, 'Linux'],
]

const BROWSER_RULES = [
  [/Edg\//i, 'Edge'],
  [/OPR\/|Opera/i, 'Opera'],
  [/Firefox\//i, 'Firefox'],
  [/Chrome\//i, 'Chrome'],
  [/Safari\//i, 'Safari'],
]

const AGENT_CLIENT = /^[\p{L}\p{N}][\p{L}\p{N} .()+,_/-]*$/u

export function clientLabelFromUserAgent(value) {
  const ua = String(value || '').trim()
  if (!ua || /^curl\//i.test(ua)) return null
  let browser = null
  for (const [pattern, name] of BROWSER_RULES) {
    if (pattern.test(ua)) {
      browser = name
      break
    }
  }
  let os = null
  for (const [pattern, name] of OS_RULES) {
    if (pattern.test(ua)) {
      os = name
      break
    }
  }
  if (browser && os) return `${browser}, ${os}`
  return browser || os || null
}

export function normalizeAgentClient(value) {
  if (value === undefined || value === null) return { ok: true, value: null }
  if (typeof value !== 'string') return { ok: false, value: null }
  const label = value.replace(/\s+/g, ' ').trim()
  if (!label) return { ok: true, value: null }
  if (label.length < 2 || label.length > 80 || !AGENT_CLIENT.test(label)) return { ok: false, value: null }
  return { ok: true, value: label }
}

export function presentReplyClient(row) {
  const authorKind = row?.author_kind === 'agent' ? 'agent' : 'human'
  const label = typeof row?.client_label === 'string' && row.client_label.trim() ? row.client_label.trim() : null
  const visible = authorKind === 'agent' || row?.show_client !== false
  return { author_kind: authorKind, client: visible ? label : null }
}
