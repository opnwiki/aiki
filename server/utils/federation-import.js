import { createHash, randomUUID } from 'node:crypto'
import dns from 'node:dns/promises'
import net from 'node:net'
import sanitizeHtml from 'sanitize-html'
import { htmlToPlainText, shortTitle, stripLeadingMentions } from './fediverse-text.js'

const DEFAULT_TIMEOUT_MS = 10_000
const MAX_JSON_BYTES = 2 * 1024 * 1024
const MAX_ITEMS = 1000

export function parseMastodonStatusUrl(input) {
  let parsed
  try { parsed = new URL(String(input || '').trim()) } catch { return { ok: false, message: 'Use a public Mastodon status URL.' } }
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.port) {
    return { ok: false, message: 'The source must be an HTTPS Mastodon URL.' }
  }
  if (isPrivateHost(parsed.hostname)) return { ok: false, message: 'Private or local source hosts are not allowed.' }
  const match = parsed.pathname.match(/^\/@[^/]+\/(\d+)(?:\/.*)?$/) || parsed.pathname.match(/^\/users\/[^/]+\/statuses\/(\d+)(?:\/.*)?$/)
  if (!match) return { ok: false, message: 'Use a Mastodon status URL such as https://mastodon.social/@user/123.' }
  parsed.hash = ''
  parsed.search = ''
  return { ok: true, value: { url: parsed.toString(), origin: parsed.origin, id: match[1] } }
}

// Any public HTTPS post address (Mastodon, Misskey, Pleroma, GoToSocial…);
// the thread is then read through Mastodon's API or ActivityPub.
export function parseFediversePostUrl(input) {
  let parsed
  try { parsed = new URL(String(input || '').trim()) } catch { return { ok: false, message: 'Use a public Fediverse post URL.' } }
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.port) {
    return { ok: false, message: 'The source must be an HTTPS post URL.' }
  }
  if (isPrivateHost(parsed.hostname)) return { ok: false, message: 'Private or local source hosts are not allowed.' }
  if (parsed.pathname === '/' || !parsed.pathname) return { ok: false, message: 'Use the address of one post, not of a server.' }
  parsed.hash = ''
  const mastodon = parseMastodonStatusUrl(parsed.toString())
  return { ok: true, value: mastodon.ok ? mastodon.value : { url: parsed.toString(), origin: parsed.origin, id: null } }
}

// Mastodon addresses are read through its API (it lists the whole thread at
// once); other servers, and Mastodon servers that close the API to visitors,
// through ActivityPub.
export async function fetchFediverseThread(url, { fetchImpl = globalThis.fetch, fetchActivityPub = null, ...options } = {}) {
  let mastodonError = null
  if (parseMastodonStatusUrl(url).ok) {
    try { return await fetchMastodonThread(url, { fetchImpl, ...options }) } catch (error) { mastodonError = error }
  }
  const readActivityPub = fetchActivityPub || (fetchImpl === globalThis.fetch ? (await import('./federation-browse.js')).fetchActivityPubThread : null)
  if (!readActivityPub) throw mastodonError || new Error('Only Mastodon addresses can be read here.')
  try {
    return await readActivityPub(url, options)
  } catch (error) {
    throw mastodonError || error
  }
}

