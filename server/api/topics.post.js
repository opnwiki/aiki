import { createError, readBody, setResponseStatus } from 'h3'
import { notifyMentions } from '../utils/notifications.js'
import { enforceSameOrigin, requireHumanActor } from '../utils/auth.js'
import { getDatabase } from '../utils/database.js'
import { branchConflict, createBranch, findBranchBySlug } from '../utils/branches.js'
import { allocateTopicSlug } from '../utils/page-address.js'
import { withShortPath } from '../utils/page-number.js'
import { normalizeBranchSlug, validateArticleOverview, validateCitation, validateTopic } from '../utils/validation.js'
import { validateAuthorship } from '../utils/authorship.js'
import { enforceContentQuota, enforceRateLimit } from '../utils/rate-limit.js'
import { recordRevisionDiff } from '../utils/revision-history.js'
import { loadArticleRuleOverrides, reviewArticle, rulesConsentError, rulesReviewError } from '../utils/article-rules.js'
import { checkPageContent, openingTopicStatus } from '../utils/moderation.js'
import { attachTopicTags, validateTags } from '../utils/tags.js'
import { ensureContentTasks } from '../utils/content-tasks.js'
import { notifySearchDiscovery } from '../utils/search-discovery.js'

export default defineEventHandler(async (event) => {
  enforceSameOrigin(event)
  const config = useRuntimeConfig()
  const actor = await requireHumanActor(event)
  await enforceRateLimit(event, { action: 'topic-create', limit: 10, actor })
  await enforceContentQuota(event, actor, 'page')

  const body = await readBody(event)
  const unknownKey = Object.keys(body || {}).find(key => !['title', 'body', 'kind', 'locale', 'source', 'sources', 'authorshipMode', 'modelName', 'humanContribution', 'branchSlug', 'newBranch', 'rulesConsent', 'slug', 'overview', 'access', 'anonymous', 'hideAuthor', 'tags', 'discussionEnabled', 'acceptReplies', 'federationOutboundMode'].includes(key))
  if (unknownKey) throw createError({ statusCode: 400, statusMessage: `Unknown topic field: ${unknownKey}` })
  const authorVisibilityOverride = readAuthorVisibilityOverride(body)
  const branchChoice = readBranchChoice(body)
  const checked = validateTopic(body)
  if (!checked.ok) throw createError({ statusCode: 400, statusMessage: 'Please correct the topic details.', data: { errors: checked.errors } })
  const overview = validateArticleOverview(body?.overview)
  if (!overview.ok) throw createError({ statusCode: 400, statusMessage: overview.error || 'Please correct the page overview.' })
  const checkedTags = validateTags(body?.tags)
  if (!checkedTags.ok) throw createError({ statusCode: 400, statusMessage: 'Please correct the topic tags.', data: { errors: checkedTags.errors } })
  const discussionControls = readDiscussionControls(body)

  let disclosure = null
  let citations = []
  if (checked.value.kind === 'article') {
    disclosure = validateAuthorship(body)
    if (!disclosure.ok) throw createError({ statusCode: 400, statusMessage: 'Please disclose article authorship and AI model use.', data: { errors: disclosure.errors } })
    if (!Array.isArray(body.sources) || body.sources.length < 1 || body.sources.length > 20) {
      throw createError({ statusCode: 400, statusMessage: 'An article must include 1–20 information sources.' })
    }
    citations = body.sources.map(validateCitation)
    const invalidSource = citations.findIndex(source => !source.ok)
    if (invalidSource >= 0) throw createError({ statusCode: 400, statusMessage: `Please correct source ${invalidSource + 1}.`, data: { errors: citations[invalidSource].errors } })
    if (body.rulesConsent !== true) throw rulesConsentError()
    const rules = reviewArticle({
      title: checked.value.title,
      body: checked.value.body,
      sources: citations.map(source => source.value),
      authorshipMode: disclosure.value.authorshipMode,
      modelName: disclosure.value.modelName,
      humanContribution: disclosure.value.humanContribution,
    }, await loadArticleRuleOverrides(getDatabase()))
    if (!rules.ok) throw rulesReviewError(rules.findings)
  } else {
    if (body.authorshipMode !== undefined || body.modelName !== undefined || body.humanContribution !== undefined || body.sources !== undefined || body.rulesConsent !== undefined) {
      throw createError({ statusCode: 400, statusMessage: 'Authorship disclosure and article source lists are only accepted for articles.' })
    }
    if (Array.isArray(body.sources) && body.sources.length > 0) {
      throw createError({ statusCode: 400, statusMessage: 'Article source lists are only accepted for articles.' })
    }
  }

  if (checked.value.kind !== 'article' && body.source && (body.source.url || body.source.title || body.source.publisher || body.source.locator || body.source.note)) {
    const citation = validateCitation(body.source)
    if (!citation.ok) throw createError({ statusCode: 400, statusMessage: 'Please correct the source details.', data: { errors: citation.errors } })
    citations = [citation]
  }

  const client = await getDatabase().connect()
  let topic
  try {
    await client.query('BEGIN')
    const branch = await chooseBranch(client, actor, branchChoice)
    const slug = await allocateTopicSlug(client, body.slug)
    const visibility = body.access === 'link' ? 'link' : 'public'
    const status = await openingTopicStatus(client, visibility === 'public' ? 'published' : 'unlisted')
    const created = await client.query(
      `INSERT INTO topics
         (node_id, author_id, slug, kind, branch_id, status, summary, hide_author,
          discussion_enabled, accept_replies, federation_outbound_mode)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       RETURNING id, slug, page_number, kind, status, summary, hide_author,
                 discussion_enabled, accept_replies, federation_outbound_mode, created_at`,
      [actor.node_id, actor.id, slug, checked.value.kind, branch?.id || null, status, overview.value, authorVisibilityOverride,
        discussionControls.discussionEnabled, discussionControls.acceptReplies, discussionControls.federationOutboundMode],
    )
    topic = created.rows[0]
    topic.tags = await attachTopicTags(client, { nodeId: actor.node_id, topicId: topic.id, tags: checkedTags.value })
    const revision = disclosure
      ? await client.query(
          `INSERT INTO revisions (topic_id, author_id, locale, title, body_markdown, authorship_mode, model_name, human_contribution)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
           RETURNING id, locale, title, body_markdown, authorship_mode, model_name, human_contribution, created_at`,
          [topic.id, actor.id, checked.value.locale, checked.value.title, checked.value.body,
            disclosure.value.authorshipMode, disclosure.value.modelName, disclosure.value.humanContribution],
        )
      : await client.query(
          `INSERT INTO revisions (topic_id, author_id, locale, title, body_markdown)
           VALUES ($1, $2, $3, $4, $5)
           RETURNING id, locale, title, body_markdown, created_at`,
          [topic.id, actor.id, checked.value.locale, checked.value.title, checked.value.body],
        )
    topic.revision = revision.rows[0]
    await recordRevisionDiff(client, {
      revisionId: topic.revision.id,
      title: topic.revision.title,
      body: topic.revision.body_markdown,
      origin: 'publication',
      introducedBy: actor.id,
      confirmedBy: actor.id,
      introducedAt: topic.revision.created_at,
      confirmedAt: topic.revision.created_at,
    })
    await client.query(
      'INSERT INTO topic_current_revisions (topic_id, locale, revision_id) VALUES ($1, $2, $3)',
      [topic.id, checked.value.locale, topic.revision.id],
    )
    await client.query('INSERT INTO page_read_counts (topic_id) VALUES ($1)', [topic.id])
    if (checked.value.kind === 'article' && !overview.value && ['published', 'unlisted'].includes(status)) {
      await client.query(
        `INSERT INTO article_writing_tasks (task_type, topic_id, target_revision_id, status)
         VALUES ('overview', $1, $2, 'open')
         ON CONFLICT (target_revision_id) WHERE task_type = 'overview' DO NOTHING`,
        [topic.id, topic.revision.id],
      )
    }

    for (const citation of citations) {
      await attachCitation(client, { topicId: topic.id, revisionId: topic.revision.id, citation: citation.value })
    }
    await ensureContentTasks(client, { topicId: topic.id, baseRevisionId: topic.revision.id, creatorId: actor.id })
    await client.query(
      `INSERT INTO actor_audit_log (actor_id, action, target_type, target_id, details)
       VALUES ($1, 'topic_created', 'topic', $2, jsonb_build_object('kind', $3::text, 'source_count', $4::int, 'branch', $5::text, 'rules_consent', $6::boolean, 'tag_count', $7::int))`,
      [actor.id, topic.id, checked.value.kind, citations.length, branch?.slug || null, checked.value.kind === 'article', topic.tags.length],
    )
    await notifyMentions(client, { topicId: topic.id, authorId: actor.id })
    if (branch) topic.branch = { slug: branch.slug, title: branch.title }
    await client.query('COMMIT')
  } catch (error) {
    await client.query('ROLLBACK')
    if (branchConflict(error)) throw createError({ statusCode: 409, statusMessage: 'A branch with this name already exists. Choose it from the list or use another name.' })
    if (error.statusCode) throw createError({ statusCode: error.statusCode, statusMessage: error.message })
    if (error.code === '23505') throw createError({ statusCode: 409, statusMessage: 'A page with a similar address was just created. Please try again.' })
    throw error
  } finally {
    client.release()
  }

  if (topic.status === 'published' || topic.status === 'unlisted') {
    await checkPageContent(getDatabase(), {
      topicId: topic.id,
      trigger: 'publish',
      article: { title: topic.revision.title, body: topic.revision.body_markdown },
    })
    const fresh = await getDatabase().query(`SELECT status FROM topics WHERE id = $1`, [topic.id])
    topic.status = fresh.rows[0]?.status || topic.status
  }

  if (topic.status === 'published') {
    void notifySearchDiscovery({ siteUrl: config.public.siteUrl, paths: [`/${topic.page_number}`] })
  }

  setResponseStatus(event, 201)
  topic.access = topic.status === 'pending' ? 'pending' : topic.status === 'hidden' ? 'author' : topic.status === 'published' ? 'public' : 'link'
  topic.discussionEnabled = topic.discussion_enabled !== false
  topic.acceptReplies = topic.accept_replies !== false
  topic.federationOutboundMode = topic.federation_outbound_mode || 'auto'
  delete topic.discussion_enabled
  delete topic.accept_replies
  delete topic.federation_outbound_mode
  return { topic: withShortPath(topic) }
})

