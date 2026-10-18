import { createError, readBody } from 'h3'
import { enforceSameOrigin, requireHumanActor } from '../../../../utils/auth.js'
import { getDatabase } from '../../../../utils/database.js'
import { notifyProposalReview } from '../../../../utils/notifications.js'
import { recordRevisionDiff } from '../../../../utils/revision-history.js'
import { enforceRateLimit } from '../../../../utils/rate-limit.js'
import { loadArticleRuleOverrides, reviewArticle, rulesReviewError } from '../../../../utils/article-rules.js'
import { topicKeyPredicate } from '../../../../utils/page-address.js'
import { checkPageContent } from '../../../../utils/moderation.js'
import { validateArticleOverview } from '../../../../utils/validation.js'
import { markHumanReviewedAuthorship } from '../../../../utils/authorship.js'

const REVIEW_ACTIONS = new Set(['accept', 'reject'])
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export default defineEventHandler(async (event) => {
  enforceSameOrigin(event)
  const slug = getRouterParam(event, 'slug')
  const proposalId = getRouterParam(event, 'proposalId')
  if (!slug || !/^[\p{L}\p{N}]+(?:-[\p{L}\p{N}]+)*$/u.test(slug) || !UUID_PATTERN.test(proposalId || '')) {
    throw createError({ statusCode: 404, statusMessage: 'Proposal not found.' })
  }

  const actor = await requireHumanActor(event)
  await enforceRateLimit(event, { action: 'proposal-review', limit: 20 })
  const input = await readBody(event)
  const action = String(input?.action || '')
  const comment = cleanComment(input?.comment)
  if (!REVIEW_ACTIONS.has(action) || comment.length < 8 || comment.length > 2_000) {
    throw createError({ statusCode: 400, statusMessage: 'Choose accept or reject and provide a review comment of 8–2000 characters.' })
  }

  const client = await getDatabase().connect()
  let outcome
  let acceptedArticle = null
  try {
    await client.query('BEGIN')
    const selected = await client.query(
      `SELECT p.id, p.topic_id, p.base_revision_id, p.author_id, p.locale, p.proposal_type,
              p.proposed_title, p.proposed_summary, p.proposed_body_markdown, p.source_task_id,
              p.status, p.created_at, t.kind, t.status AS topic_status, t.author_id AS topic_author_id,
              current.revision_id AS current_revision_id
         FROM edit_proposals p
         JOIN topics t ON t.id = p.topic_id
         JOIN topic_current_revisions current ON current.topic_id = p.topic_id AND current.locale = p.locale
        WHERE ${topicKeyPredicate('t', '$1')} AND p.id = $2
        FOR UPDATE OF p, t, current`,
      [slug, proposalId],
    )
    const proposal = selected.rows[0]
    const staff = ['owner', 'admin', 'moderator'].includes(actor.role)
    const topicVisible = proposal && (proposal.topic_status === 'published' || proposal.topic_status === 'unlisted' || (proposal.topic_status === 'hidden' && proposal.topic_author_id === actor.id) || (proposal.topic_status === 'pending' && (proposal.topic_author_id === actor.id || staff)))
    if (!proposal || !topicVisible || (proposal.kind !== 'article' && proposal.proposal_type !== 'overview')) {
      throw createError({ statusCode: 404, statusMessage: 'Open proposal not found.' })
    }
    const authorCanDecideOverview = proposal.proposal_type === 'overview' && proposal.topic_author_id === actor.id
    if (!['owner', 'admin', 'moderator'].includes(actor.role) && !authorCanDecideOverview) {
      throw createError({ statusCode: 403, statusMessage: 'A moderator must review this proposal.' })
    }
    if (proposal.proposal_type !== 'overview' && proposal.author_id && actor.id === proposal.author_id) {
      throw createError({ statusCode: 403, statusMessage: 'You cannot review your own proposal.' })
    }
    if (proposal.status !== 'open') {
      throw createError({ statusCode: 409, statusMessage: 'This proposal has already been reviewed.' })
    }
    if (action === 'accept' && proposal.current_revision_id !== proposal.base_revision_id) {
      throw createError({ statusCode: 409, statusMessage: 'The page has changed since this proposal was submitted. Rebase the proposal before accepting it.' })
    }

    let resultRevisionId = null
    if (action === 'accept') {
      const parent = await client.query(
        `SELECT r.title, r.body_markdown, r.summary, r.authorship_mode, r.model_name, r.human_contribution
           FROM revisions r
          WHERE r.id = $1 AND r.topic_id = $2 AND r.locale = $3
          FOR UPDATE`,
        [proposal.base_revision_id, proposal.topic_id, proposal.locale],
      )
      if (!parent.rows[0]) throw createError({ statusCode: 409, statusMessage: 'The proposal base revision is unavailable.' })
      if (proposal.proposal_type === 'overview') {
        const overview = validateArticleOverview(proposal.proposed_summary)
        if (!overview.ok || !overview.value || overview.value.length < 20) throw createError({ statusCode: 409, statusMessage: 'This overview proposal is invalid.' })
      } else {
        const rules = reviewArticle({
          title: proposal.proposed_title || parent.rows[0].title,
          body: proposal.proposed_body_markdown,
        }, await loadArticleRuleOverrides(client), { scope: 'text' })
        if (!rules.ok) throw rulesReviewError(rules.findings)
      }
      const inserted = await client.query(
        `INSERT INTO revisions (
           topic_id, parent_revision_id, author_id, locale, title, body_markdown, summary,
           authorship_mode, model_name, human_contribution
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         RETURNING id`,
        [proposal.topic_id, proposal.base_revision_id, actor.id, proposal.locale,
          proposal.proposed_title || parent.rows[0].title, proposal.proposed_body_markdown,
          // revisions.summary is the page overview; a body edit keeps it.
          proposal.proposal_type === 'overview' ? proposal.proposed_summary : (parent.rows[0].summary ?? null),
          markHumanReviewedAuthorship(parent.rows[0].authorship_mode || 'legacy_undisclosed', true),
          parent.rows[0].model_name, parent.rows[0].human_contribution],
      )
      resultRevisionId = inserted.rows[0].id
      acceptedArticle = {
        topicId: proposal.topic_id,
        title: proposal.proposed_title || parent.rows[0].title,
        body: proposal.proposed_body_markdown,
      }
      await recordRevisionDiff(client, {
        revisionId: resultRevisionId,
        parentRevisionId: proposal.base_revision_id,
        parentTitle: parent.rows[0].title,
        parentBody: parent.rows[0].body_markdown,
        title: proposal.proposed_title || parent.rows[0].title,
        body: proposal.proposed_body_markdown,
        origin: 'accepted_edit',
        introducedBy: proposal.author_id,
        confirmedBy: actor.id,
        introducedAt: proposal.created_at,
        proposalId: proposal.id,
      })
      const moved = await client.query(
        `UPDATE topic_current_revisions SET revision_id = $1
          WHERE topic_id = $2 AND locale = $3 AND revision_id = $4`,
        [resultRevisionId, proposal.topic_id, proposal.locale, proposal.base_revision_id],
      )
      if (moved.rowCount !== 1) throw createError({ statusCode: 409, statusMessage: 'The page changed during review. Reload and try again.' })
      if (proposal.proposal_type === 'overview') {
        await client.query(
          `UPDATE topics SET summary = $1, updated_at = now() WHERE id = $2`,
          [proposal.proposed_summary, proposal.topic_id],
        )
      }
      await client.query(
        `INSERT INTO citations (topic_id, source_id, revision_id, locator, note)
         SELECT topic_id, source_id, $2, locator, note FROM citations WHERE revision_id = $1`,
        [proposal.base_revision_id, resultRevisionId],
      )
      const proposedSources = await client.query(
        `SELECT url, title, publisher, locator, note
           FROM edit_proposal_sources
          WHERE proposal_id = $1
          ORDER BY position`,
        [proposal.id],
      )
      for (const source of proposedSources.rows) {
        const saved = await client.query(
          `INSERT INTO sources (canonical_url, title, publisher, source_type, published_at)
           VALUES ($1, NULLIF($2::text, ''), NULLIF($3::text, ''), 'external', $4::date)
           ON CONFLICT (canonical_url) DO UPDATE SET
             title = coalesce(sources.title, EXCLUDED.title),
             publisher = coalesce(sources.publisher, EXCLUDED.publisher),
             published_at = coalesce(sources.published_at, EXCLUDED.published_at)
           RETURNING id`,
          [source.url, source.title, source.publisher, source.publishedAt || null],
        )
        await client.query(
          `INSERT INTO citations (topic_id, source_id, revision_id, locator, note)
           VALUES ($1, $2, $3, NULLIF($4::text, ''), NULLIF($5::text, ''))`,
          [proposal.topic_id, saved.rows[0].id, resultRevisionId, source.locator, source.note],
        )
      }
    }

    const updated = await client.query(
      `UPDATE edit_proposals
          SET status = $1, reviewed_at = now(), reviewed_by_actor_id = $2,
              review_comment = $3, result_revision_id = $4::uuid
        WHERE id = $5 AND status = 'open'
        RETURNING id, topic_id, status, reviewed_at, reviewed_by_actor_id, review_comment, result_revision_id`,
      [action === 'accept' ? 'accepted' : 'rejected', actor.id, comment, resultRevisionId, proposal.id],
    )
    if (updated.rowCount !== 1) throw createError({ statusCode: 409, statusMessage: 'This proposal was reviewed concurrently. Reload the page.' })
    if (proposal.source_task_id && proposal.proposal_type === 'overview') {
      await client.query(
        `UPDATE article_writing_tasks
            SET status = $1,
                current_submission_id = CASE WHEN $1 = 'accepted' THEN current_submission_id ELSE NULL END,
                claimed_by = NULL, claim_actor_label = NULL, claim_expires_at = NULL,
                automation_lease_until = NULL, updated_at = now()
          WHERE id = $2 AND task_type = 'overview'`,
        [action === 'accept' ? 'accepted' : 'open', proposal.source_task_id],
      )
    }
    await client.query(
      `INSERT INTO actor_audit_log (actor_id, action, target_type, target_id, details)
       VALUES ($1, $2, 'edit_proposal', $3, jsonb_build_object('topic_id', $4::text, 'result_revision_id', $5::text, 'comment', $6::text))`,
      [actor.id, action === 'accept' ? 'edit_proposal_accepted' : 'edit_proposal_rejected', proposal.id,
        proposal.topic_id, resultRevisionId, comment],
    )
    outcome = updated.rows[0]
    await notifyProposalReview(client, {
      topicId: proposal.topic_id,
      proposalId: proposal.id,
      authorId: proposal.author_id,
      reviewerId: actor.id,
      accepted: action === 'accept',
    })
    await client.query('COMMIT')
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
  if (acceptedArticle) {
    await checkPageContent(getDatabase(), {
      topicId: acceptedArticle.topicId,
      trigger: 'change',
      article: { title: acceptedArticle.title, body: acceptedArticle.body },
    })
  }
  return { proposal: outcome }
})

function cleanComment(value) {
  return String(value ?? '').replace(/\0/g, '').trim()
}
