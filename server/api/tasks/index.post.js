import { createError, readBody, setResponseStatus } from 'h3'
import { getDatabase } from '../../utils/database.js'
import { requireWritingTaskActor } from '../../utils/writing-tasks.js'
import { createOrReuseContentTask, loadContentTask, validateContentTaskInput, isContentTaskUuid } from '../../utils/content-tasks.js'
import { readableTopicSql } from '../../utils/page-access.js'
import { topicKeyPredicate } from '../../utils/page-address.js'
import { enforceContentQuota } from '../../utils/rate-limit.js'

export default defineEventHandler(async (event) => {
  const actor = await requireWritingTaskActor(event)
  await enforceContentQuota(event, actor, 'task')
  const input = validateContentTaskInput(await readBody(event))
  if (!input.ok) throw createError({ statusCode: 400, statusMessage: `Invalid task: ${input.error}.` })
  if (input.value.topicId && !isContentTaskUuid(input.value.topicId)) throw createError({ statusCode: 400, statusMessage: 'Invalid topic ID.' })
  if (input.value.baseRevisionId && !isContentTaskUuid(input.value.baseRevisionId)) throw createError({ statusCode: 400, statusMessage: 'Invalid base revision ID.' })
  if (input.value.topicId && input.value.topicSlug) throw createError({ statusCode: 400, statusMessage: 'Use topicId or topicSlug, not both.' })
  if (['edit_article', 'answer_question', 'translate', 'update_overview', 'fill_page'].includes(input.value.taskType) && !input.value.topicId && !input.value.topicSlug) {
    throw createError({ statusCode: 400, statusMessage: 'This task type needs a target page.' })
  }

  const client = await getDatabase().connect()
  let taskId
  try {
    await client.query('BEGIN')
    let topic = null
    if (input.value.topicId || input.value.topicSlug) {
      const topicResult = await client.query(
        `SELECT t.id, t.node_id, t.kind, t.status, t.author_id,
                current.revision_id, current.locale
           FROM topics t
           LEFT JOIN topic_current_revisions current ON current.topic_id = t.id
          WHERE ${input.value.topicId ? 't.id = $1::uuid' : topicKeyPredicate('t', '$1')}
            AND ${readableTopicSql('t', '$2')}
          ORDER BY current.locale
          LIMIT 1 FOR UPDATE OF t`,
        [input.value.topicId || input.value.topicSlug, actor.id],
      )
      topic = topicResult.rows[0]
      if (!topic) throw createError({ statusCode: 404, statusMessage: 'Target page not found.' })
      if (input.value.taskType === 'answer_question' && !['question', 'discussion'].includes(topic.kind)) throw createError({ statusCode: 400, statusMessage: 'answer_question tasks require a question or discussion page.' })
      if (input.value.taskType === 'edit_article' && topic.kind !== 'article') throw createError({ statusCode: 400, statusMessage: 'edit_article tasks require an article page.' })
      if (input.value.taskType === 'fill_page' && topic.kind !== 'page') throw createError({ statusCode: 400, statusMessage: 'fill_page tasks require a generic page.' })
    }
    const baseRevisionId = input.value.baseRevisionId || topic?.revision_id || null
    const created = await createOrReuseContentTask(client, {
      nodeId: topic?.node_id || actor.node_id || null,
      topicId: topic?.id || null,
      baseRevisionId,
      creatorId: actor.id,
      taskType: input.value.taskType,
      reason: input.value.reason,
      sourceLocale: input.value.sourceLocale || topic?.locale || null,
      targetLocale: input.value.targetLocale,
    })
    taskId = created?.id
    await client.query('COMMIT')
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
  const task = await loadContentTask(getDatabase(), taskId)
  setResponseStatus(event, 201)
  return { task, created: task?.creator?.id === actor.id }
})
