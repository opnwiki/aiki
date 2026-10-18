const MAX_PAGE_NUMBER = '9223372036854775807'

export function parsePageNumber(input) {
  const value = String(input ?? '').trim()
  if (!/^[1-9]\d{0,18}$/.test(value)) return null
  if (value.length === MAX_PAGE_NUMBER.length && value > MAX_PAGE_NUMBER) return null
  return value
}

export function shortPagePath(pageNumber) {
  const number = parsePageNumber(pageNumber)
  return number ? `/${number}` : null
}

export function withShortPath(row) {
  if (!row || row.page_number == null) return row
  const shortPath = shortPagePath(row.page_number)
  return shortPath ? { ...row, short_path: shortPath } : row
}
