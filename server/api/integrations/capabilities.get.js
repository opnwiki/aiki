import { requireIntegrationCredential } from '../../utils/integration-auth.js'
import { IMPORT_KINDS, IMPORT_BODY_BYTES } from '../../utils/integration-import-validation.js'

export default defineEventHandler(async event => {
  const credential = await requireIntegrationCredential(event, 'imports:read')
  return { version: 1, operations: ['imports', 'account-links', 'identities'], kinds: IMPORT_KINDS,
    limits: { title: 180, body: 40000, overview: 2000, sources: 20, media: 10, requestBytes: IMPORT_BODY_BYTES },
    allowedMediaOrigins: credential.allowed_media_origins }
})
