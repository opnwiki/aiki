import { createError, readBody } from 'h3'
import { enforceSameOrigin, requireNodeAdmin } from '../../../utils/auth.js'
import { getDatabase } from '../../../utils/database.js'
import { invalidateAccessControlCache, listAccessBlocks, normalizeAccessIp, normalizeAccessReason } from '../../../utils/access-control.js'
import { lookupStaticaProfile } from '../../../utils/site-analytics.js'

export default defineEventHandler(async (event) => {
  enforceSameOrigin(event)
  await requireNodeAdmin(event)
  const input = await readBody(event)
  const ip = normalizeAccessIp(input?.ip)
  if (!ip) throw createError({ statusCode: 400, statusMessage: 'Enter a valid IPv4 or IPv6 address.' })

  const database = getDatabase()
  const node = await database.query('SELECT id FROM nodes WHERE is_home LIMIT 1')
  if (!node.rows[0]) throw createError({ statusCode: 409, statusMessage: 'This node has no home record to update.' })
  try {
    await database.query(
      `INSERT INTO node_ip_access_blocks (node_id, ip, reason)
       VALUES ($1, $2::inet, $3)`,
      [node.rows[0].id, ip, normalizeAccessReason(input?.reason)],
    )
  } catch (error) {
    if (error?.code === '23505') throw createError({ statusCode: 409, statusMessage: 'This IP address is already blocked.' })
    throw error
  }

  // Fetch and persist the current profile immediately so the admin list and
  // the denial page can show Statica data even before the next public request.
  await lookupStaticaProfile(ip).catch(() => {})
  invalidateAccessControlCache()
  return { blocks: await listAccessBlocks(database) }
})
