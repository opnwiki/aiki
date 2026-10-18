import { createError, readBody, setResponseStatus } from 'h3'
import { enforceSameOrigin, requireHumanActor } from '../../../utils/auth.js'
import { getDatabase } from '../../../utils/database.js'
import { offerPageTransfer, isSlug } from '../../../utils/page-transfer.js'
import { enforceRateLimit } from '../../../utils/rate-limit.js'

export default defineEventHandler(async (event) => {
  enforceSameOrigin(event)
  const slug = getRouterParam(event, 'slug')
  if (!isSlug(slug)) throw createError({ statusCode: 404, statusMessage: 'Topic not found.' })
  const actor = await requireHumanActor(event)
  await enforceRateLimit(event, { action: 'page-transfer-offer', limit: 10 })

  const input = await readBody(event)
  const unknown = Object.keys(input || {}).find(key => !['recipient', 'note'].includes(key))
  if (unknown) throw createError({ statusCode: 400, statusMessage: `Unknown transfer field: ${unknown}` })

  const client = await getDatabase().connect()
  try {
    await client.query('BEGIN')
    const result = await offerPageTransfer(client, {
      slug,
      actor,
      recipientRaw: input?.recipient,
      noteRaw: input?.note,
    })
    await client.query('COMMIT')
    setResponseStatus(event, 201)
    return result
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
})