export async function fetchMastodonThread(inputUrl, { fetchImpl = globalThis.fetch, timeoutMs = DEFAULT_TIMEOUT_MS, maxItems = MAX_ITEMS, fromOrigin = false } = {}) {
  const parsed = parseMastodonStatusUrl(inputUrl)
  if (!parsed.ok) throw new Error(parsed.message)
  if (fetchImpl === globalThis.fetch) await assertPublicRemoteOrigin(parsed.value.origin)
  const root = await mastodonJson(`${parsed.value.origin}/api/v1/statuses/${parsed.value.id}`, { fetchImpl, timeoutMs })
  const context = await mastodonJson(`${parsed.value.origin}/api/v1/statuses/${parsed.value.id}/context`, { fetchImpl, timeoutMs })
  // Mastodon lists only the requested post's own descendants. When it is
  // inside a thread, read the context of the thread's first post too, so a
  // request from any branch brings the whole tree.
  const ancestors = Array.isArray(context.ancestors) ? context.ancestors : []
  const threadStart = ancestors[0]
  // A server only knows the replies that reached it. When the thread starts
  // on another server, read it there: the first post's server has the replies.
  const startUrl = threadStart ? [threadStart.url, threadStart.uri].find(url => parseMastodonStatusUrl(url).ok) : null
  if (!fromOrigin && startUrl && new URL(startUrl).origin !== parsed.value.origin) {
    try {
      const fromStart = await fetchMastodonThread(startUrl, { fetchImpl, timeoutMs, maxItems, fromOrigin: true })
      if (fromStart.items.length) return { ...fromStart, requestedUrl: parsed.value.url }
    } catch {}
  }
  const startContext = threadStart?.id
    ? await mastodonJson(`${parsed.value.origin}/api/v1/statuses/${threadStart.id}/context`, { fetchImpl, timeoutMs }).catch(() => null)
    : null
  const seen = new Set()
  const statuses = [
    ...ancestors,
    root,
    ...(Array.isArray(context.descendants) ? context.descendants : []),
    ...(Array.isArray(startContext?.descendants) ? startContext.descendants : []),
  ]
    .filter(Boolean)
    .filter(status => {
      const id = String(status.id || status.uri || status.url || '')
      if (!id || seen.has(id)) return false
      seen.add(id)
      return ['public', 'unlisted'].includes(status.visibility)
    })
    .slice(0, maxItems)
  const byId = new Map(statuses.map(status => [String(status.id), status]))
  const items = statuses.map(status => normalizeMastodonStatus(status, byId))
  const requested = items.find(item => item.id === String(root.id)) || items[0] || null
  const threadRoot = items.find(item => item.visibility === 'public') || items[0] || null
  return {
    requestedUrl: parsed.value.url,
    origin: parsed.value.origin,
    root: threadRoot,
    requested,
    items,
    observed: { total: statuses.length, public: items.filter(item => item.visibility === 'public').length },
  }
}

