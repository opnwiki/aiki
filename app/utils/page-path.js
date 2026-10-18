export function pagePath(item) {
  const number = item?.page_number
  if (number != null && /^[1-9]\d{0,18}$/.test(String(number))) return `/${number}`
  if (item?.slug) return `/${encodeURIComponent(item.slug)}`
  return '/'
}
