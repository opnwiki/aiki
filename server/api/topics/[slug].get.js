import { createHmac } from 'node:crypto'
import { createError } from 'h3'
import { getHumanActor } from '../../utils/auth.js'
import { presentAccess, readableTopicSql } from '../../utils/page-access.js'
import { reviewerCanDecide } from '../../utils/moderation.js'
import { getDatabase, queryDatabase } from '../../utils/database.js'
import { loadImportProvenance } from '../../utils/integration-imports.js'
import { ensureTopicTranslation, presentTranslation } from '../../utils/translate-page.js'
import { ensureReplyTranslations } from '../../utils/translate-replies.js'
import { ensureTagTranslations } from '../../utils/translate-tags.js'
import { getReadIdentity } from '../../utils/client-ip.js'
import { loadPageVisitors, recordPageView } from '../../utils/page-visitors.js'
import { getReadHmacSecret } from '../../utils/read-secret.js'
import { renderSafeMarkdown } from '../../utils/markdown.js'
import { remoteActorAvatarPath } from '../../utils/federation-remote-actors.js'
import { presentMedia, stripAttachmentLinks } from '../../utils/federation-media.js'
import { publicAvatarPath } from '../../utils/avatar.js'
import { presentReplyVote } from '../../utils/replies.js'
import { presentReplyClient } from '../../utils/client-label.js'
import { withShortPath } from '../../utils/page-number.js'
import { preferredLocale } from '../../utils/validation.js'
import { topicKeyPredicate } from '../../utils/page-address.js'
import { actorDisplayNameSql } from '../../utils/actor-display.js'
import { authorHiddenSql, authorVisibility } from '../../utils/author-visibility.js'

