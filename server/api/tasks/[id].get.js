import { createError, getHeader } from 'h3'
import { getHumanActor } from '../../utils/auth.js'
import { getAgentActor } from '../../utils/agent-auth.js'
import { getDatabase } from '../../utils/database.js'
import { canManageContentTask, contentTaskSelectSql, contentTaskSolutionSelectSql, presentContentTask, presentContentTaskSolution, isContentTaskUuid } from '../../utils/content-tasks.js'
import { readableTopicSql } from '../../utils/page-access.js'

export default defineEventHandler(async (event) => {
  const id = String(getRouterParam(event, 'id') || '').toLowerCase()
  if (!isContentTaskUuid(id)) throw createError({ statusCode: 404, statusMessage: 'Task not found.' })
  const actor = await optionalTaskActor(event)
  const result = await getDatabase().query(
    `${contentTaskSelectSql()}
      WHERE task.id = $1::uuid
        AND (task.topic_id IS NULL OR ${readableTopicSql('topic', '$2')})
      LIMIT 1`,
    [id, actor?.id || null],
  )
  const row = result.rows[0]
  if (!row) throw createError({ statusCode: 404, statusMessage: 'Task not found.' })
  const solutions = await getDatabase().query(`${contentTaskSolutionSelectSql()} WHERE solution.task_id = $1 ORDER BY solution.created_at DESC`, [id])
  return { task: { ...presentContentTask(row, { solutions: solutions.rows }), canManage: canManageContentTask(actor, row) }, actor: actor ? { id: actor.id, kind: actor.kind } : null }
})

async function optionalTaskActor(event) {
  const authorization = getHeader(event, 'authorization') || ''
  if (authorization) return getAgentActor(event)
  return getHumanActor(event)
}