async function attachCitation(client, { topicId, revisionId, citation }) {
  const sourceResult = await client.query(
    `INSERT INTO sources (canonical_url, title, publisher, source_type, published_at)
     VALUES ($1, NULLIF($2::text, ''), NULLIF($3::text, ''), 'external', $4::date)
     ON CONFLICT (canonical_url) DO UPDATE SET
       title = coalesce(sources.title, EXCLUDED.title),
       publisher = coalesce(sources.publisher, EXCLUDED.publisher),
       published_at = coalesce(sources.published_at, EXCLUDED.published_at)
     RETURNING id`,
    [citation.url, citation.title, citation.publisher, citation.publishedAt || null],
  )
  await client.query(
    `INSERT INTO citations (topic_id, source_id, revision_id, locator, note)
     VALUES ($1, $2, $3, NULLIF($4::text, ''), NULLIF($5::text, ''))`,
    [topicId, sourceResult.rows[0].id, revisionId, citation.locator, citation.note],
  )
}

function readAuthorVisibilityOverride(body) {
  const supplied = ['anonymous', 'hideAuthor'].filter(key => Object.prototype.hasOwnProperty.call(body || {}, key))
  if (supplied.some(key => typeof body[key] !== 'boolean')) {
    throw createError({ statusCode: 400, statusMessage: 'Author visibility must be true or false when set.' })
  }
  if (supplied.length === 2 && body.anonymous !== body.hideAuthor) {
    throw createError({ statusCode: 400, statusMessage: 'Choose one consistent author visibility setting.' })
  }
  return supplied.length ? body[supplied[0]] : null
}

