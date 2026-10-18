export function paragraphs(text) {
  return String(text || '').replace(/\r\n/g, '\n').split(/\n{2,}/).map(item => item.trim()).filter(Boolean)
}

export function carryHumanEdits(machineText, publishedText, nextMachineText) {
  const machine = paragraphs(machineText)
  const published = paragraphs(publishedText)
  if (!published.length || String(machineText || '') === String(publishedText || '')) return String(nextMachineText || '')
  let result = String(nextMachineText || '')
  const shared = Math.min(machine.length, published.length)
  for (let index = 0; index < shared; index += 1) {
    const from = machine[index]
    const to = published[index]
    if (from && to && from !== to && result.includes(from)) result = result.replace(from, to)
  }
  const extras = published.filter(block => !machine.includes(block))
  for (const block of extras) {
    if (block && !result.includes(block)) result = `${result.trimEnd()}\n\n${block}`
  }
  return result.trim()
}

export function carryTitle(machineTitle, publishedTitle, nextMachineTitle) {
  if (publishedTitle && machineTitle && publishedTitle !== machineTitle && nextMachineTitle === machineTitle) return publishedTitle
  return nextMachineTitle
}
