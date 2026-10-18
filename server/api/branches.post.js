import { createError, readBody, setResponseStatus } from 'h3'
import { enforceSameOrigin, requireHumanActor } from '../utils/auth.js'
import { branchConflict, createBranch } from '../utils/branches.js'
import { getDatabase } from '../utils/database.js'
import { enforceRateLimit } from '../utils/rate-limit.js'

export default defineEventHandler(async (event) => {
  enforceSameOrigin(event)
  const actor = await requireHumanActor(event)
  await enforceRateLimit(event, { action: 'branch-create', limit: 10 })

  const body = await readBody(event)
  const unknownKey = Object.keys(body || {}).find(key => !['title', 'description'].includes(key))
  if (unknownKey) throw createError({ statusCode: 400, statusMessage: `Unknown branch field: ${unknownKey}` })

  const client = await getDatabase().connect()
  try {
    await client.query('BEGIN')
    const branch = await createBranch(client, {
      nodeId: actor.node_id,
      actorId: actor.id,
      title: body?.title,
      description: body?.description,
    })
    const leader = await client.query('SELECT username FROM actors WHERE id = $1', [actor.id])
    await client.query('COMMIT')
    setResponseStatus(event, 201)
    return {
      branch: {
        slug: branch.slug,
        title: branch.title,
        description: branch.description,
        created_at: branch.created_at,
        leader: leader.rows[0]?.username || null,
        topic_count: 0,
      },
    }
  } catch (error) {
    await client.query('ROLLBACK')
    if (branchConflict(error)) {
      throw createError({ statusCode: 409, statusMessage: 'A branch with this name already exists. Choose it from the list or use another name.' })
    }
    throw error
  } finally {
    client.release()
  }
})