export async function importMastodonThread(database, { nodeId, actorId, url, fetchImpl, fetchActivityPub, now = new Date(), forceSync = false } = {}) {
  if (!nodeId) throw new Error('A node is required for a federation import.')
  const thread = await fetchFediverseThread(url, { fetchImpl, fetchActivityPub })
  if (!thread.root || thread.root.visibility !== 'public') throw new Error('The source status is not public or could not be read.')
  const client = await database.connect()
  try {
    await client.query('BEGIN')
    const existing = await client.query(
      // The same thread may be requested from any of its posts: match its root too.
      `SELECT id, topic_id, status, total_seen, public_imported, skipped FROM federation_imports
       WHERE node_id = $1 AND (requested_url = $2 OR canonical_root_uri = $3)
       ORDER BY (topic_id IS NOT NULL) DESC, created_at
       LIMIT 1 FOR UPDATE`,
      [nodeId, thread.requestedUrl, thread.root.objectUri],
    )
    if (!forceSync && existing.rows[0]?.topic_id && ['complete', 'partial'].includes(existing.rows[0].status)) {
      await client.query('COMMIT')
      return { import: existing.rows[0], topicId: existing.rows[0].topic_id, reused: true }
    }
    const importRow = existing.rows[0] || (await client.query(
      `INSERT INTO federation_imports (node_id, requested_url, canonical_root_uri, created_by, status, started_at)
       VALUES ($1, $2, $3, $4, 'running', $5) RETURNING *`,
      [nodeId, thread.requestedUrl, thread.root.objectUri, actorId || null, now],
    )).rows[0]
    if (existing.rows[0]) {
      await client.query(
        `UPDATE federation_imports SET canonical_root_uri = $2, status = 'running', started_at = $3,
         last_error = NULL, updated_at = now() WHERE id = $1`,
        [importRow.id, thread.root.objectUri, now],
      )
    }

    let topicId = importRow.topic_id
    if (!topicId) {
      // The thread's first post may already be a page here (e.g. a question
      // from an @ask mention); the thread is added to it.
      const rootPage = await client.query(
        `SELECT object.topic_id FROM federation_objects object
           JOIN topics topic ON topic.id = object.topic_id AND topic.status = 'published'
          WHERE object.object_uri = $1 AND object.state = 'active' LIMIT 1`,
        [thread.root.objectUri],
      )
      if (rootPage.rows[0]) {
        topicId = rootPage.rows[0].topic_id
        await client.query('UPDATE topics SET federation_import_id = $2 WHERE id = $1 AND federation_import_id IS NULL', [topicId, importRow.id])
      }
    }
    if (!topicId) {
      const slug = await uniqueImportedSlug(client, `fediverse-${shortHash(thread.root.objectUri)}`)
      const title = titleForImportedStatus(thread.root)
      const topic = await client.query(
        `INSERT INTO topics (node_id, author_id, slug, kind, status, summary, hide_author, federation_import_id)
         VALUES ($1, NULL, $2, 'discussion', 'published', $3, NULL, $4) RETURNING id`,
        [nodeId, slug, null, importRow.id],
      )
      topicId = topic.rows[0].id
      const revision = await client.query(
        `INSERT INTO revisions (topic_id, author_id, locale, title, body_markdown, summary)
         VALUES ($1, NULL, 'en', $2, $3, $4) RETURNING id`,
        [topicId, title, `${thread.root.body}\n\nSource: ${thread.root.url}`, null],
      )
      await client.query('INSERT INTO topic_current_revisions (topic_id, locale, revision_id) VALUES ($1, \'en\', $2)', [topicId, revision.rows[0].id])
      await client.query('INSERT INTO page_read_counts (topic_id) VALUES ($1) ON CONFLICT DO NOTHING', [topicId])
    }
    else {
      // The imported first post is refreshed (new revision) when its text or
      // title changed, as long as nobody edited the page here.
      const current = await client.query(
        `SELECT revision.id, revision.title, revision.body_markdown, revision.author_id, revision.summary
           FROM topic_current_revisions current
           JOIN revisions revision ON revision.id = current.revision_id
          WHERE current.topic_id = $1 AND current.locale = 'en'`,
        [topicId],
      )
      const row = current.rows[0]
      const title = titleForImportedStatus(thread.root)
      const body = `${thread.root.body}\n\nSource: ${thread.root.url}`
      // revision.summary is the page overview: keep a real one, drop placeholders.
      const placeholder = /^(Imported public Fediverse thread|Refreshed from the Fediverse thread)/.test(row?.summary || '')
      if (row && row.author_id === null && (row.title !== title || row.body_markdown !== body || placeholder)) {
        const next = await client.query(
          `INSERT INTO revisions (topic_id, author_id, locale, title, body_markdown, summary, parent_revision_id)
           VALUES ($1, NULL, 'en', $2, $3, $4, $5) RETURNING id`,
          [topicId, title, body, placeholder ? null : row.summary, row.id],
        )
        await client.query(`UPDATE topic_current_revisions SET revision_id = $2 WHERE topic_id = $1 AND locale = 'en'`, [topicId, next.rows[0].id])
      }
    }

    const objectIds = new Map()
    let imported = 0
    let skipped = 0
    for (const item of thread.items) {
      if (item.visibility !== 'public') { skipped += 1; continue }
      // Our own posts (replies written here, @ask answers) come back in the
      // remote thread: keep them as parents for the branch, never import them
      // as someone else's replies or take over their objects.
      if (isOwnObject(item.objectUri)) {
        const own = await client.query('SELECT id FROM federation_objects WHERE object_uri = $1', [item.objectUri])
        if (own.rows[0]) objectIds.set(item.objectUri, own.rows[0].id)
        continue
      }
      // A reply that only mentions accounts (such as the @ask request itself) adds nothing.
      if (item !== thread.root && !String(item.body || '').replace(/(^|\s)@[\w.-]+(?:@[\w.-]+\.[a-z]{2,})?/giu, ' ').trim()) continue
      const actor = await upsertRemoteActor(client, item)
      const parentObjectId = item.parentObjectUri ? objectIds.get(item.parentObjectUri) : null
      const existingObject = await client.query('SELECT id, reply_id FROM federation_objects WHERE object_uri = $1', [item.objectUri])
      let objectId = existingObject.rows[0]?.id || null
      let replyId = existingObject.rows[0]?.reply_id || null
      if (!replyId && item !== thread.root) {
        const reply = await client.query(
          `INSERT INTO replies (topic_id, parent_reply_id, author_id, federation_author_id, locale, body_markdown, status, federation_object_uri, federation_source_url)
           VALUES ($1, $2, NULL, $3, 'en', $4, 'published', $5, $6)
           RETURNING id`,
          [topicId, parentObjectId ? await replyIdForObject(client, parentObjectId) : null, actor.id, item.body, item.objectUri, item.url],
        )
        replyId = reply.rows[0]?.id || null
      }
      if (!objectId) {
        const object = await client.query(
          `INSERT INTO federation_objects (object_uri, actor_id, object_type, topic_id, reply_id, in_reply_to_object_id, in_reply_to_uri, visibility, content_hash, published_at, raw_object)
           VALUES ($1, $2, 'note', $3, $4, $5, $6, $7, $8, $9, $10::jsonb) RETURNING id`,
          [item.objectUri, actor.id, item === thread.root ? topicId : null, item === thread.root ? null : replyId, parentObjectId, item.parentObjectUri, item.visibility, item.contentHash, item.publishedAt, JSON.stringify(item.raw)],
        )
        objectId = object.rows[0].id
      } else {
        await client.query(
          `UPDATE federation_objects SET actor_id = $2, in_reply_to_object_id = $3, in_reply_to_uri = $4,
           content_hash = $5, raw_object = $6::jsonb, updated_at = now() WHERE id = $1`,
          [objectId, actor.id, parentObjectId, item.parentObjectUri, item.contentHash, JSON.stringify(item.raw)],
        )
        if (replyId) {
          const changed = await client.query(
            // Re-reading the thread is not an edit: keep updated_at, write only changes.
            `UPDATE replies
                SET body_markdown = $2, federation_source_url = $3
              WHERE id = $1 AND status = 'published'
                AND body_markdown IS DISTINCT FROM $2
              RETURNING id`,
            [replyId, item.body, item.url],
          )
          // A changed text needs a new translation.
          if (changed.rowCount) await client.query('DELETE FROM reply_translations WHERE reply_id = $1', [replyId])
          else await client.query(
            `UPDATE replies SET federation_source_url = $2 WHERE id = $1 AND federation_source_url IS DISTINCT FROM $2`,
            [replyId, item.url],
          )
        }
      }
      objectIds.set(item.objectUri, objectId)
      if (item === thread.root) {
        await client.query('UPDATE topics SET federation_author_id = $2 WHERE id = $1', [topicId, actor.id])
      }
      await client.query(
        `INSERT INTO federation_import_items (import_id, object_uri, activity_uri, actor_uri, parent_object_uri, topic_id, reply_id, visibility, content_hash, remote_published_at, raw_object)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb)
         ON CONFLICT (import_id, object_uri) DO UPDATE SET reply_id = EXCLUDED.reply_id, parent_object_uri = EXCLUDED.parent_object_uri, raw_object = EXCLUDED.raw_object, updated_at = now()`,
        [importRow.id, item.objectUri, item.activityUri, item.actorUri, item.parentObjectUri, item === thread.root ? topicId : null, item === thread.root ? null : replyId, item.visibility, item.contentHash, item.publishedAt, JSON.stringify(item.raw)],
      )
      imported += 1
    }
    const status = skipped > 0 ? 'partial' : 'complete'
    const updated = await client.query(
      `UPDATE federation_imports SET topic_id = $2, status = $3, total_seen = $4, public_imported = $5,
       skipped = $6, completed_at = $7, last_synced_at = $7, updated_at = now() WHERE id = $1 RETURNING *`,
      [importRow.id, topicId, status, thread.observed.total, imported, skipped, now],
    )
    await client.query('COMMIT')
    return { import: updated.rows[0], topicId, reused: false }
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
}

export async function syncDueMastodonImports(database, { limit = 10, now = new Date() } = {}) {
  const due = await database.query(
    `SELECT imports.id, imports.node_id, imports.requested_url
       FROM federation_imports imports
       JOIN nodes node ON node.id = imports.node_id
      WHERE imports.status IN ('complete', 'partial')
        AND node.federation_enabled = true
        AND node.federation_mode IN ('open', 'inbound_only')
        -- A thread @ask joined keeps coming in: every 5 minutes while people are
        -- talking, every 30 minutes for two days, daily up to a month, then not
        -- at all after a month of silence
        -- (a new @ask mention starts it again).
        AND (imports.last_synced_at IS NULL OR imports.last_synced_at < now() - (
          SELECT CASE
                   WHEN activity.last_at > now() - interval '2 hours' THEN interval '5 minutes'
                   WHEN activity.last_at > now() - interval '2 days' THEN interval '30 minutes'
                   WHEN activity.last_at > now() - interval '30 days' THEN interval '1 day'
                   ELSE interval '100 years'
                 END
            FROM (SELECT greatest(
                    imports.created_at,
                    coalesce((SELECT max(reply.created_at) FROM replies reply WHERE reply.topic_id = imports.topic_id AND reply.status = 'published'), imports.created_at)
                  ) AS last_at) activity
        ))
      ORDER BY imports.last_synced_at NULLS FIRST, imports.updated_at
      LIMIT $1`,
    [Math.min(Math.max(Number(limit) || 1, 1), 20)],
  )
  const results = []
  for (const row of due.rows) {
    try {
      const result = await importMastodonThread(database, { nodeId: row.node_id, url: row.requested_url, now, forceSync: true })
      results.push({ id: row.id, ok: true, topicId: result.topicId })
    } catch (error) {
      await database.query(
        `UPDATE federation_imports
            SET status = CASE WHEN topic_id IS NULL THEN 'failed' ELSE 'partial' END,
                last_error = $2, updated_at = now()
          WHERE id = $1`,
        [row.id, String(error?.message || error).slice(0, 1000)],
      )
      results.push({ id: row.id, ok: false, error: String(error?.message || error).slice(0, 1000) })
    }
  }
  return results
}

export function startFederationImportSync(database, { intervalMs = 300_000 } = {}) {
  let running = false
  const tick = async () => {
    if (running) return
    running = true
    try { await syncDueMastodonImports(database) } catch (error) { console.error('[fedify] import sync failed', error) } finally { running = false }
  }
  const timer = setInterval(tick, intervalMs)
  timer.unref?.()
  void tick()
  return () => clearInterval(timer)
}

export async function mastodonJson(url, { fetchImpl, timeoutMs }) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetchImpl(url, { headers: { accept: 'application/json' }, signal: controller.signal, redirect: 'error' })
    if (!response.ok) throw new Error(`Remote Mastodon request failed (${response.status}).`)
    const text = await response.text()
    if (Buffer.byteLength(text, 'utf8') > MAX_JSON_BYTES) throw new Error('Remote Mastodon response is too large.')
    try { return JSON.parse(text) } catch { throw new Error('Remote Mastodon returned invalid JSON.') }
  } finally { clearTimeout(timer) }
}

