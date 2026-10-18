import { createError } from 'h3'
import { getHumanActor } from '../../../utils/auth.js'
import { queryDatabase } from '../../../utils/database.js'
import { readableTopicSql } from '../../../utils/page-access.js'
import { topicKeyPredicate } from '../../../utils/page-address.js'
import { canManageContentTask, contentTaskSolutionSelectSql, presentContentTaskSolution } from '../../../utils/content-tasks.js'

// Task solutions that wait for review on this page, so they are visible where
// the change would land instead of only in the /tasks queue.
export default defineEventHandler(async (event) => {
  const slug = getRouterParam(event, 'slug')
  if (!slug || !/^[\p{L}\p{N}]+(?:-[\p{L}\p{N}]+)*$/u.test(slug)) {
    throw createError({ statusCode: 404, statusMessage: 'Topic not found.' })
  }

  const viewer = await getHumanActor(event)
  const topic = await queryDatabase(
    `SELECT id, author_id FROM topics WHERE ${topicKeyPredicate('topics', '$1')} AND ${readableTopicSql('topics', '$2')} LIMIT 1`,
    [slug, viewer?.id || null],
  )
  if (!topic.rows[0]) throw createError({ statusCode: 404, statusMessage: 'Topic not found.' })
  const canReview = canManageContentTask(viewer, { topic_author_id: topic.rows[0].author_id })

  const tasks = await queryDatabase(
    `SELECT task.id, task.task_type, task.reason, task.source_locale, task.target_locale, task.cycle_no,
            base.title AS base_title, base.summary AS base_summary
       FROM content_tasks task
       LEFT JOIN revisions base ON base.id = task.base_revision_id
      WHERE task.topic_id = $1 AND task.status IN ('submitted', 'under_review')`,
    [topic.rows[0].id],
  )
  if (!tasks.rows.length) return { canReview, items: [] }
  const taskById = new Map(tasks.rows.map(task => [task.id, task]))
  const solutions = await queryDatabase(
    `${contentTaskSolutionSelectSql()}
      WHERE solution.task_id = ANY($1::uuid[])
        AND solution.status IN ('submitted', 'partially_accepted')
      ORDER BY solution.created_at DESC
      LIMIT 50`,
    [[...taskById.keys()]],
  )

  return {
    canReview,
    items: solutions.rows
      .filter(row => taskById.get(row.task_id)?.cycle_no === row.cycle_no)
      .map((row) => {
        const task = taskById.get(row.task_id)
        return {
          ...presentContentTaskSolution(row),
          taskType: task.task_type,
          reason: task.reason,
          locale: task.target_locale || task.source_locale || null,
          base: { title: task.base_title, summary: task.base_summary },
          canReview: canReview && row.submitted_by !== viewer?.id,
        }
      }),
  }
})
