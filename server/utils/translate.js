import { paragraphs } from './translation-edits.js'

const PROVIDER = 'MyMemory'
const RETRY_DELAYS_MS = [0, 800, 1800]
const MYMEMORY_CONTACT_EMAIL = String(process.env.MYMEMORY_CONTACT_EMAIL || '').trim()

export async function translateDocument({ title, body, summary = null, sourceLocale, targetLocale }) {
  if (sourceLocale === targetLocale) return { title, body, summary, provider: 'identity' }
  const translatedTitle = await translatePiece(title, sourceLocale, targetLocale)
  const translated = await translateMarkdown({ body, sourceLocale, targetLocale })
  const translatedSummary = summary ? await translateMarkdown({ body: summary, sourceLocale, targetLocale }) : { body: null }
  if (!translatedTitle || !translated.body) throw new Error('The translator returned empty text.')
  return { title: translatedTitle, body: translated.body, summary: translatedSummary.body || null, provider: translated.provider }
}

export async function translateMarkdown({ body, sourceLocale, targetLocale }) {
  if (sourceLocale === targetLocale) return { body, provider: 'identity' }
  const translatedBody = await translateBody(body, sourceLocale, targetLocale)
  if (!translatedBody) throw new Error('The translator returned empty text.')
  return { body: translatedBody, provider: PROVIDER }
}

