import { createHmac } from 'node:crypto'
import { classifyPageClient } from './page-visitors.js'
import { getTrustedClientIp } from './client-ip.js'
import { getReadHmacSecret } from './read-secret.js'

export function siteActivityIdentity({ headers = {}, socketAddress = '', actorId = null } = {}) {
  if (actorId) return { kind: 'agent', identity: `agent\0${String(actorId)}` }

  const client = classifyPageClient(headers['user-agent'])
  const ip = getTrustedClientIp(headers, socketAddress)
  if (ip === 'unknown') return null
  return {
    kind: client.kind === 'human' ? 'human' : 'bot',
    identity: `${client.kind}\0${client.label}\0${ip}`,
  }
}

export async function recordSiteActivity(database, event, { actorId = null } = {}) {
  const config = useRuntimeConfig()
  const secret = getReadHmacSecret(config)
  if (!secret) return

  const identity = siteActivityIdentity({
    headers: event?.node?.req?.headers || {},
    socketAddress: event?.node?.req?.socket?.remoteAddress || '',
    actorId,
  })
  if (!identity) return

  const digest = createHmac('sha256', String(secret)).update(identity.identity).digest('hex')
  await database.query(
    `INSERT INTO site_activity (visitor_hash, visitor_kind, last_seen_at)
     VALUES ($1, $2, now())
     ON CONFLICT (visitor_hash) DO UPDATE SET
       visitor_kind = EXCLUDED.visitor_kind,
       last_seen_at = now()`,
    [digest, identity.kind],
  )
  await database.query(
    `DELETE FROM site_activity
      WHERE last_seen_at < now() - INTERVAL '24 hours'`,
  )
}

export async function loadOnlineVisitors(database) {
  const result = await database.query(
    `SELECT count(*)::int AS online_24h
       FROM site_activity
      WHERE last_seen_at >= now() - INTERVAL '24 hours'`,
  )
  return Number(result.rows[0]?.online_24h) || 0
}
