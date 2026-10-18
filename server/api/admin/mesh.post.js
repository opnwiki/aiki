import { createError, readBody, setResponseHeader } from 'h3'
import { enforceSameOrigin, requireNodeAdmin } from '../../utils/auth.js'
import { getDatabase } from '../../utils/database.js'
import { admitMeshPeer, meshView, readMeshIdentity, refreshMesh, removeMeshPeer, setMeshHub } from '../../utils/mesh-store.js'

export default defineEventHandler(async (event) => {
  enforceSameOrigin(event)
  const actor = await requireNodeAdmin(event)
  const input = await readBody(event)
  const action = input?.action
  if (!['hub', 'add', 'remove', 'sync'].includes(action)) {
    throw createError({ statusCode: 400, statusMessage: 'Choose a mesh action.' })
  }
  const client = await getDatabase().connect()
  try {
    await client.query('BEGIN')
    let identity = await readMeshIdentity(client)
    if (action === 'hub') {
      const hubUrl = await setMeshHub(client, identity, input.hubUrl)
      await client.query(
        `INSERT INTO actor_audit_log (actor_id, action, target_type, target_id, details)
         VALUES ($1::uuid, 'mesh_hub_set', 'node', $2, jsonb_build_object('hubUrl', $3::text))`,
        [actor.id, identity.selfUrl, hubUrl],
      )
      identity = await readMeshIdentity(client)
    } else if (action === 'add') {
      const peer = await admitMeshPeer(client, identity, input.url)
      await client.query(
        `INSERT INTO actor_audit_log (actor_id, action, target_type, target_id, details)
         VALUES ($1::uuid, 'mesh_peer_added', 'mesh_node', $2, jsonb_build_object('name', $3::text))`,
        [actor.id, peer.url, peer.name],
      )
    } else if (action === 'remove') {
      await removeMeshPeer(client, identity, input.url)
      await client.query(
        `INSERT INTO actor_audit_log (actor_id, action, target_type, target_id, details)
         VALUES ($1::uuid, 'mesh_peer_removed', 'mesh_node', $2, jsonb_build_object('url', $2::text))`,
        [actor.id, String(input.url || '')],
      )
    } else {
      await refreshMesh(client, identity)
    }
    const view = await meshView(client, identity)
    await client.query('COMMIT')
    setResponseHeader(event, 'Cache-Control', 'private, no-store')
    return view
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
})
