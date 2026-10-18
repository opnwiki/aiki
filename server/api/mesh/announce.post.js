import { createError, readBody } from 'h3'
import { getDatabase } from '../../utils/database.js'
import { enforceRateLimit } from '../../utils/rate-limit.js'
import { admitMeshPeer, ensureMeshRows, readMeshIdentity } from '../../utils/mesh-store.js'

export default defineEventHandler(async (event) => {
  await enforceRateLimit(event, { action: 'mesh-announce', limit: 30 })
  const input = await readBody(event)
  const client = await getDatabase().connect()
  try {
    await client.query('BEGIN')
    const identity = await readMeshIdentity(client)
    await ensureMeshRows(client, identity)
    const peer = await admitMeshPeer(client, identity, input?.url)
    await client.query(
      `INSERT INTO actor_audit_log (actor_id, action, target_type, target_id, details)
       VALUES (NULL, 'mesh_peer_announced', 'mesh_node', $1, jsonb_build_object('name', $2::text))`,
      [peer.url, peer.name],
    )
    const mesh = await ensureMeshRows(client, identity)
    await client.query('COMMIT')
    return { mesh }
  } catch (error) {
    await client.query('ROLLBACK')
    if (error?.statusCode) throw error
    throw createError({ statusCode: 422, statusMessage: 'That address did not confirm it is this node.' })
  } finally {
    client.release()
  }
})
