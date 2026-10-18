import { createError } from 'h3'
import { getHumanActor } from '../../../../../utils/auth.js'
import { queryDatabase } from '../../../../../utils/database.js'
import { readableTopicSql } from '../../../../../utils/page-access.js'
import { createLineDiff } from '../../../../../utils/revision-diff.js'
import { topicKeyPredicate } from '../../../../../utils/page-address.js'

export default defineEventHandler(async (event) => {
  const slug = getRouterParam(event, 'slug')
  const proposalId = getRouterParam(event, 'proposalId')
  if (!slug || !/^[\p{L}\p{N}]+(?:-[\p{L}\p{N}]+)*$/u.test(slug)
    || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(proposalId || '')) {
    throw createError({ statusCode: 404, statusMessage: 'Proposal not found.' })
  }

  const viewer = await getHumanActor(event)
  const result = await queryDatabase(
    `SELECT p.id, p.locale, p.proposed_title, p.proposed_body_markdown, p.rationale,
            p.base_revision_id, p.status, p.reviewed_at, p.review_comment, p.result_revision_id,
            reviewer.username AS reviewer, base.title AS base_title, base.body_markdown AS base_body
       FROM topics t
       JOIN edit_proposals p ON p.topic_id = t.id
       JOIN revisions base ON base.id = p.base_revision_id AND base.topic_id = p.topic_id AND base.locale = p.locale
       LEFT JOIN actors reviewer ON reviewer.id = p.reviewed_by_actor_id
      WHERE ${topicKeyPredicate('t', '$1')} AND t.kind = 'article'
        AND ${readableTopicSql('t', '$3')}
        AND p.id = $2
      LIMIT 1`,
    [slug, proposalId, viewer?.id || null],
  )
  const proposal = result.rows[0]
  if (!proposal) throw createError({ statusCode: 404, statusMessage: 'Open proposal not found.' })

  return {
    id: proposal.id,
    locale: proposal.locale,
    status: proposal.status,
    rationale: proposal.rationale,
    review: proposal.reviewed_at
      ? {
          reviewedAt: proposal.reviewed_at,
          reviewer: proposal.reviewer,
          comment: proposal.review_comment,
          resultRevisionId: proposal.result_revision_id,
        }
      : null,
    baseRevisionId: proposal.base_revision_id,
    title: {
      before: proposal.base_title,
      after: proposal.proposed_title || proposal.base_title,
      changed: Boolean(proposal.proposed_title && proposal.proposed_title !== proposal.base_title),
    },
    body: createLineDiff(proposal.base_body, proposal.proposed_body_markdown),
  }
})
