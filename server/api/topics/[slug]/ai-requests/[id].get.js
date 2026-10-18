import { createError, getRouterParam } from 'h3'
import { getHumanActor } from '../../../../utils/auth.js'
import { getDatabase } from '../../../../utils/database.js'
import { topicKeyPredicate } from '../../../../utils/page-address.js'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export default defineEventHandler(async (event) => {
  const actor = await getHumanActor(event)
  if (!actor) throw createError({ statusCode: 401, statusMessage: 'Sign in to view the AI request.' })

  const slug = getRouterParam(event, 'slug')
  const id = getRouterParam(event, 'id')
  if (!slug || !UUID.test(id || '')) throw createError({ statusCode: 404, statusMessage: 'AI request not found.' })

  const result = await getDatabase().query(
    `SELECT request.id, request.topic_id, request.requester_id, request.request_type,
            request.base_revision_id,
            request.locale, request.status, request.provider_cost, request.result,
            request.published_reply_id, request.published_proposal_id, request.updated_overview_revision_id,
            request.progress_percent, request.progress_stage, request.progress_message,
            request.error_code, request.error_message, request.created_at, request.updated_at,
            request.finished_at
       FROM topic_ai_requests request
       JOIN topics topic ON topic.id = request.topic_id
      WHERE request.id = $1 AND ${topicKeyPredicate('topic', '$2')}`,
    [id, slug],
  )
  const row = result.rows[0]
  if (!row) throw createError({ statusCode: 404, statusMessage: 'AI request not found.' })
  if (row.requester_id !== actor.id && !['owner', 'admin', 'moderator'].includes(actor.role)) {
    throw createError({ statusCode: 403, statusMessage: 'This AI request belongs to another account.' })
  }

  return {
    request: {
      id: row.id,
      topicId: row.topic_id,
      requestType: row.request_type,
      baseRevisionId: row.base_revision_id,
      locale: row.locale,
      status: row.status,
      progressPercent: Number(row.progress_percent || 0),
      progressStage: row.progress_stage || null,
      progressMessage: row.progress_message || null,
      providerCost: row.provider_cost || null,
      result: row.result || null,
      publishedReplyId: row.published_reply_id || null,
      publishedProposalId: row.published_proposal_id || null,
      updatedOverviewRevisionId: row.updated_overview_revision_id || null,
      errorCode: row.error_code || null,
      errorMessage: row.error_message || null,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      finishedAt: row.finished_at || null,
    },
  }
})
