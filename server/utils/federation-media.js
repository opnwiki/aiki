import { createHash } from 'node:crypto'
import sharp from 'sharp'
import { assertPublicRemoteOrigin } from './federation-import.js'

// Pictures attached to Fediverse posts. Import used to append them as
// "- [description](https://remote/media.png)" links, and Markdown never loads
// remote images, so readers saw a bare link. They are now shown in the reply,
// downloaded and re-encoded by AIKI first (like remote avatars), so readers
// never contact the remote server.
export const MAX_MEDIA_ITEMS = 8
const MAX_DOWNLOAD_BYTES = 12 * 1024 * 1024
const MAX_DIMENSION = 1600
const FETCH_TIMEOUT_MS = 10_000
const RETRY_FAILED_AFTER_MS = 24 * 60 * 60 * 1000

function httpsUrl(value) {
  const raw = typeof value === 'string' ? value : value?.href || value?.url || ''
  try {
    const url = new URL(String(raw))
    return url.protocol === 'https:' ? url.toString() : null
  } catch {
    return null
  }
}

// Mastodon import keeps `attachments` ({url, type, description}); ActivityPub
// objects carry `attachment` (Document/Image with url, mediaType, name).
export function imageAttachments(rawObject) {
  const raw = rawObject && typeof rawObject === 'object' ? rawObject : {}
  const list = Array.isArray(raw.attachments) ? raw.attachments : Array.isArray(raw.attachment) ? raw.attachment : raw.attachment ? [raw.attachment] : []
  return list.slice(0, MAX_MEDIA_ITEMS).map((item, position) => {
    const url = httpsUrl(Array.isArray(item?.url) ? item.url[0] : item?.url)
    const type = String(item?.type || '').toLowerCase()
    const mediaType = String(item?.mediaType || '').toLowerCase()
    const isImage = type === 'image' || (!['gifv', 'video', 'audio'].includes(type) && mediaType.startsWith('image/'))
    return { position, url, isImage, description: String(item?.description || item?.name || '').replace(/\s+/g, ' ').trim().slice(0, 500) }
  }).filter(item => item.url && item.isImage)
}

export function mediaPath(objectId, position) {
  return /^[0-9a-f-]{36}$/i.test(String(objectId || '')) ? `/api/federation-media/${objectId}/${position}` : null
}

export function presentMedia(objectId, rawObject) {
  return imageAttachments(rawObject)
    .map(item => ({ url: mediaPath(objectId, item.position), description: item.description }))
    .filter(item => item.url)
}

// Drops the "- [text](url)" lines that point at attachments shown as pictures.
export function stripAttachmentLinks(markdown, rawObject) {
  const urls = new Set(imageAttachments(rawObject).map(item => item.url))
  if (!urls.size) return String(markdown || '')
  return String(markdown || '')
    .split('\n')
    .filter((line) => {
      const match = /^\s*[-*]\s+\[[^\]]*\]\((\S+)\)\s*$/.exec(line)
      return !(match && (urls.has(match[1]) || urls.has(httpsUrl(match[1]))))
    })
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

async function download(url, fetchImpl) {
  await assertPublicRemoteOrigin(new URL(url).origin)
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
  try {
    const response = await fetchImpl(url, { redirect: 'error', signal: controller.signal, headers: { accept: 'image/png,image/jpeg,image/webp,image/gif,image/*' } })
    if (!response.ok) throw new Error(`Remote media returned ${response.status}`)
    if (Number(response.headers.get('content-length') || 0) > MAX_DOWNLOAD_BYTES) throw new Error('Remote media is too large')
    const bytes = Buffer.from(await response.arrayBuffer())
    if (bytes.length > MAX_DOWNLOAD_BYTES) throw new Error('Remote media is too large')
    return bytes
  } finally {
    clearTimeout(timer)
  }
}

export async function encodePicture(bytes) {
  const { data, info } = await sharp(bytes, { failOn: 'error', limitInputPixels: 40_000_000, animated: false })
    .rotate()
    .resize({ width: MAX_DIMENSION, height: MAX_DIMENSION, fit: 'inside', withoutEnlargement: true })
    .webp({ quality: 80, effort: 4 })
    .toBuffer({ resolveWithObject: true })
  return { bytes: data, mediaType: 'image/webp', sha256: createHash('sha256').update(data).digest('hex'), width: info.width, height: info.height }
}

// Returns the cached picture, downloading it on first request. A failed
// download is retried after a day.
export async function loadMedia(database, objectId, position, { fetchImpl = fetch } = {}) {
  const object = await database.query(
    `SELECT id, raw_object FROM federation_objects
      WHERE id = $1::uuid AND state = 'active' AND visibility IN ('public', 'unlisted')
        AND (reply_id IS NOT NULL OR topic_id IS NOT NULL)`,
    [objectId],
  )
  const attachment = object.rows[0] ? imageAttachments(object.rows[0].raw_object).find(item => item.position === position) : null
  if (!attachment) return null
  const cached = await database.query(
    `SELECT bytes, media_type, sha256, state, fetched_at, source_uri FROM federation_media_cache
      WHERE federation_object_id = $1::uuid AND position = $2`,
    [objectId, position],
  )
  const row = cached.rows[0]
  if (row?.state === 'ready' && row.bytes && row.source_uri === attachment.url) return row
  if (row?.state === 'failed' && row.source_uri === attachment.url && Date.now() - new Date(row.fetched_at).getTime() < RETRY_FAILED_AFTER_MS) return null
  try {
    const picture = await encodePicture(await download(attachment.url, fetchImpl))
    await database.query(
      `INSERT INTO federation_media_cache (federation_object_id, position, source_uri, bytes, media_type, sha256, width, height, state, last_error, fetched_at)
       VALUES ($1, $2, $3, $4::bytea, $5, $6, $7, $8, 'ready', NULL, now())
       ON CONFLICT (federation_object_id, position) DO UPDATE
         SET source_uri = EXCLUDED.source_uri, bytes = EXCLUDED.bytes, media_type = EXCLUDED.media_type, sha256 = EXCLUDED.sha256,
             width = EXCLUDED.width, height = EXCLUDED.height, state = 'ready', last_error = NULL, fetched_at = now(), updated_at = now()`,
      [objectId, position, attachment.url, picture.bytes, picture.mediaType, picture.sha256, picture.width, picture.height],
    )
    return { bytes: picture.bytes, media_type: picture.mediaType, sha256: picture.sha256 }
  } catch (error) {
    await database.query(
      `INSERT INTO federation_media_cache (federation_object_id, position, source_uri, state, last_error, fetched_at)
       VALUES ($1, $2, $3, 'failed', $4, now())
       ON CONFLICT (federation_object_id, position) DO UPDATE
         SET source_uri = EXCLUDED.source_uri, bytes = NULL, media_type = NULL, sha256 = NULL, state = 'failed',
             last_error = EXCLUDED.last_error, fetched_at = now(), updated_at = now()`,
      [objectId, position, attachment.url, String(error instanceof Error ? error.message : error).slice(0, 200)],
    ).catch(() => {})
    return null
  }
}
