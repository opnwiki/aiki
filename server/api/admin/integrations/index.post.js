import { readBody, setResponseHeader, setResponseStatus } from 'h3'
import { enforceSameOrigin, requireNodeAdmin } from '../../../utils/auth.js'
import { getDatabase } from '../../../utils/database.js'
import { createIntegrationToken, hashIntegrationToken, integrationTokenPrefix, normalizeIntegrationCredential } from '../../../utils/integration-auth.js'

export default defineEventHandler(async (event) => {
  enforceSameOrigin(event)
  const admin = await requireNodeAdmin(event)
  const settings = normalizeIntegrationCredential(await readBody(event))
  const token = createIntegrationToken()
  const client = await getDatabase().connect()
  let credential
  try {
    await client.query('BEGIN')
    const result = await client.query(
      `INSERT INTO integration_credentials (node_id, connector, provider, label, token_hash, token_prefix, scopes, allowed_media_origins, identity_providers, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       RETURNING id, connector, provider, label, token_prefix, scopes, identity_providers, allowed_media_origins, created_at`,
      [admin.node_id, settings.connector, settings.provider, settings.label, hashIntegrationToken(token), integrationTokenPrefix(token), settings.scopes, settings.allowedMediaOrigins, settings.identityProviders, admin.id],
    )
    credential = result.rows[0]
    await client.query(
      `INSERT INTO actor_audit_log (actor_id, action, target_type, target_id, details) VALUES ($1, 'integration_credential_created', 'integration_credential', $2, $3::jsonb)`,
      [admin.id, credential.id, JSON.stringify({ connector: settings.connector, scopes: settings.scopes, allowedMediaOrigins: settings.allowedMediaOrigins, identityProviders: settings.identityProviders })],
    )
    await client.query('COMMIT')
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally { client.release() }
  setResponseHeader(event, 'Cache-Control', 'no-store')
  setResponseStatus(event, 201)
  return { credential, token }
})