// The translator sees plain text, so it drops or moves Markdown marks: "## Title"
// lost its heading and "**word**" came back as "** word **". Block marks are cut
// off before translation and put back after; emphasis is repaired or removed.
const LINE_PREFIX = /^((?:[ \t]*>[ \t]?)*[ \t]*(?:#{1,6}[ \t]+|[-*+][ \t]+(?:\[[ xX]\][ \t]+)?|\d{1,3}[.)][ \t]+|\[\^[A-Za-z0-9_-]{1,64}\]:[ \t]*)?)/
const STRUCTURED_LINE = /^(?:[ \t]*>|[ \t]*#{1,6}[ \t]|[ \t]*[-*+][ \t]|[ \t]*\d{1,3}[.)][ \t]|\[\^[A-Za-z0-9_-]{1,64}\]:)/

async function translateBody(body, sourceLocale, targetLocale) {
  const pieces = []
  for (const paragraph of paragraphs(body)) {
    if (/^(```|~~~)/.test(paragraph) || /^\|/.test(paragraph) || /^:::/.test(paragraph)) {
      pieces.push(paragraph)
      continue
    }
    const lines = paragraph.split('\n')
    if (lines.some(line => STRUCTURED_LINE.test(line))) {
      const translated = []
      for (const line of lines) translated.push(await translateLine(line, sourceLocale, targetLocale))
      pieces.push(translated.join('\n'))
      continue
    }
    const chunks = splitChunk(paragraph, 420)
    const translated = []
    for (const chunk of chunks) translated.push(await translateText(chunk, sourceLocale, targetLocale))
    pieces.push(translated.join(' '))
  }
  return pieces.join('\n\n')
}

async function translateLine(line, sourceLocale, targetLocale) {
  const prefix = LINE_PREFIX.exec(line)?.[1] || ''
  const text = line.slice(prefix.length)
  if (!text.trim() || /^\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]\s*$/.test(text)) return line
  const parts = splitChunk(text, 420)
  const translated = []
  for (const part of parts) translated.push(await translateText(part, sourceLocale, targetLocale))
  return `${prefix}${translated.join(' ')}`
}

async function translateText(text, sourceLocale, targetLocale) {
  return repairEmphasis(text, await translatePiece(text, sourceLocale, targetLocale))
}

export function repairEmphasis(source, translated) {
  let result = fixMarker(String(source || ''), String(translated || ''), '**')
  result = fixMarker(String(source || '').replaceAll('**', ''), result.replaceAll('**', '\u0000'), '*').replaceAll('\u0000', '**')
  return result
}

// Pairs the marks again when the count survived, trimming spaces inside each
// pair and keeping a space outside. When it did not, the marks are dropped so
// the reader sees plain text instead of stray asterisks.
function fixMarker(source, translated, marker) {
  const wanted = source.split(marker).length - 1
  const parts = translated.split(marker)
  const found = parts.length - 1
  if (!found) return translated
  if (found !== wanted || found % 2) return parts.join('').replace(/[ \t]{2,}/g, ' ').replace(/([(«“]) /g, '$1').replace(/ ([)»”,.;:])/g, '$1')
  return parts.map((part, index) => {
    if (index % 2) return part.trim()
    let value = part
    if (index > 0 && /^[\p{L}\p{N}(«“]/u.test(value)) value = ` ${value}`
    if (index < parts.length - 1 && /[\p{L}\p{N},;:)»”]$/u.test(value)) value = `${value} `
    return value
  }).join(marker)
}

function splitChunk(text, limit) {
  if (text.length <= limit) return [text]
  const sentences = text.split(/(?<=[.!?。])\s+/)
  const chunks = []
  let current = ''
  for (const sentence of sentences) {
    const next = current ? `${current} ${sentence}` : sentence
    if (next.length > limit && current) {
      chunks.push(current)
      current = sentence
    } else {
      current = next
    }
  }
  if (current) chunks.push(current)
  return chunks.length ? chunks : [text.slice(0, limit)]
}

async function translatePiece(text, sourceLocale, targetLocale) {
  let translated = await myMemory(text, sourceLocale, targetLocale)
  if (!keepsNumbers(text, translated)) {
    // Numbers are where fuzzy memory matches go wrong ("Что такое 67?" came
    // back as "What is it?"). Unique placeholders force a real translation.
    const { masked, numbers } = maskNumbers(text)
    const retried = unmaskNumbers(await myMemory(masked, sourceLocale, targetLocale), numbers)
    if (keepsNumbers(text, retried)) translated = retried
  }
  return preserveTokens(text, translated)
}

const NUMBER = /\d+(?:[.,]\d+)*/g

export function keepsNumbers(source, translated) {
  const target = String(translated || '')
  return (String(source || '').match(NUMBER) || []).every(number => target.includes(number))
}

export function maskNumbers(text) {
  const numbers = []
  const masked = String(text || '').replace(NUMBER, (number) => {
    numbers.push(number)
    return `AIKI-NUM-${numbers.length}`
  })
  return { masked, numbers }
}

export function unmaskNumbers(text, numbers) {
  return String(text || '').replace(/AIKI-NUM-(\d+)/g, (token, index) => numbers[Number(index) - 1] ?? token)
}

// MyMemory answers with its best translation-memory hit, which can be a
// different sentence ("Что такое?" for "Что такое 67?"). Only accept a hit
// whose source is our exact text, or its own machine translation.
export function pickMyMemoryTranslation(text, payload) {
  const wanted = normalizeSegment(text)
  const matches = Array.isArray(payload?.matches) ? payload.matches : []
  const exact = matches.find(match => normalizeSegment(match?.segment) === wanted && String(match?.translation || '').trim())
  if (exact) return String(exact.translation).trim()
  const machine = matches.find(match => match?.['created-by'] === 'MT!' && String(match?.translation || '').trim())
  if (machine) return String(machine.translation).trim()
  return String(payload?.responseData?.translatedText || '').trim()
}

function normalizeSegment(value) {
  return String(value || '').replace(/\s+/g, ' ').trim().toLowerCase()
}

async function myMemory(text, sourceLocale, targetLocale) {
  const url = new URL('https://api.mymemory.translated.net/get')
  url.searchParams.set('q', text)
  url.searchParams.set('langpair', `${sourceLocale}|${targetLocale}`)
  if (MYMEMORY_CONTACT_EMAIL) url.searchParams.set('de', MYMEMORY_CONTACT_EMAIL)
  let response
  let lastError
  for (const delay of RETRY_DELAYS_MS) {
    if (delay) await new Promise(resolve => setTimeout(resolve, delay))
    try {
      response = await fetch(url, { signal: AbortSignal.timeout(20_000) })
      if (response.ok && response.status !== 429) break
      lastError = new Error(`Translator responded with ${response.status}.`)
    } catch (error) {
      lastError = error
    }
  }
  if (!response?.ok || response.status === 429) throw lastError || new Error('Translator did not respond.')
  const payload = await response.json()
  const translated = pickMyMemoryTranslation(text, payload)
  if (payload?.responseStatus !== 200 || !translated || /MYMEMORY WARNING|QUERY LENGTH/i.test(translated)) {
    throw new Error(payload?.responseDetails || 'Translator returned no text.')
  }
  return translated
}

function preserveTokens(source, translated) {
  const tokens = String(source || '').match(/AIKI-MARK-\d+/g) || []
  let result = translated
  for (const token of tokens) {
    if (!result.includes(token)) result = `${result} ${token}`.trim()
  }
  return result
}
