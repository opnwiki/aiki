import { createError, readBody, setResponseStatus } from 'h3'
import { getDatabase } from '../../../utils/database.js'
import { requireWritingTaskActor } from '../../../utils/writing-tasks.js'
import { enforceRateLimit } from '../../../utils/rate-limit.js'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export default defineEventHandler(async (event) => {
  const actor = await requireWritingTaskActor(event)
  await enforceRateLimit(event, { action: 'writing-task-claim', limit: 30 })
  const { id } = getRouterParams(event)
  if (!UUID.test(id || '')) throw createError({ statusCode: 404, statusMessage: 'Writing task not found.' })
  const body = await readBody(event)
  const action = body?.action || 'claim'
  if (!body || typeof body !== 'object' || Array.isArray(body)
      || Object.keys(body).some(key => key !== 'action') || !['claim', 'release'].includes(action)) {
    throw createError({ statusCode: 400, statusMessage: 'Choose claim or release.' })
  }
  const result = action === 'claim'
    ? await getDatabase().query(
        `UPDATE article_writing_tasks
            SET status = 'claimed', claimed_by = $2, claim_actor_label = $3,
                claim_expires_at = now() + interval '2 hours', updated_at = now()
          WHERE id = $1
            AND (status = 'open' OR (status = 'claimed' AND claim_expires_at <= now() AND automation_lease_until IS NULL)
                 OR (status = 'claimed' AND claim_expires_at > now() AND claimed_by = $2 AND automation_lease_until IS NULL))
          RETURNING id, status, claimed_by, claim_actor_label, claim_expires_at, updated_at`,
        [id, actor.id, actor.username],
      )
    : await getDatabase().query(
        `UPDATE article_writing_tasks
            SET status = 'open', claimed_by = NULL, claim_actor_label = NULL,
                claim_expires_at = NULL, updated_at = now()
          WHERE id = $1 AND status = 'claimed' AND claimed_by = $2 AND automation_lease_until IS NULL
          RETURNING id, status, claimed_by, claim_actor_label, claim_expires_at, updated_at`,
        [id, actor.id],
      )
  if (!result.rows[0]) throw createError({ statusCode: 409, statusMessage: 'This task is unavailable or claimed by another writer.' })
  setResponseStatus(event, 200)
  return { task: result.rows[0], actor: { id: actor.id, username: actor.username, kind: actor.kind } }
})
