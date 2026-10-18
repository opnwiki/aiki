import { createError, getRouterParam } from 'h3'
import { enforceSameOrigin, requireNodeAdmin } from '../../../utils/auth.js'
import { getDatabase } from '../../../utils/database.js'
import { revokeIntegrationSessionsAndLinks } from '../../../utils/integration-identity.js'

export default defineEventHandler(async (event) => {
  enforceSameOrigin(event)
  const admin = await requireNodeAdmin(event)
  const id = getRouterParam(event, 'id')
  if (!/^[a-f0-9-]{36}$/i.test(id || '')) throw createError({ statusCode: 400, statusMessage: 'Invalid integration credential ID.' })
  const client = await getDatabase().connect()
  try {
    await client.query('BEGIN')
    const result = await client.query('UPDATE integration_credentials SET revoked_at = coalesce(revoked_at, now()) WHERE id = $1 AND node_id = $2 RETURNING id', [id, admin.node_id])
    if (!result.rows[0]) throw createError({ statusCode: 404, statusMessage: 'Integration credential not found.' })
    await revokeIntegrationSessionsAndLinks(client, id)
    await client.query(`INSERT INTO actor_audit_log (actor_id, action, target_type, target_id) VALUES ($1, 'integration_credential_revoked', 'integration_credential', $2)`, [admin.id, id])
    await client.query('COMMIT')
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally { client.release() }
  return { revoked: true }
})