export default defineEventHandler(async (event) => {
  const slug = getRouterParam(event, 'slug')
  if (!slug || !/^[\p{L}\p{N}]+(?:-[\p{L}\p{N}]+)*$/u.test(slug)) {
    throw createError({ statusCode: 404, statusMessage: 'Topic not found' })
  }

  const topicQuery = getQuery(event)
  const originalLocale = await loadOriginalLocale(slug)
  // locale=original serves the language the page was written in; link
  // previews (Telegram, search engines) carry no language preference.
  const locale = topicQuery.locale === 'original' && originalLocale
    ? originalLocale
    : preferredLocale(topicQuery.locale)
  const replyLimitValue = Number.parseInt(String(topicQuery.repliesLimit || '100'), 10)
  const replyOffsetValue = Number.parseInt(String(topicQuery.repliesOffset || '0'), 10)
  const replyLimit = Number.isFinite(replyLimitValue) ? Math.min(Math.max(replyLimitValue, 1), 100) : 100
  const replyOffset = Number.isFinite(replyOffsetValue) ? Math.min(Math.max(replyOffsetValue, 0), 100_000) : 0
  const skipRead = String(topicQuery.skipRead || '') === 'true'
  const viewer = await getHumanActor(event)
  try {
    await ensureTopicTranslation(getDatabase(), { slug, targetLocale: locale })
  } catch (error) {
    console.error('[translation] page stayed in its source language', error.message)
  }
  const result = await queryDatabase(
      `SELECT t.id, t.slug, t.page_number, t.kind, t.status, t.author_id AS topic_author_id, t.hide_author,
            t.discussion_enabled, t.accept_replies, t.federation_outbound_mode,
            t.public_usefulness_score, t.public_usefulness_reason,
            ${authorHiddenSql('t', 'a')} AS effective_hide_author, a.show_author AS author_show_default,
            t.branch_id, t.assistant_check,
            coalesce(nullif(r.summary, ''), CASE WHEN r.source_revision_id IS NULL THEN nullif(t.summary, '') ELSE NULL END) AS summary, t.created_at,
            (SELECT count(*)::int FROM revisions revision_count WHERE revision_count.topic_id = t.id AND revision_count.locale = r.locale) AS revision_count,
            (SELECT count(*)::int FROM edit_proposals open_proposals WHERE open_proposals.topic_id = t.id AND open_proposals.status = 'open') AS open_proposal_count,
            (SELECT moderation_mode FROM nodes WHERE is_home LIMIT 1) AS moderation_mode,
            r.authorship_mode, r.model_name, r.human_contribution,
            r.id AS revision_id, r.locale, r.title, r.body_markdown, r.summary AS revision_summary, r.created_at AS revision_created_at,
            summary_update.updated_at AS summary_updated_at,
            summary_update.author_username AS summary_updated_by_username,
            summary_update.author_display_name AS summary_updated_by_display_name,
            page_classification.id AS page_classification_id,
            page_classification.status AS page_classification_status,
            page_classification.progress_percent AS page_classification_progress_percent,
            page_classification.progress_stage AS page_classification_progress_stage,
            page_classification.progress_message AS page_classification_progress_message,
            page_classification.error_code AS page_classification_error_code,
            page_classification.error_message AS page_classification_error_message,
            page_classification.result AS page_classification_result,
            a.id AS author_id, a.username AS author, ${actorDisplayNameSql('a', 'NULL')} AS author_display_name, coalesce(pc.successful_reads, 0) AS reads,
            a.public_id AS author_public_id, EXISTS (SELECT 1 FROM actor_avatars avatar WHERE avatar.actor_id = a.id AND avatar.source = ANY (CASE a.avatar_preference WHEN 'custom' THEN ARRAY['upload'] WHEN 'gravatar' THEN ARRAY['gravatar', 'statica'] ELSE ARRAY['statica'] END)) AS author_has_avatar,
            coalesce(pc.unique_web_readers, 0) AS unique_web_readers,
            coalesce(pc.unique_agents, 0) AS unique_agents,
            coalesce(v.upvotes, 0) AS upvotes, coalesce(v.downvotes, 0) AS downvotes,
            mine.value AS my_vote,
            coalesce(replies.reply_count, 0) AS reply_count,
            b.slug AS branch_slug, b.title AS branch_title,
            source_topic.id AS source_topic_id,
            source_topic.slug AS source_topic_slug,
            source_topic.page_number AS source_topic_page_number,
            source_topic.kind AS source_topic_kind,
            source_topic.status AS source_topic_status,
            source_revision.id AS source_revision_id,
            source_revision.title AS source_revision_title,
            t.federation_import_id,
            federation_import.requested_url AS federation_requested_url,
            federation_import.status AS federation_import_status,
            federation_import.public_imported AS federation_import_public_imported,
            federation_actor.actor_uri AS federation_actor_uri,
            federation_actor.acct AS federation_actor_acct,
            federation_actor.display_name AS federation_actor_display_name,
            federation_actor.id AS federation_actor_id,
            federation_actor.raw_actor->>'profileUrl' AS federation_actor_profile_url,
            EXISTS (SELECT 1 FROM federation_avatar_cache cache WHERE cache.federation_actor_id = federation_actor.id AND cache.state = 'ready' AND cache.bytes IS NOT NULL) AS federation_actor_has_avatar,
            (SELECT source_object.object_uri
               FROM federation_objects source_object
               JOIN federation_actors source_actor ON source_actor.id = source_object.actor_id AND source_actor.is_local = false
              WHERE source_object.topic_id = t.id AND source_object.reply_id IS NULL AND source_object.state = 'active'
              ORDER BY source_object.created_at LIMIT 1) AS federation_source_url
       FROM topics t
       LEFT JOIN branches b ON b.id = t.branch_id
       LEFT JOIN topics source_topic ON source_topic.id = t.source_topic_id
       LEFT JOIN revisions source_revision ON source_revision.id = t.source_revision_id
       LEFT JOIN federation_imports federation_import ON federation_import.id = t.federation_import_id
       LEFT JOIN federation_actors federation_actor ON federation_actor.id = t.federation_author_id
       JOIN LATERAL (
         SELECT revision_id
           FROM topic_current_revisions
          WHERE topic_id = t.id
          ORDER BY (locale = $2) DESC, (locale = 'en') DESC, locale
          LIMIT 1
       ) current ON true
       JOIN revisions r ON r.id = current.revision_id
       LEFT JOIN LATERAL (
         SELECT summary_revision.created_at AS updated_at,
                summary_author.username AS author_username,
                ${actorDisplayNameSql('summary_author', 'NULL')} AS author_display_name
           FROM revisions summary_revision
           LEFT JOIN revisions summary_parent ON summary_parent.id = summary_revision.parent_revision_id
           LEFT JOIN actors summary_author ON summary_author.id = summary_revision.author_id
          WHERE summary_revision.topic_id = t.id
            AND summary_revision.locale = r.locale
            AND summary_revision.summary IS DISTINCT FROM summary_parent.summary
          ORDER BY summary_revision.created_at DESC, summary_revision.id DESC
          LIMIT 1
       ) summary_update ON true
       LEFT JOIN LATERAL (
         SELECT request.id, request.status, request.progress_percent, request.progress_stage,
                request.progress_message, request.error_code, request.error_message, request.result
           FROM topic_ai_requests request
          WHERE request.topic_id = t.id AND request.request_type = 'classify_page'
          ORDER BY request.created_at DESC
          LIMIT 1
       ) page_classification ON true
       LEFT JOIN actors a ON a.id = t.author_id
       LEFT JOIN page_read_counts pc ON pc.topic_id = t.id
       LEFT JOIN LATERAL (
         SELECT count(*) FILTER (WHERE value = 1)::int AS upvotes,
                count(*) FILTER (WHERE value = -1)::int AS downvotes
           FROM all_votes WHERE target_type = 'topic' AND target_id = t.id
       ) v ON true
       LEFT JOIN votes mine
         ON mine.actor_id = $4::uuid
        AND mine.target_type = 'topic'
        AND mine.target_id = t.id
       LEFT JOIN LATERAL (
         SELECT count(*)::int AS reply_count FROM replies
          WHERE topic_id = t.id AND status = 'published'
       ) replies ON true
      WHERE ${topicKeyPredicate('t', '$1')} AND ${readableTopicSql('t', '$3')}`,
    [slug, locale, viewer?.id || null, viewer?.id || null],
  )
  const topic = result.rows[0]
  if (!topic) throw createError({ statusCode: 404, statusMessage: 'Topic not found' })
  Object.assign(topic, presentReplyVote(topic, topic.my_vote))
  topic.publicUsefulnessScore = topic.public_usefulness_score == null ? null : Number(topic.public_usefulness_score)
  topic.publicUsefulnessReason = topic.public_usefulness_reason || null
  delete topic.public_usefulness_score
  delete topic.public_usefulness_reason
  topic.assistantCheck = topic.assistant_check !== false
  topic.canToggleAssistantCheck = Boolean(viewer && ['owner', 'admin'].includes(viewer.role))
  delete topic.assistant_check
  topic.moderationMode = topic.moderation_mode === 'manual' ? 'manual' : 'community'
  delete topic.moderation_mode
  topic.canModerate = Boolean(viewer) && topic.status === 'pending' && await reviewerCanDecide(getDatabase(), viewer, { author_id: topic.topic_author_id, branch_id: topic.branch_id })
  if (viewer?.id === topic.topic_author_id || topic.canModerate || topic.canToggleAssistantCheck) {
    const check = await queryDatabase(
      `SELECT status, trigger, reason, finished_at
         FROM moderation_checks
        WHERE topic_id = $1
        ORDER BY created_at DESC
        LIMIT 1`,
      [topic.id],
    )
    topic.moderationCheck = check.rows[0] || null
  }
  Object.assign(topic, presentAccess({ status: topic.status, author_id: topic.topic_author_id }, viewer))
  topic.discussionEnabled = topic.discussion_enabled !== false
  topic.acceptReplies = topic.accept_replies !== false
  topic.federationOutboundMode = topic.federation_outbound_mode || 'auto'
  delete topic.discussion_enabled
  delete topic.accept_replies
  delete topic.federation_outbound_mode
  topic.hideAuthor = Boolean(topic.effective_hide_author)
  topic.import = await loadImportProvenance(getDatabase(), topic.id, topic.revision_id, { hideAuthor: topic.hideAuthor })
  topic.authorVisibility = authorVisibility(topic.hide_author)
  topic.authorShowDefault = topic.author_show_default !== false
  const summaryUpdatedByHidden = Boolean(topic.hideAuthor
    && topic.summary_updated_by_username
    && topic.summary_updated_by_username === topic.author)
  topic.summaryUpdatedBy = topic.summary_updated_by_username
    ? {
        username: summaryUpdatedByHidden ? null : topic.summary_updated_by_username,
        displayName: summaryUpdatedByHidden ? null : topic.summary_updated_by_display_name,
      }
    : null
  topic.summaryUpdatedByHidden = summaryUpdatedByHidden
  topic.pageClassification = topic.page_classification_id
    ? {
        id: topic.page_classification_id,
        status: topic.page_classification_status,
        progressPercent: Number(topic.page_classification_progress_percent || 0),
        progressStage: topic.page_classification_progress_stage || null,
        progressMessage: topic.page_classification_progress_message || null,
        errorCode: topic.page_classification_error_code || null,
        errorMessage: topic.page_classification_error_message || null,
        result: topic.page_classification_result || null,
      }
    : null
  topic.canEdit = Boolean(viewer && viewer.id === topic.topic_author_id)
  topic.canHideAuthor = Boolean(viewer && viewer.id === topic.topic_author_id)
  topic.author_avatar_url = !topic.hideAuthor && topic.author_has_avatar ? publicAvatarPath(topic.author_public_id) : null
  delete topic.author_has_avatar
  if (topic.hideAuthor || topic.author_public_id == null) delete topic.author_public_id
  else topic.author_public_id = String(topic.author_public_id)
  if (topic.hideAuthor) {
    topic.author = null
    topic.author_display_name = null
  }
  if (topic.hideAuthor && !topic.canHideAuthor) delete topic.author_id
  delete topic.hide_author
  delete topic.effective_hide_author
  delete topic.author_show_default
  delete topic.summary_updated_by_username
  delete topic.summary_updated_by_display_name
  delete topic.page_classification_id
  delete topic.page_classification_status
  delete topic.page_classification_progress_percent
  delete topic.page_classification_progress_stage
  delete topic.page_classification_progress_message
  delete topic.page_classification_error_code
  delete topic.page_classification_error_message
  delete topic.page_classification_result
  delete topic.status
  delete topic.topic_author_id
  delete topic.branch_id
  topic.branch = topic.branch_slug ? { slug: topic.branch_slug, title: topic.branch_title } : null
  delete topic.branch_slug
  delete topic.branch_title
  topic.sourceTopic = topic.source_topic_id
    ? {
        id: topic.source_topic_id,
        slug: topic.source_topic_slug,
        pageNumber: topic.source_topic_page_number,
        kind: topic.source_topic_kind,
        status: topic.source_topic_status,
        title: topic.source_revision_title,
        revisionId: topic.source_revision_id,
      }
    : null
  delete topic.source_topic_id
  delete topic.source_topic_slug
  delete topic.source_topic_page_number
  delete topic.source_topic_kind
  delete topic.source_topic_status
  delete topic.source_revision_id
  delete topic.source_revision_title
  // Imported threads and posts that mentioned @ask keep their Fediverse
  // author; the avatar is served by AIKI, never from the remote server.
  topic.federation = topic.federation_import_id || topic.federation_actor_uri
    ? {
        importUrl: topic.federation_requested_url || null,
        status: topic.federation_import_status || null,
        publicImported: Number(topic.federation_import_public_imported || 0),
        sourceUrl: safeHttpsUrl(topic.federation_source_url) || safeHttpsUrl(topic.federation_requested_url),
        actor: topic.federation_actor_uri
          ? {
              uri: topic.federation_actor_uri,
              acct: topic.federation_actor_acct,
              displayName: topic.federation_actor_display_name,
              profileUrl: safeHttpsUrl(topic.federation_actor_profile_url) || safeHttpsUrl(topic.federation_actor_uri),
              avatarUrl: topic.federation_actor_has_avatar ? remoteActorAvatarPath(topic.federation_actor_id) : null,
            }
          : null,
      }
    : null
  delete topic.federation_import_id
  delete topic.federation_requested_url
  delete topic.federation_import_status
  delete topic.federation_import_public_imported
  delete topic.federation_actor_uri
  delete topic.federation_actor_acct
  delete topic.federation_actor_display_name
  delete topic.federation_actor_id
  delete topic.federation_actor_profile_url
  delete topic.federation_actor_has_avatar
  delete topic.federation_source_url
  const [citations, replies, tags] = await Promise.all([
    queryDatabase(
      `SELECT s.id, s.canonical_url, s.title, s.publisher, s.published_at, c.retrieved_at, c.locator, c.note
         FROM citations c JOIN sources s ON s.id = c.source_id
        WHERE c.revision_id = $1 ORDER BY c.retrieved_at, c.id`,
      [topic.revision_id],
    ),
    queryDatabase(
      `SELECT r.id, r.parent_reply_id, r.locale, r.body_markdown, r.created_at, r.updated_at, r.client_label, r.author_hidden,
              r.federation_author_id, r.federation_source_url, r.federation_delivery_state,
              a.id AS author_id, a.username AS author, ${actorDisplayNameSql('a', 'NULL')} AS author_display_name, a.kind AS author_kind, a.show_client,
              a.public_id AS author_public_id, EXISTS (SELECT 1 FROM actor_avatars avatar WHERE avatar.actor_id = a.id AND avatar.source = ANY (CASE a.avatar_preference WHEN 'custom' THEN ARRAY['upload'] WHEN 'gravatar' THEN ARRAY['gravatar', 'statica'] ELSE ARRAY['statica'] END)) AS author_has_avatar,
              federation_reply_actor.actor_uri AS federation_actor_uri,
              federation_reply_actor.acct AS federation_actor_acct,
              federation_reply_actor.display_name AS federation_actor_display_name,
              federation_reply_actor.raw_actor->>'profileUrl' AS federation_actor_profile_url,
              EXISTS (SELECT 1 FROM federation_avatar_cache cache WHERE cache.federation_actor_id = federation_reply_actor.id AND cache.state = 'ready' AND cache.bytes IS NOT NULL) AS federation_actor_has_avatar,
              coalesce(v.upvotes, 0) AS upvotes, coalesce(v.downvotes, 0) AS downvotes,
              mine.value AS my_vote,
              reply_citations.citations,
              media_object.id AS federation_object_id, media_object.raw_object AS federation_raw_object
         FROM replies r
         LEFT JOIN actors a ON a.id = r.author_id
         LEFT JOIN federation_actors federation_reply_actor ON federation_reply_actor.id = r.federation_author_id
         LEFT JOIN LATERAL (
           SELECT coalesce(json_agg(json_build_object(
             'id', c.id,
             'canonical_url', s.canonical_url,
             'title', s.title,
             'publisher', s.publisher,
             'published_at', s.published_at,
             'retrieved_at', c.retrieved_at,
             'locator', c.locator,
             'note', c.note
           ) ORDER BY c.retrieved_at, c.id), '[]'::json) AS citations
             FROM citations c JOIN sources s ON s.id = c.source_id
            WHERE c.reply_id = r.id
         ) reply_citations ON true
         LEFT JOIN LATERAL (
           SELECT fo.id, fo.raw_object FROM federation_objects fo
            WHERE fo.reply_id = r.id AND fo.state = 'active'
            ORDER BY fo.created_at LIMIT 1
         ) media_object ON r.federation_author_id IS NOT NULL
         LEFT JOIN LATERAL (
           SELECT count(*) FILTER (WHERE value = 1)::int AS upvotes,
                  count(*) FILTER (WHERE value = -1)::int AS downvotes
             FROM all_votes WHERE target_type = 'reply' AND target_id = r.id
         ) v ON true
         LEFT JOIN votes mine
           ON mine.actor_id = $2::uuid
          AND mine.target_type = 'reply'
          AND mine.target_id = r.id
        WHERE r.topic_id = $1 AND r.status = 'published'
        ORDER BY r.created_at ASC, r.id ASC LIMIT $3 OFFSET $4`,
      [topic.id, viewer?.id || null, replyLimit, replyOffset],
    ),
    queryDatabase(
      `SELECT tg.id, tg.slug, tg.label
         FROM topic_tags tt JOIN tags tg ON tg.id = tt.tag_id
        WHERE tt.topic_id = $1
        ORDER BY tt.position`,
      [topic.id],
    ),
  ])
  const replyTranslations = await ensureReplyTranslations(getDatabase(), replies.rows, locale)
  const translatedTags = await ensureTagTranslations(getDatabase(), tags.rows, {
    sourceLocale: originalLocale || topic.locale,
    targetLocale: locale,
  })

  topic.translation = await presentTranslation(getDatabase(), {
    topicId: topic.id,
    revisionId: topic.revision_id,
    title: topic.title,
    body: topic.body_markdown,
    summary: topic.summary,
  })
  if (!topic.translation && topic.locale !== locale) {
    topic.translation = { status: 'unavailable', requestedLocale: locale, sourceLocale: topic.locale }
  }
  topic.html = renderSafeMarkdown(topic.body_markdown, { citations: citations.rows })
  topic.citations = citations.rows
  topic.tags = translatedTags
  topic.replies_offset = replyOffset
  topic.replies_limit = replyLimit
  topic.replies_has_more = Number(topic.reply_count || 0) > replyOffset + replies.rows.length
  topic.replies = replies.rows.map(reply => {
    const canEdit = Boolean(viewer?.id && viewer.id === reply.author_id)
    const totals = presentReplyVote(reply, reply.my_vote)
    const translation = replyTranslations.get(reply.id) || null
    const presented = reply.author_hidden
      ? { author_kind: 'human', client: null }
      : presentReplyClient(reply)
    const publicReply = { ...reply }
    publicReply.canEdit = canEdit
    publicReply.anonymous = Boolean(reply.author_hidden)
    delete publicReply.client_label
    delete publicReply.show_client
    delete publicReply.author_kind
    delete publicReply.author_hidden
    delete publicReply.federation_author_id
    delete publicReply.federation_source_url
    delete publicReply.federation_delivery_state
    delete publicReply.federation_actor_uri
    delete publicReply.federation_actor_acct
    delete publicReply.federation_actor_display_name
    delete publicReply.federation_actor_profile_url
    delete publicReply.federation_actor_has_avatar
    delete publicReply.federation_object_id
    delete publicReply.federation_raw_object
    // Attached pictures are shown under the text, not as links to the remote server.
    const media = reply.federation_object_id ? presentMedia(reply.federation_object_id, reply.federation_raw_object) : []
    const bodyWithoutMedia = (body) => media.length ? stripAttachmentLinks(body, reply.federation_raw_object) : body
    publicReply.author_avatar_url = !reply.author_hidden && reply.author_has_avatar ? publicAvatarPath(reply.author_public_id) : null
    delete publicReply.author_has_avatar
    if (reply.author_hidden || publicReply.author_public_id == null) delete publicReply.author_public_id
    else publicReply.author_public_id = String(publicReply.author_public_id)
    if (reply.author_hidden) {
      publicReply.author_id = null
      publicReply.author = null
      publicReply.anonymous = true
    }
    return {
      ...publicReply,
      federation: reply.federation_author_id
        ? {
            actor: reply.federation_actor_uri
              ? {
                  uri: reply.federation_actor_uri,
                  acct: reply.federation_actor_acct,
                  displayName: reply.federation_actor_display_name,
                  profileUrl: safeHttpsUrl(reply.federation_actor_profile_url) || safeHttpsUrl(reply.federation_actor_uri),
                  avatarUrl: reply.federation_actor_has_avatar ? remoteActorAvatarPath(reply.federation_author_id) : null,
                }
              : null,
            sourceUrl: reply.federation_source_url || null,
            deliveryState: reply.federation_delivery_state || 'none',
            media,
          }
        : null,
      ...totals,
      ...presented,
      html: renderSafeMarkdown(bodyWithoutMedia(translation?.body_markdown || reply.body_markdown)),
      original_html: translation ? renderSafeMarkdown(bodyWithoutMedia(reply.body_markdown)) : null,
      translation: translation
        ? {
            status: 'ready',
            sourceLocale: translation.sourceLocale || reply.locale,
            targetLocale: locale,
            provider: translation.provider,
          }
        : reply.locale !== locale
          ? { status: 'unavailable', sourceLocale: reply.locale, targetLocale: locale }
          : null,
    }
  })

  const counts = skipRead ? null : await recordTopicRead(event, topic.id)
  if (counts) Object.assign(topic, counts)
  const locales = await queryDatabase(
    'SELECT locale FROM topic_current_revisions WHERE topic_id = $1 ORDER BY locale',
    [topic.id],
  )
  topic.original_locale = originalLocale || topic.locale
  topic.available_locales = locales.rows.map(row => row.locale)
  return withShortPath(topic)
})

