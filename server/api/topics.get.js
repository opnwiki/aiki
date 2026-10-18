import { createError } from 'h3'
import { queryDatabase } from '../utils/database.js'
import { validateTags } from '../utils/tags.js'
import { withShortPath } from '../utils/page-number.js'
import { normalizeBranchSlug, preferredLocale } from '../utils/validation.js'
import { actorDisplayNameSql } from '../utils/actor-display.js'
import { authorHiddenSql } from '../utils/author-visibility.js'

export default defineEventHandler(async (event) => {
  const query = getQuery(event)
  const search = String(query.q || '').trim().slice(0, 160)
  const kind = ['page', 'article', 'question', 'discussion', 'message'].includes(String(query.kind || '')) ? String(query.kind) : ''
  const branch = normalizeBranchSlug(query.branch || '') || ''
  const locale = preferredLocale(query.locale)
  const requestedLimit = Number.parseInt(String(query.limit || '20'), 10)
  const requestedOffset = Number.parseInt(String(query.offset || '0'), 10)
  const limit = Number.isFinite(requestedLimit) ? Math.min(Math.max(requestedLimit, 1), 50) : 20
  const offset = Number.isFinite(requestedOffset) ? Math.min(Math.max(requestedOffset, 0), 100_000) : 0
  const includeTasks = String(query.includeTasks || 'true') !== 'false'
  const requestedSort = String(query.sort || 'new')
  const sort = ['new', 'hot', 'best', 'worst'].includes(requestedSort) ? requestedSort : 'new'
  const rawTags = String(query.tags ?? query.tag ?? '')
    .split(',')
    .map(value => value.trim())
    .filter(Boolean)
    .slice(0, 8)
  const checkedTags = validateTags(rawTags)
  if (!checkedTags.ok) throw createError({ statusCode: 400, statusMessage: 'Choose valid topic tags.' })
  const tagSlugs = checkedTags.value.map(tag => tag.slug)

  const result = await queryDatabase(
    `WITH matching_items AS (
       SELECT t.id, t.slug, t.kind, t.created_at, r.title, r.body_markdown,
              CASE WHEN ${authorHiddenSql('t', 'a')} THEN NULL ELSE ${actorDisplayNameSql('a')} END AS author, coalesce(pc.successful_reads, 0) AS reads,
              coalesce(v.upvotes, 0) AS upvotes,
              coalesce(v.downvotes, 0) AS downvotes,
              coalesce(v.upvotes, 0) - coalesce(v.downvotes, 0) AS score,
              coalesce(v.vote_count, 0) AS vote_count,
              coalesce(replies.reply_count, 0) AS reply_count,
              GREATEST(t.created_at, coalesce(v.last_vote_at, t.created_at), coalesce(replies.last_reply_at, t.created_at)) AS last_activity_at,
              'topic'::text AS result_type, NULL::text AS task_status,
              NULL::text AS task_locale, b.slug AS branch_slug, b.title AS branch_title,
              COALESCE((
                SELECT json_agg(json_build_object('slug', tg.slug, 'label', tg.label) ORDER BY tt.position)
                  FROM topic_tags tt JOIN tags tg ON tg.id = tt.tag_id
                 WHERE tt.topic_id = t.id
              ), '[]'::json) AS tags,
              t.page_number
         FROM topics t
         LEFT JOIN branches b ON b.id = t.branch_id
         JOIN LATERAL (
           SELECT revision_id
             FROM topic_current_revisions
            WHERE topic_id = t.id
            ORDER BY (locale = $6) DESC, (locale = 'en') DESC, locale
            LIMIT 1
         ) current ON true
         JOIN revisions r ON r.id = current.revision_id
         LEFT JOIN actors a ON a.id = t.author_id
         LEFT JOIN page_read_counts pc ON pc.topic_id = t.id
         LEFT JOIN LATERAL (
           SELECT count(*) FILTER (WHERE value = 1)::int AS upvotes,
                  count(*) FILTER (WHERE value = -1)::int AS downvotes,
                  count(*)::int AS vote_count,
                  max(created_at) AS last_vote_at
             FROM all_votes
            WHERE target_type = 'topic' AND target_id = t.id
         ) v ON true
         LEFT JOIN LATERAL (
           SELECT count(*)::int AS reply_count, max(created_at) AS last_reply_at FROM replies
            WHERE topic_id = t.id AND status = 'published'
         ) replies ON true
        WHERE t.status = 'published'
          AND ($1 = '' OR r.title ILIKE '%' || $1 || '%' OR r.body_markdown ILIKE '%' || $1 || '%')
          AND ($2 = '' OR t.kind = $2)
          AND ($3 = '' OR b.slug = $3)
          AND (cardinality($9::text[]) = 0 OR (
            SELECT count(DISTINCT filtered_tag.slug)
              FROM topic_tags filtered_tt
              JOIN tags filtered_tag ON filtered_tag.id = filtered_tt.tag_id
             WHERE filtered_tt.topic_id = t.id AND filtered_tag.slug = ANY($9::text[])
          ) = cardinality($9::text[]))

       UNION ALL

       SELECT task.id, NULL::text AS slug, coalesce(submission.kind, 'article') AS kind,
              task.created_at, coalesce(submission.title, assessment.query_text) AS title,
              coalesce(submission.body_markdown, assessment.query_text) AS body_markdown,
              coalesce(${actorDisplayNameSql('claimant')}, task.claim_actor_label, 'community') AS author,
              0::bigint AS reads, 0::bigint AS upvotes, 0::bigint AS downvotes, 0::bigint AS score,
              0::bigint AS vote_count, 0::bigint AS reply_count, task.created_at AS last_activity_at,
              'task'::text AS result_type, task.status AS task_status,
              assessment.locale AS task_locale, NULL::text AS branch_slug, NULL::text AS branch_title,
              '[]'::json AS tags,
              NULL::bigint AS page_number
         FROM article_writing_tasks task
         JOIN article_order_submissions orders ON orders.id = task.order_id
         JOIN article_order_assessments assessment ON assessment.id = orders.assessment_id
         LEFT JOIN article_writing_submissions submission ON submission.id = task.current_submission_id
         LEFT JOIN actors claimant ON claimant.id = task.claimed_by
        WHERE task.status IN ('open', 'claimed', 'submitted')
          AND orders.execution_state = 'community'
          AND assessment.locale = 'en'
          AND ($1 = '' OR assessment.query_text ILIKE '%' || $1 || '%'
               OR submission.title ILIKE '%' || $1 || '%'
               OR submission.body_markdown ILIKE '%' || $1 || '%')
          AND ($2 = '' OR coalesce(submission.kind, 'article') = $2)
          AND $3 = ''
          AND cardinality($9::text[]) = 0
     )
     SELECT id, slug, kind, created_at, title, body_markdown, author, reads,
            upvotes, downvotes, score, reply_count, result_type, task_status, task_locale, branch_slug, branch_title,
            tags, page_number
       FROM matching_items
      WHERE ($7 OR result_type = 'topic')
        AND ($8 <> 'worst' OR score < 0)
        AND ($8 <> 'hot' OR (result_type = 'topic' AND (vote_count > 0 OR reply_count > 0)))
      ORDER BY CASE WHEN $8 = 'hot' THEN (
                 GREATEST(score, 0) * 5
                 + reply_count * 8
                 + LN(1 + LEAST(reads, 1000)::numeric) * 3
               ) * EXP(-GREATEST(EXTRACT(EPOCH FROM (now() - last_activity_at)) / 3600.0, 0) / 120.0) ELSE 0 END DESC,
               CASE WHEN $8 = 'hot' THEN last_activity_at ELSE created_at END DESC,
               CASE WHEN $8 = 'best' THEN score ELSE 0 END DESC,
               CASE WHEN $8 = 'worst' THEN score ELSE 0 END ASC,
               created_at DESC, result_type ASC, id DESC
      LIMIT $4 OFFSET $5`,
    [search, kind, branch, limit, offset, locale, includeTasks, sort, tagSlugs],
  )
  const countResult = await queryDatabase(
    `SELECT (
       (SELECT count(DISTINCT t.id)::int
          FROM topics t
          JOIN LATERAL (
           SELECT revision_id
             FROM topic_current_revisions
            WHERE topic_id = t.id
            ORDER BY (locale = $4) DESC, (locale = 'en') DESC, locale
            LIMIT 1
         ) current ON true
          JOIN revisions r ON r.id = current.revision_id
         WHERE t.status = 'published'
           AND ($1 = '' OR r.title ILIKE '%' || $1 || '%' OR r.body_markdown ILIKE '%' || $1 || '%')
           AND ($2 = '' OR t.kind = $2)
           AND ($3 = '' OR EXISTS (SELECT 1 FROM branches b WHERE b.id = t.branch_id AND b.slug = $3))
           AND ($7 <> 'worst' OR coalesce((SELECT sum(value) FROM votes WHERE target_type = 'topic' AND target_id = t.id), 0) < 0)
           AND (cardinality($6::text[]) = 0 OR (
             SELECT count(DISTINCT filtered_tag.slug)
               FROM topic_tags filtered_tt
               JOIN tags filtered_tag ON filtered_tag.id = filtered_tt.tag_id
              WHERE filtered_tt.topic_id = t.id AND filtered_tag.slug = ANY($6::text[])
           ) = cardinality($6::text[])))
       +
       (SELECT count(*)::int
          FROM article_writing_tasks task
          JOIN article_order_submissions orders ON orders.id = task.order_id
          JOIN article_order_assessments assessment ON assessment.id = orders.assessment_id
          LEFT JOIN article_writing_submissions submission ON submission.id = task.current_submission_id
         WHERE task.status IN ('open', 'claimed', 'submitted')
           AND orders.execution_state = 'community'
           AND assessment.locale = 'en'
           AND ($1 = '' OR assessment.query_text ILIKE '%' || $1 || '%'
                OR submission.title ILIKE '%' || $1 || '%'
                OR submission.body_markdown ILIKE '%' || $1 || '%')
           AND ($2 = '' OR coalesce(submission.kind, 'article') = $2)
           AND $5
           AND $7 <> 'worst'
           AND $3 = ''
           AND cardinality($6::text[]) = 0)
     )::int AS total`,
    [search, kind, branch, locale, includeTasks, tagSlugs, sort],
  )

  return {
    items: result.rows.map(withShortPath),
    query: search,
    kind,
    branch,
    tags: tagSlugs,
    sort,
    includeTasks,
    limit,
    offset,
    total: countResult.rows[0]?.total || 0,
  }
})
