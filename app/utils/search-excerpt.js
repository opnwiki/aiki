const DEFAULT_LIMIT = 140

export function searchExcerpt(markdown, limit = DEFAULT_LIMIT) {
  const size = Number.isFinite(limit) ? Math.min(Math.max(limit, 40), 180) : DEFAULT_LIMIT
  const text = String(markdown || '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/[#>*_`[\]()!-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  if (!text) return ''
  if (text.length <= size) return text
  const cut = text.slice(0, size)
  const space = cut.lastIndexOf(' ')
  const base = space > Math.floor(size * 0.6) ? cut.slice(0, space) : cut
  return `${base.trimEnd()}…`
}