function normalizeMastodonStatus(status, byId) {
  const attachments = normalizeAttachments(status.media_attachments)
  const text = htmlToText(status.content)
  // Replies start with Mastodon's automatic mentions of the branch; drop them.
  const body = appendAttachments(status.in_reply_to_id ? stripLeadingMentions(text) : text, attachments)
  const objectUri = String(status.uri || status.url || '')
  return {
    id: String(status.id || ''),
    objectUri,
    activityUri: null,
    url: String(status.url || objectUri),
    // The ActivityPub id (uri), not the HTML profile page (url): not every
    // server answers ActivityPub requests on the profile page.
    actorUri: String(status.account?.uri || status.account?.url || ''),
    actorDisplayName: String(status.account?.display_name || status.account?.username || 'remote author'),
    actorHandle: status.account?.acct ? String(status.account.acct) : null,
    body,
    visibility: status.visibility === 'public' ? 'public' : String(status.visibility || 'unknown'),
    parentObjectUri: byId.has(String(status.in_reply_to_id)) ? String(byId.get(String(status.in_reply_to_id)).uri || byId.get(String(status.in_reply_to_id)).url) : null,
    publishedAt: status.created_at ? new Date(status.created_at) : null,
    contentHash: shortHash(`${objectUri}\n${body}`),
    attachments,
    raw: { id: status.id, uri: status.uri, url: status.url, visibility: status.visibility, in_reply_to_id: status.in_reply_to_id, created_at: status.created_at, account: { id: status.account?.id, url: status.account?.url, acct: status.account?.acct, display_name: status.account?.display_name }, attachments },
  }
}

