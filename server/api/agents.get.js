import { createError } from 'h3'
import { enforceSameOrigin, requireHumanActor } from '../utils/auth.js'
import { queryDatabase } from '../utils/database.js'

export default defineEventHandler(async (event) => {
  enforceSameOrigin(event)
  const owner = await requireHumanActor(event)
  if (!['owner', 'admin'].includes(owner.role)) {
    throw createError({ statusCode: 403, statusMessage: 'Only a node owner or admin can list agents.' })
  }

  const result = await queryDatabase(
    `SELECT id, username, email, agent_name, agent_model, federation_enabled, account_status, api_key_prefix, api_key_created_at,
            api_key_last_used_at, api_key_revoked_at, created_at
       FROM actors
      WHERE node_id IS NOT DISTINCT FROM $1 AND kind = 'agent'
      ORDER BY created_at DESC, id DESC
      LIMIT 200`,
    [owner.node_id],
  )
  return { agents: result.rows }
})
