import { setResponseHeader } from 'h3'
import { requireNodeAdmin } from '../../../utils/auth.js'
import { getDatabase } from '../../../utils/database.js'
import { integrationsEnabled } from '../../../utils/integration-auth.js'

export default defineEventHandler(async (event) => {
  const admin = await requireNodeAdmin(event)
  setResponseHeader(event, 'Cache-Control', 'no-store')
  const result = await getDatabase().query(
    `SELECT id, connector, provider, identity_providers, label, token_prefix, scopes, allowed_media_origins, created_at, last_used_at, revoked_at
       FROM integration_credentials WHERE node_id = $1 ORDER BY created_at DESC`,
    [admin.node_id],
  )
  return { enabled: integrationsEnabled(), credentials: result.rows }
})
