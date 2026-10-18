import { createError } from 'h3'
import { requireHumanActor } from '../../../utils/auth.js'
import { getDatabase } from '../../../utils/database.js'

export default defineEventHandler(async (event) => {
  const actor = await requireHumanActor(event)
  const id = getRouterParam(event, 'id')
  const result = await getDatabase().query(
    `SELECT imports.id, imports.requested_url, imports.canonical_root_uri, imports.status,
            imports.total_seen, imports.public_imported, imports.skipped, imports.last_error,
            imports.started_at, imports.completed_at, imports.last_synced_at, imports.created_at,
            imports.topic_id, topics.slug
       FROM federation_imports imports
       JOIN nodes ON nodes.id = imports.node_id AND nodes.id = $2
       LEFT JOIN topics ON topics.id = imports.topic_id
      WHERE imports.id = $1 AND (imports.created_by = $3 OR $4 IN ('owner', 'admin'))
      LIMIT 1`,
    [id, actor.node_id, actor.id, actor.role],
  )
  if (!result.rows[0]) throw createError({ statusCode: 404, statusMessage: 'Import not found.' })
  return { import: result.rows[0] }
})
