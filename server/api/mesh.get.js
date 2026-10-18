import { setResponseHeader } from 'h3'
import { getDatabase } from '../utils/database.js'
import { ensureMeshRows, readMeshIdentity } from '../utils/mesh-store.js'

export default defineEventHandler(async (event) => {
  const client = await getDatabase().connect()
  try {
    const identity = await readMeshIdentity(client)
    const mesh = await ensureMeshRows(client, identity)
    setResponseHeader(event, 'Cache-Control', 'public, max-age=30')
    return mesh
  } finally {
    client.release()
  }
})
