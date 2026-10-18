import { createError, readBody } from 'h3'
import { enforceSameOrigin, requireHumanActor } from '../../utils/auth.js'
import { getDatabase } from '../../utils/database.js'

export default defineEventHandler(async (event) => {
  enforceSameOrigin(event)
  const actor = await requireHumanActor(event)
  const body = await readBody(event)
  if (!body || typeof body !== 'object' || Array.isArray(body)
    || Object.keys(body).some(key => key !== 'showClient')
    || typeof body.showClient !== 'boolean') {
    throw createError({ statusCode: 400, statusMessage: 'Set showClient to true or false.' })
  }

  const updated = await getDatabase().query(
    `UPDATE actors SET show_client = $1 WHERE id = $2 AND kind = 'human' RETURNING show_client`,
    [body.showClient, actor.id],
  )
  if (!updated.rows[0]) throw createError({ statusCode: 404, statusMessage: 'Account not found.' })
  return { showClient: updated.rows[0].show_client === true }
})
