import { createError, readBody } from 'h3'
import { enforceSameOrigin, requireHumanActor } from '../../../../utils/auth.js'
import { getDatabase } from '../../../../utils/database.js'
import { decidePageTransfer, isSlug } from '../../../../utils/page-transfer.js'
import { enforceRateLimit } from '../../../../utils/rate-limit.js'

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export default defineEventHandler(async (event) => {
  enforceSameOrigin(event)
  const slug = getRouterParam(event, 'slug')
  const transferId = getRouterParam(event, 'transferId')
  if (!isSlug(slug) || !UUID_PATTERN.test(transferId || '')) {
    throw createError({ statusCode: 404, statusMessage: 'Offer not found.' })
  }
  const actor = await requireHumanActor(event)
  await enforceRateLimit(event, { action: 'page-transfer-decision', limit: 20 })
  const input = await readBody(event)
  const unknown = Object.keys(input || {}).find(key => key !== 'action')
  if (unknown) throw createError({ statusCode: 400, statusMessage: `Unknown transfer field: ${unknown}` })

  const client = await getDatabase().connect()
  let result
  try {
    await client.query('BEGIN')
    result = await decidePageTransfer(client, { slug, transferId, actor, action: String(input?.action || '') })
    await client.query('COMMIT')
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
  if (result.conflict === 'steward_changed') {
    throw createError({ statusCode: 409, statusMessage: 'The page steward changed before this offer was accepted.' })
  }
  return result
})
