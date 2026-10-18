import { siteOrigin } from './sitemaps.js'

const INDEXNOW_ENDPOINT = 'https://api.indexnow.org/indexnow'
const INDEXNOW_KEY_PATTERN = /^[A-Za-z0-9-]{8,128}$/

// IndexNow keys are intentionally published as a verification file. They are
// not application credentials; the file proves control of the host for URL
// notifications. Each node sets its own INDEXNOW_KEY; without one IndexNow is off.
export function indexNowKey(value = process.env.INDEXNOW_KEY) {
  const key = String(value || '').trim()
  return INDEXNOW_KEY_PATTERN.test(key) ? key : ''
}

// Returns the key when the request path is this node's verification file.
export function indexNowKeyFile(path, value = process.env.INDEXNOW_KEY) {
  const key = indexNowKey(value)
  return key && path === `/${key}.txt` ? key : ''
}

export async function notifyIndexNow({ siteUrl, paths = [] } = {}) {
  const key = indexNowKey()
  const origin = siteOrigin(siteUrl)
  const urls = [...new Set((Array.isArray(paths) ? paths : [])
    .map(path => String(path || '').trim())
    .filter(Boolean)
    .map(path => new URL(path.startsWith('/') ? path : `/${path}`, `${origin}/`).toString()))]
  if (!key || !urls.length) return { submitted: false, reason: 'empty' }

  try {
    const response = await fetch(INDEXNOW_ENDPOINT, {
      method: 'POST',
      headers: { 'content-type': 'application/json; charset=utf-8' },
      body: JSON.stringify({
        host: new URL(origin).hostname,
        key,
        keyLocation: `${origin}/${key}.txt`,
        urlList: urls.slice(0, 10_000),
      }),
    })
    if (!response.ok) {
      console.warn(`[indexnow] submission returned ${response.status}`)
      return { submitted: false, status: response.status }
    }
    return { submitted: true, count: urls.length }
  } catch (error) {
    console.warn(`[indexnow] submission failed: ${error?.message || 'unknown error'}`)
    return { submitted: false, reason: 'network' }
  }
}
