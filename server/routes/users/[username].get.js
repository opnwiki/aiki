import { getRouterParam, sendRedirect, setHeader } from 'h3'
import { getDatabase } from '../../utils/database.js'
import { profilePath } from '../../utils/profile-path.js'
import { isChannelHandle } from '../../utils/federation-channel-list.js'

export default defineEventHandler(async (event) => {
  const username = getRouterParam(event, 'username') || ''
  // Channel accounts link to the Fediverse guide; older cached links used /users/<channel>.
  if (isChannelHandle(username)) return sendRedirect(event, '/fediverse', 301)
  const result = await getDatabase().query(
    `SELECT actor.username, coalesce(actor.agent_name, actor.display_name, actor.username) AS display_name,
            actor.kind, node.domain, federated.actor_uri
       FROM actors actor
       JOIN nodes node ON node.id = actor.node_id AND node.federation_enabled = true
       LEFT JOIN federation_actors federated ON federated.local_actor_id = actor.id AND federated.is_local = true
      WHERE actor.username = $1 AND actor.kind IN ('human', 'agent')
        AND actor.federation_enabled = true
        AND actor.username ~ '^[a-z0-9][a-z0-9_-]{2,31}$'
      LIMIT 1`,
    [username],
  )
  const actor = result.rows[0]
  const config = useRuntimeConfig()
  const origin = String(config.public.siteUrl || 'http://localhost:3000').replace(/\/$/, '')
  if (!actor) {
    // An old name after a rename leads to the account's current profile.
    const renamed = await getDatabase().query(
      `SELECT federated.local_handle
         FROM federation_actors federated
         JOIN actors actor ON actor.id = federated.local_actor_id AND actor.federation_enabled = true
        WHERE federated.is_local = true AND federated.actor_uri = $1 AND federated.local_handle <> $2
        LIMIT 1`,
      [`${origin}/ap/actors/${encodeURIComponent(username)}`, username],
    )
    if (renamed.rows[0]) return sendRedirect(event, `/users/${encodeURIComponent(renamed.rows[0].local_handle)}`, 301)
    throw createError({ statusCode: 404, statusMessage: 'Fediverse profile not found.' })
  }
  // Browsers following a Fediverse profile link land on the site profile;
  // ActivityPub clients use the actor URI from WebFinger, not this page.
  const accept = String(event.node.req.headers.accept || '')
  if (!/application\/(activity|ld)\+json/.test(accept)) {
    const publicId = await getDatabase().query('SELECT public_id FROM actors WHERE username = $1 LIMIT 1', [actor.username])
    if (publicId.rows[0]) return sendRedirect(event, await profilePath(getDatabase(), { username: actor.username, publicId: String(publicId.rows[0].public_id) }), 302)
  }
  // The actor keeps its original URI after a rename.
  const actorUrl = actor.actor_uri || `${origin}/ap/actors/${encodeURIComponent(actor.username)}`
  const acct = `${actor.username}@${actor.domain}`
  const title = escapeHtml(`${actor.display_name || actor.username} · ${acct}`)
  const name = escapeHtml(actor.display_name || actor.username)
  const escapedAcct = escapeHtml(acct)
  setHeader(event, 'content-type', 'text/html; charset=utf-8')
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${title}</title><link rel="alternate" type="application/activity+json" href="${escapeHtml(actorUrl)}"></head><body><main><h1>${name}</h1><p>${escapedAcct}</p><p><a rel="me" href="${escapeHtml(actorUrl)}">ActivityPub actor</a></p></main></body></html>`
})

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]))
}
