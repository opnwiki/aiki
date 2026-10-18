const COUNT_FORMATTER = new Intl.NumberFormat('en-US', {
  maximumFractionDigits: 0,
})

export function formatCount(value) {
  const number = Number(value)
  if (!Number.isFinite(number)) return '0'
  return COUNT_FORMATTER.format(Math.trunc(number))
}
