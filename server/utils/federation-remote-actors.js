import { isActor } from '@fedify/vocab'
import { compressUploadedAvatar } from './avatar.js'
import { assertPublicRemoteOrigin } from './federation-import.js'
import { lookupRemote } from './federation-lookup.js'

// Profiles of Fediverse people who post or reply here: name, @user@server,
// profile link and avatar. The avatar is downloaded once, re-encoded and
// served from /api/federation-actors/<id>/avatar, so readers never load it
// from the remote server (and the remote URL is never published).
const MAX_CACHE_BYTES = 512_000
const MAX_DOWNLOAD_BYTES = 4 * 1024 * 1024
const REFRESH_DAYS = 7
const FETCH_TIMEOUT_MS = 8_000

export function remoteActorAvatarPath(id) {
  return /^[0-9a-f-]{36}$/i.test(String(id || '')) ? `/api/federation-actors/${id}/avatar` : null
}

function urlString(value) {
  if (!value) return null
  if (value instanceof URL) return value.href
  if (value.href instanceof URL) return value.href.href
  return typeof value === 'string' ? value : null
}

export async function readRemoteProfile(actor) {
  const icon = await actor.getIcon?.().catch(() => null)
  const iconUrl = urlString(icon?.url)
  const host = actor.id?.host
  const username = typeof actor.preferredUsername === 'string' ? actor.preferredUsername : null
  return {
    acct: username && host ? `${username}@${host}` : null,
    displayName: String(actor.name || username || '').replace(/\s+/g, ' ').trim().slice(0, 120) || null,
    profileUrl: urlString(actor.url) || actor.id?.href || null,
    iconUrl: iconUrl && /^https:\/\//.test(iconUrl) ? iconUrl : null,
  }
}

async function downloadIcon(url, fetchImpl) {
  await assertPublicRemoteOrigin(new URL(url).origin)
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
  try {
    const response = await fetchImpl(url, { redirect: 'error', signal: controller.signal, headers: { accept: 'image/png,image/jpeg,image/webp,image/*' } })
    if (!response.ok) throw new Error(`Remote avatar returned ${response.status}`)
    if (Number(response.headers.get('content-length') || 0) > MAX_DOWNLOAD_BYTES) throw new Error('Remote avatar is too large')
    const bytes = Buffer.from(await response.arrayBuffer())
    if (bytes.length > MAX_DOWNLOAD_BYTES) throw new Error('Remote avatar is too large')
    return bytes
  } finally {
    clearTimeout(timer)
  }
}

async function cacheAvatar(database, actorId, iconUrl, fetchImpl) {
  try {
    const compressed = await compressUploadedAvatar(await downloadIcon(iconUrl, fetchImpl))
    if (!compressed.ok || compressed.bytes.length > MAX_CACHE_BYTES) throw new Error('Remote avatar is not a usable picture')
    await database.query(
      `INSERT INTO federation_avatar_cache (federation_actor_id, source_uri, bytes, media_type, sha256, state, last_error, fetched_at, expires_at)
       VALUES ($1, $2, $3::bytea, $4, $5, 'ready', NULL, now(), now() + make_interval(days => $6))
       ON CONFLICT (federation_actor_id) DO UPDATE
         SET source_uri = EXCLUDED.source_uri, bytes = EXCLUDED.bytes, media_type = EXCLUDED.media_type,
             sha256 = EXCLUDED.sha256, state = 'ready', last_error = NULL, fetched_at = now(),
             expires_at = EXCLUDED.expires_at, updated_at = now()`,
      [actorId, iconUrl, compressed.bytes, compressed.mediaType, compressed.sha256, REFRESH_DAYS],
    )
  } catch (error) {
    await database.query(
      `INSERT INTO federation_avatar_cache (federation_actor_id, source_uri, state, last_error, fetched_at, expires_at)
       VALUES ($1, $2, 'failed', $3, now(), now() + interval '1 day')
       ON CONFLICT (federation_actor_id) DO UPDATE
         SET state = CASE WHEN federation_avatar_cache.bytes IS NULL THEN 'failed' ELSE federation_avatar_cache.state END,
             last_error = EXCLUDED.last_error, fetched_at = now(), expires_at = EXCLUDED.expires_at, updated_at = now()`,
      [actorId, iconUrl, String(error instanceof Error ? error.message : error).slice(0, 200)],
    ).catch(() => {})
  }
}

export async function refreshRemoteActor(database, context, row, { fetchImpl = fetch } = {}) {
  const actor = await lookupRemote(context, new URL(row.actor_uri))
  if (!isActor(actor) || !actor.id) throw new Error('Remote Fediverse actor is unavailable')
  const profile = await readRemoteProfile(actor)
  await database.query(
    `UPDATE federation_actors
        SET acct = coalesce($2, acct), display_name = coalesce($3, display_name),
            raw_actor = coalesce(raw_actor, '{}'::jsonb) || jsonb_build_object('profileUrl', $4::text),
            last_fetched_at = now(), updated_at = now()
      WHERE id = $1`,
    [row.id, profile.acct, profile.displayName, profile.profileUrl],
  )
  if (profile.iconUrl) await cacheAvatar(database, row.id, profile.iconUrl, fetchImpl)
  return profile
}

// Fills profiles of remote people who wrote a page or reply here and are
// missing data or due for a weekly refresh.
export async function refreshRemoteActors(database, context, { limit = 5 } = {}) {
  const due = await database.query(
    `SELECT actor.id, actor.actor_uri
       FROM federation_actors actor
       LEFT JOIN federation_avatar_cache cache ON cache.federation_actor_id = actor.id
      WHERE actor.is_local = false AND actor.status = 'active'
        AND (EXISTS (SELECT 1 FROM topics WHERE topics.federation_author_id = actor.id)
          OR EXISTS (SELECT 1 FROM replies WHERE replies.federation_author_id = actor.id))
        AND (actor.acct IS NULL
          OR cache.federation_actor_id IS NULL
          OR cache.expires_at < now()
          OR actor.last_fetched_at < now() - interval '7 days')
      ORDER BY actor.last_fetched_at NULLS FIRST
      LIMIT $1`,
    [limit],
  )
  for (const row of due.rows) {
    try {
      await refreshRemoteActor(database, context, row)
    } catch (error) {
      await database.query(`UPDATE federation_actors SET last_fetched_at = now() WHERE id = $1`, [row.id]).catch(() => {})
      await database.query(
        `INSERT INTO federation_avatar_cache (federation_actor_id, source_uri, state, last_error, fetched_at, expires_at)
         VALUES ($1, $2, 'failed', $3, now(), now() + interval '1 day')
         ON CONFLICT (federation_actor_id) DO UPDATE SET last_error = EXCLUDED.last_error, fetched_at = now(), expires_at = EXCLUDED.expires_at, updated_at = now()`,
        [row.id, row.actor_uri, String(error instanceof Error ? error.message : error).slice(0, 200)],
      ).catch(() => {})
    }
  }
  return due.rows.length
}