function readDiscussionControls(body) {
  for (const key of ['discussionEnabled', 'acceptReplies']) {
    if (body?.[key] !== undefined && typeof body[key] !== 'boolean') {
      throw createError({ statusCode: 400, statusMessage: `${key} must be true or false when set.` })
    }
  }
  const mode = body?.federationOutboundMode === undefined ? 'auto' : String(body.federationOutboundMode)
  if (!['none', 'auto', 'manual'].includes(mode)) throw createError({ statusCode: 400, statusMessage: 'federationOutboundMode must be none, auto, or manual.' })
  return {
    discussionEnabled: body?.discussionEnabled !== false,
    acceptReplies: body?.acceptReplies !== false,
    federationOutboundMode: mode,
  }
}

function readBranchChoice(body) {
  const hasNew = body?.newBranch != null && body.newBranch !== ''
  const slug = body?.branchSlug == null ? '' : String(body.branchSlug).trim()
  if (hasNew && slug) throw createError({ statusCode: 400, statusMessage: 'Choose an existing branch or create a new one, not both.' })
  if (!hasNew && !slug) return null
  if (slug) {
    const normalized = normalizeBranchSlug(slug)
    if (!normalized) throw createError({ statusCode: 400, statusMessage: 'Choose an existing branch.' })
    return { slug: normalized }
  }
  if (typeof body.newBranch !== 'object' || Array.isArray(body.newBranch)) {
    throw createError({ statusCode: 400, statusMessage: 'Please correct the branch details.' })
  }
  return { create: body.newBranch }
}

async function chooseBranch(client, actor, choice) {
  if (!choice) return null
  if (choice.create) {
    return createBranch(client, {
      nodeId: actor.node_id,
      actorId: actor.id,
      title: choice.create.title,
      description: choice.create.description,
    })
  }
  const branch = await findBranchBySlug(client, choice.slug)
  if (!branch) throw createError({ statusCode: 404, statusMessage: 'That branch does not exist. Create it, or publish without a branch.' })
  return branch
}