async function recordTopicRead(event, topicId) {
  const config = useRuntimeConfig()
  const secret = getReadHmacSecret(config)
  const client = await getDatabase().connect()
  try {
    await client.query('BEGIN')
    await recordPageView(client, topicId, event.node.req.headers['user-agent'])
    const incremented = await client.query(
      `UPDATE page_read_counts
          SET successful_reads = successful_reads + 1
        WHERE topic_id = $1
        RETURNING successful_reads`,
      [topicId],
    )
    if (incremented.rowCount !== 1) throw new Error('Read counter row is missing for published topic')

    if (secret) {
      const { readerType, identity } = getReadIdentity(
        event.node.req.headers,
        event.node.req.socket?.remoteAddress,
      )
      const digest = createHmac('sha256', String(secret)).update(`${readerType}\0${identity}`).digest('hex')

      const inserted = identity === 'unknown'
        ? { rowCount: 0 }
        : await client.query(
            `INSERT INTO topic_readers (topic_id, reader_type, reader_hash)
             VALUES ($1, $2, $3)
             ON CONFLICT DO NOTHING
             RETURNING topic_id`,
            [topicId, readerType, digest],
          )
      if (inserted.rowCount > 0) {
        const column = readerType === 'agent' ? 'unique_agents' : 'unique_web_readers'
        await client.query(`UPDATE page_read_counts SET ${column} = ${column} + 1 WHERE topic_id = $1`, [topicId])
      }
    }
    const counts = await client.query(
      'SELECT successful_reads AS reads, unique_web_readers, unique_agents FROM page_read_counts WHERE topic_id = $1',
      [topicId],
    )
    const visitors = await loadPageVisitors(client, topicId)
    await client.query('COMMIT')
    return { ...(counts.rows[0] || {}), visitors }
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
}

// The first revision's language is the language the page was written in.
async function loadOriginalLocale(slug) {
  const result = await queryDatabase(
    `SELECT r.locale
       FROM topics t
       JOIN revisions r ON r.topic_id = t.id
      WHERE ${topicKeyPredicate('t', '$1')}
      ORDER BY r.created_at ASC, r.id ASC
      LIMIT 1`,
    [slug],
  )
  return result.rows[0]?.locale || null
}

function safeHttpsUrl(value) {
  try {
    const url = new URL(String(value || ''))
    return url.protocol === 'https:' ? url.href : null
  } catch {
    return null
  }
}
