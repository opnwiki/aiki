import { createError } from 'h3'
import { actorDisplayNameSql } from './actor-display.js'
import { publicAvatarPath } from './avatar.js'
import { authorHiddenSql, effectiveAuthorHidden } from './author-visibility.js'
import { shortPagePath } from './page-number.js'
import { safeIntegrationPublicUrl } from './integration-auth.js'
import { preferredLocale } from './validation.js'
import { profilePath } from './profile-path.js'

export function presentPublicActor(actor) {
  if (!actor || actor.account_status !== 'active' || !['human', 'agent', 'external'].includes(actor.kind)) return null
  const avatarUrl = actor.kind !== 'external' && hasSelectedAvatar(actor)
    ? publicAvatarPath(actor.public_id)
    : actor.avatar_preference === 'custom' && actor.kind !== 'external'
      ? null
      : safeIntegrationPublicUrl(actor.external_avatar_url, { httpsOnly: true })
  return {
    publicId: String(actor.public_id), username: actor.username, displayName: actor.display_name || actor.username,
    kind: actor.kind, avatarUrl: avatarUrl || null, profileUrl: safeIntegrationPublicUrl(actor.external_profile_url),
  }
}

function hasSelectedAvatar(actor) {
  if (actor.avatar_preference === 'custom') return actor.has_custom_avatar === true
  if (actor.avatar_preference === 'gravatar') return actor.has_gravatar_avatar === true || actor.has_statica_avatar === true
  return actor.has_statica_avatar === true
}

export function presentPublicActorPage(row) {
  if (!row || row.status !== 'published' || effectiveAuthorHidden(row.hide_author, row.show_author)) return null
  const path = shortPagePath(row.page_number)
  return path ? { pageNumber: String(row.page_number), path, title: row.title, kind: row.kind, locale: row.locale, updatedAt: row.updated_at } : null
}

const HISTORY_LIMIT = 30

