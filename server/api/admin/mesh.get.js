import { setResponseHeader } from 'h3'
import { requireNodeAdmin } from '../../utils/auth.js'
import { getDatabase } from '../../utils/database.js'
import { meshView, readMeshIdentity } from '../../utils/mesh-store.js'

export default defineEventHandler(async (event) => {
  await requireNodeAdmin(event)
  const client = await getDatabase().connect()
  try {
    const identity = await readMeshIdentity(client)
    const view = await meshView(client, identity)
    setResponseHeader(event, 'Cache-Control', 'private, no-store')
    return view
  } finally {
    client.release()
  }
})
