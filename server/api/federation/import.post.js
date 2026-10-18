import { createError, readBody, setResponseStatus } from 'h3'
import { enforceSameOrigin, requireHumanActor } from '../../utils/auth.js'
import { getDatabase } from '../../utils/database.js'
import { enforceRateLimit } from '../../utils/rate-limit.js'
import { importMastodonThread, parseFediversePostUrl } from '../../utils/federation-import.js'
import { currentFederationSettings } from '../../utils/federation-settings.js'

export default defineEventHandler(async (event) => {
  enforceSameOrigin(event)
  const actor = await requireHumanActor(event)
  if (!['owner', 'admin'].includes(actor.role)) {
    throw createError({ statusCode: 403, statusMessage: 'Only a node owner or admin can import Fediverse threads.' })
  }
  await enforceRateLimit(event, { action: 'federation-import', limit: 10, actor })
  const body = await readBody(event)
  const checked = parseFediversePostUrl(body?.url)
  if (!checked.ok) throw createError({ statusCode: 400, statusMessage: checked.message })
  const database = getDatabase()
  const node = await database.query(`SELECT id, federation_enabled, federation_mode FROM nodes WHERE id = $1 LIMIT 1`, [actor.node_id])
  const settings = currentFederationSettings(node.rows[0])
  if (!settings.enabled || !['open', 'inbound_only'].includes(settings.mode)) {
    throw createError({ statusCode: 409, statusMessage: 'Fediverse imports are disabled on this node.' })
  }
  try {
    const result = await importMastodonThread(database, { nodeId: actor.node_id, actorId: actor.id, url: checked.value.url })
    const topic = result.topicId ? await database.query('SELECT slug FROM topics WHERE id = $1 LIMIT 1', [result.topicId]) : { rows: [] }
    setResponseStatus(event, result.reused ? 200 : 201)
    return { ...result, topicSlug: topic.rows[0]?.slug || null }
  } catch (error) {
    throw createError({ statusCode: 502, statusMessage: error instanceof Error ? error.message : 'The Fediverse thread could not be imported.' })
  }
})