export async function loadPublicActorProfile(database, publicId, { locale = 'en', limit = HISTORY_LIMIT, origin = null } = {}) {
  if (typeof publicId !== 'string' || !/^\d{14}$/.test(publicId)) throw notFound()
  const result = await database.query(
    `SELECT a.id, a.public_id, a.username, ${actorDisplayNameSql('a')} AS display_name, a.kind, a.account_status, a.avatar_preference,
            a.created_at, a.agent_model, a.federation_enabled, node.federation_enabled AS node_federation_enabled, node.domain,
            federated.actor_uri,
            EXISTS (SELECT 1 FROM actor_avatars WHERE actor_id = a.id AND source = 'upload') AS has_custom_avatar,
            EXISTS (SELECT 1 FROM actor_avatars WHERE actor_id = a.id AND source = 'statica') AS has_statica_avatar,
            EXISTS (SELECT 1 FROM actor_avatars WHERE actor_id = a.id AND source = 'gravatar') AS has_gravatar_avatar,
            external.profile_url AS external_profile_url, external.avatar_url AS external_avatar_url
       FROM actors a
       LEFT JOIN nodes node ON node.id = a.node_id
       LEFT JOIN federation_actors federated ON federated.local_actor_id = a.id AND federated.is_local = true
       LEFT JOIN LATERAL (
         SELECT profile_url, avatar_url FROM external_identities
          WHERE actor_id = a.id OR initial_actor_id = a.id
          ORDER BY (actor_id = a.id) DESC, updated_at DESC, id LIMIT 1
       ) external ON true
      WHERE a.public_id = $1::bigint AND a.account_status = 'active' AND a.kind IN ('human', 'agent', 'external')`,
    [publicId],
  )
  const actor = result.rows[0]
  const profile = presentPublicActor(actor)
  if (!profile) throw notFound()
  const boundedLimit = Math.min(Math.max(Number.parseInt(limit, 10) || HISTORY_LIMIT, 1), HISTORY_LIMIT)
  const lang = preferredLocale(locale)
  const titleSql = alias => `(SELECT r.title FROM topic_current_revisions current JOIN revisions r ON r.id = current.revision_id
                               WHERE current.topic_id = ${alias}.id
                               ORDER BY (r.locale = $2) DESC, (r.source_revision_id IS NULL) DESC, r.locale LIMIT 1)`

  const [pages, replies, edits, counts] = await Promise.all([
    database.query(
      `SELECT t.page_number, t.kind, t.status, t.hide_author, a.show_author, t.created_at, t.updated_at, revision.title, revision.locale, revision.body_markdown
         FROM topics t
         JOIN actors a ON a.id = t.author_id
         JOIN LATERAL (
           SELECT r.title, r.locale, r.body_markdown FROM topic_current_revisions current
           JOIN revisions r ON r.id = current.revision_id
            WHERE current.topic_id = t.id
            ORDER BY (r.locale = $2) DESC, (r.source_revision_id IS NULL) DESC, r.locale LIMIT 1
         ) revision ON true
        WHERE t.author_id = $1 AND t.status = 'published' AND NOT ${authorHiddenSql('t', 'a')}
        ORDER BY t.created_at DESC, t.id DESC LIMIT $3`,
      [actor.id, lang, boundedLimit * 2],
    ),
    database.query(
      `SELECT reply.id, reply.body_markdown, reply.created_at, t.page_number, t.kind, ${titleSql('t')} AS title
         FROM replies reply
         JOIN topics t ON t.id = reply.topic_id AND t.status = 'published'
        WHERE reply.author_id = $1 AND reply.status = 'published' AND reply.author_hidden IS NOT TRUE
        ORDER BY reply.created_at DESC LIMIT $3`,
      [actor.id, lang, boundedLimit],
    ),
    // Edits on other people's pages (own pages are already listed).
    database.query(
      `SELECT revision.id, revision.created_at, revision.locale, revision.source_revision_id IS NOT NULL AS translation,
              t.page_number, t.kind, ${titleSql('t')} AS title
         FROM revisions revision
         JOIN topics t ON t.id = revision.topic_id AND t.status = 'published'
        WHERE revision.author_id = $1 AND t.author_id IS DISTINCT FROM $1
        ORDER BY revision.created_at DESC LIMIT $3`,
      [actor.id, lang, boundedLimit],
    ),
    database.query(
      `SELECT
         (SELECT count(*)::int FROM topics t JOIN actors a ON a.id = t.author_id
           WHERE t.author_id = $1 AND t.status = 'published' AND NOT ${authorHiddenSql('t', 'a')}) AS topics,
         (SELECT count(*)::int FROM replies r JOIN topics t ON t.id = r.topic_id AND t.status = 'published'
           WHERE r.author_id = $1 AND r.status = 'published' AND r.author_hidden IS NOT TRUE) AS replies,
         (SELECT count(*)::int FROM revisions r JOIN topics t ON t.id = r.topic_id AND t.status = 'published'
           WHERE r.author_id = $1 AND t.author_id IS DISTINCT FROM $1) AS edits`,
      [actor.id],
    ),
  ])

  const presentedPages = pages.rows.map(row => {
    const page = presentPublicActorPage(row)
    return page ? { ...page, createdAt: row.created_at, excerpt: row.kind === 'message' ? plainExcerpt(row.body_markdown) : null } : null
  }).filter(Boolean)
  const linked = row => shortPagePath(row.page_number)
  const fediverse = actor.kind !== 'external' && actor.federation_enabled === true && actor.node_federation_enabled === true
    && FEDERATION_HANDLE.test(actor.username || '') && actor.domain
    ? `@${actor.username}@${actor.domain}`
    : null
  return {
    profile: {
      ...profile,
      path: actor.kind === 'external' ? `/people/${profile.publicId}` : await profilePath(database, { username: actor.username, publicId: profile.publicId }),
      joinedAt: actor.created_at,
      model: actor.kind === 'agent' ? actor.agent_model || null : null,
      fediverse,
      counts: { topics: counts.rows[0]?.topics || 0, replies: counts.rows[0]?.replies || 0, edits: counts.rows[0]?.edits || 0 },
    },
    pages: presentedPages.filter(page => page.kind !== 'message').slice(0, boundedLimit),
    messages: presentedPages.filter(page => page.kind === 'message').slice(0, boundedLimit),
    replies: replies.rows.filter(linked).map(row => ({
      id: row.id,
      path: `${linked(row)}#comment-${row.id}`,
      title: row.title || '',
      kind: row.kind,
      excerpt: plainExcerpt(row.body_markdown),
      createdAt: row.created_at,
    })),
    edits: edits.rows.filter(linked).map(row => ({
      id: row.id,
      path: linked(row),
      title: row.title || '',
      kind: row.kind,
      locale: row.locale,
      translation: row.translation === true,
      createdAt: row.created_at,
    })),
  }
}

const FEDERATION_HANDLE = /^[a-z0-9][a-z0-9_-]{2,31}$/

function plainExcerpt(markdown, limit = 240) {
  const text = String(markdown || '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[#>*_`~|]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return text.length > limit ? `${text.slice(0, limit).replace(/\s+\S*$/, '')}…` : text
}

function notFound() { return createError({ statusCode: 404, statusMessage: 'Public profile not found.' }) }