async function upsertRemoteActor(client, item) {
  const uri = item.actorUri || `https://invalid.invalid/actors/${shortHash(item.actorHandle || item.objectUri)}`
  const domain = (() => { try { return new URL(uri).hostname } catch { return null } })()
  const result = await client.query(
    `INSERT INTO federation_actors (actor_uri, actor_type, purpose, acct, domain, display_name, status, is_local, raw_actor, last_fetched_at)
     VALUES ($1, 'person', 'remote', $2, $3, $4, 'active', false, $5::jsonb, now())
     ON CONFLICT (actor_uri) DO UPDATE SET acct = EXCLUDED.acct, domain = EXCLUDED.domain, display_name = EXCLUDED.display_name, raw_actor = EXCLUDED.raw_actor, last_fetched_at = now(), updated_at = now()
     RETURNING id`,
    [uri, item.actorHandle, domain, item.actorDisplayName, JSON.stringify({ actorUri: uri, acct: item.actorHandle, displayName: item.actorDisplayName })],
  )
  return result.rows[0]
}

async function replyIdForObject(client, objectId) {
  const result = await client.query('SELECT reply_id FROM federation_objects WHERE id = $1', [objectId])
  return result.rows[0]?.reply_id || null
}

async function uniqueImportedSlug(client, base) {
  let slug = base.slice(0, 160)
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const exists = await client.query('SELECT 1 FROM topics WHERE slug = $1 LIMIT 1', [slug])
    if (!exists.rowCount) return slug
    slug = `${base.slice(0, 145)}-${attempt + 1}`
  }
  return `${base.slice(0, 120)}-${randomUUID().slice(0, 12)}`
}

