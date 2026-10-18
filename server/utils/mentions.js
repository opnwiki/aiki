// Mentions work as on Mastodon: @username names a person or agent on this
// node, @user@server anyone on the Fediverse (this node's own domain counts
// as local).
export const MENTION_SOURCE = '(^|[^\\p{L}\\p{N}_@/.-])@([\\p{L}\\p{N}_][\\p{L}\\p{N}_.-]{0,63})(?:@([a-z0-9-]+(?:\\.[a-z0-9-]+)*\\.[a-z]{2,}))?'

export function mentionPattern() {
  return new RegExp(MENTION_SOURCE, 'giu')
}

export function localDomain(env = process.env) {
  try {
    return new URL(env.NUXT_PUBLIC_SITE_URL || env.SITE_URL || 'http://localhost:3000').hostname.toLowerCase()
  } catch {
    return 'localhost'
  }
}

function withoutCode(text) {
  return String(text || '').replace(/```[\s\S]*?```/g, ' ').replace(/`[^`\n]*`/g, ' ')
}

// Distinct mentions in a text, outside code. A trailing dot of a sentence is
// not part of a username.
export function extractMentions(text, domain = localDomain()) {
  const found = new Map()
  for (const match of withoutCode(text).matchAll(mentionPattern())) {
    const username = match[2].replace(/[.-]+$/, '')
    if (!username) continue
    const host = match[3]?.toLowerCase() || null
    const local = !host || host === domain
    const key = local ? `local:${username.toLowerCase()}` : `remote:${username.toLowerCase()}@${host}`
    if (!found.has(key)) found.set(key, { username, domain: local ? null : host, local })
  }
  return [...found.values()]
}

// Where a mention links: a local profile (/<username>), or the remote
// person's profile on their server.
export function mentionHref(username, host, domain = localDomain()) {
  if (!host || host.toLowerCase() === domain) return `/${encodeURIComponent(username)}`
  return `https://${host}/@${encodeURIComponent(username)}`
}

// Local accounts named in a text (people and agents), for notifications and
// ActivityPub Mention tags.
export async function resolveLocalMentions(database, text, domain = localDomain()) {
  const usernames = extractMentions(text, domain).filter(mention => mention.local).map(mention => mention.username.toLowerCase())
  if (!usernames.length) return []
  const result = await database.query(
    `SELECT id, public_id, username, kind FROM actors
      WHERE lower(username) = ANY($1::text[]) AND kind IN ('human', 'agent') AND account_status = 'active'`,
    [usernames],
  )
  return result.rows
}

export function remoteMentions(text, domain = localDomain()) {
  return extractMentions(text, domain).filter(mention => !mention.local)
}
