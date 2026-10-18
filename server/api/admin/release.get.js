import { setResponseHeader } from 'h3'
import { requireNodeAdmin } from '../../utils/auth.js'
import { getDatabase } from '../../utils/database.js'
import { readMeshIdentity } from '../../utils/mesh-store.js'
import { assessHubRelease } from '../../utils/release.js'

export default defineEventHandler(async (event) => {
  await requireNodeAdmin(event)
  const client = await getDatabase().connect()
  try {
    const identity = await readMeshIdentity(client)
    const release = await assessHubRelease({
      siteUrl: identity.selfUrl,
      hubUrl: identity.hubUrl,
      allowLoopback: identity.allowLoopback,
    })
    setResponseHeader(event, 'Cache-Control', 'private, no-store')
    return release
  } finally {
    client.release()
  }
})