function isOwnObject(uri) {
  try {
    const site = new URL(process.env.NUXT_PUBLIC_SITE_URL || process.env.SITE_URL || 'http://localhost:3000')
    return new URL(String(uri || '')).host === site.host
  } catch {
    return false
  }
}

function titleForImportedStatus(item) {
  return shortTitle(item.body, 'Imported Fediverse thread')
}

function htmlToText(value) {
  return htmlToPlainText(value)
}

export function normalizeAttachments(items) {
  return Array.isArray(items) ? items.slice(0, 8).map(item => ({ url: safeHttps(item?.url), previewUrl: safeHttps(item?.preview_url), type: String(item?.type || 'unknown'), description: String(item?.description || '').slice(0, 500) })).filter(item => item.url) : []
}

export function appendAttachments(body, attachments) {
  if (!attachments.length) return body
  const links = attachments.map(item => `- [${item.description || item.type || 'Fediverse attachment'}](${item.url})`).join('\n')
  return `${body}${body ? '\n\n' : ''}${links}`
}

function safeHttps(value) { try { const url = new URL(String(value || '')); return url.protocol === 'https:' && !isPrivateHost(url.hostname) ? url.toString() : null } catch { return null } }

function isPrivateHost(hostname) {
  const host = String(hostname || '').toLowerCase().replace(/^\[/, '').replace(/\]$/, '').replace(/\.$/, '')
  if (!host || host === 'localhost' || host.endsWith('.local') || host.endsWith('.internal')) return true
  const version = net.isIP(host)
  if (version === 4) {
    const [a, b] = host.split('.').map(Number)
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168)
  }
  return version === 6 && (host === '::1' || host.startsWith('fc') || host.startsWith('fd') || host.startsWith('fe80:'))
}

export async function assertPublicRemoteOrigin(origin) {
  const parsed = new URL(origin)
  const hostname = normalizeHostname(parsed.hostname)
  if (isPrivateHost(hostname)) throw new Error('Private or local source hosts are not allowed.')
  if (net.isIP(hostname)) return
  let addresses
  try {
    addresses = await dns.lookup(hostname, { all: true, verbatim: true })
  } catch {
    throw new Error('The source host could not be resolved.')
  }
  if (!addresses.length || addresses.some(address => isPrivateHost(address.address))) {
    throw new Error('The source host resolves to a private or local address.')
  }
}

function normalizeHostname(hostname) {
  return String(hostname || '').toLowerCase().replace(/^\[/, '').replace(/\]$/, '').replace(/\.$/, '')
}

export function shortHash(value) { return createHash('sha256').update(String(value || '')).digest('hex').slice(0, 24) }
