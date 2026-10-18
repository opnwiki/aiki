import { createError, getRouterParam } from 'h3'
import { enforceSameOrigin, requireNodeAdmin } from '../../../utils/auth.js'
import { getDatabase } from '../../../utils/database.js'
import { invalidateAccessControlCache, listAccessBlocks } from '../../../utils/access-control.js'

export default defineEventHandler(async (event) => {
  enforceSameOrigin(event)
  await requireNodeAdmin(event)
  const id = String(getRouterParam(event, 'id') || '')
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw createError({ statusCode: 400, statusMessage: 'The blocked IP record is invalid.' })
  const database = getDatabase()
  const result = await database.query(
    `DELETE FROM node_ip_access_blocks
      WHERE id = $1::uuid
        AND node_id = (SELECT id FROM nodes WHERE is_home LIMIT 1)`,
    [id],
  )
  if (!result.rowCount) throw createError({ statusCode: 404, statusMessage: 'The blocked IP record was not found.' })
  invalidateAccessControlCache()
  return { blocks: await listAccessBlocks(database) }
})
