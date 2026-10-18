import { randomUUID } from 'node:crypto'
import { createError } from 'h3'
import { findBranchBySlug } from './branches.js'
import { recordRevisionDiff } from './revision-history.js'
import { validateAuthorship } from './authorship.js'
import { isNewerVersion, parseVersion, PRODUCT_VERSION } from './release.js'
import { normalizeBranchSlug, normalizePageSlug, slugify, TOPIC_KINDS, validateCitation, validateReply, validateTopic } from './validation.js'
import { topicKeyPredicate } from './page-address.js'
import { authorHiddenSql } from './author-visibility.js'

export const ARCHIVE_VERSION = 1
export const NODE_ARCHIVE_KIND = 'node-archive'
export const ACCOUNT_ARCHIVE_KIND = 'account-archive'
export const NODE_ARCHIVE_KINDS = Object.freeze(['article', 'question'])
export const NODE_ARCHIVE_PAGE_LIMIT = 2000
export const ACCOUNT_ARCHIVE_PAGE_LIMIT = 500
export const ACCOUNT_ARCHIVE_COMMENT_LIMIT = 2000
export const IMPORT_PAGE_LIMIT = 200
export const IMPORT_COMMENT_LIMIT = 1000
export const ARCHIVE_BYTE_LIMIT = 2_000_000
const MAX_THREAD_DEPTH = 12

const PAGE_KEYS = ['slug', 'kind', 'created_at', 'author', 'branch', 'revisions']
const REVISION_KEYS = ['locale', 'title', 'body', 'summary', 'sources', 'authorship']
const COMMENT_KEYS = ['id', 'parent_id', 'page_slug', 'locale', 'body', 'created_at', 'source']
const SOURCE_KEYS = ['url', 'title', 'publisher', 'locator', 'note']
const AUTHORSHIP_KEYS = ['mode', 'modelName', 'humanContribution']

export function groupArchivePages(rows, sourcesByRevision = new Map()) {
  const pages = []
  const index = new Map()
  for (const row of rows) {
    let page = index.get(row.slug)
    if (!page) {
      page = {
        slug: row.slug,
        kind: row.kind,
        created_at: toIso(row.created_at),
        author: row.author || null,
        branch: row.branch_slug ? { slug: row.branch_slug, title: row.branch_title || row.branch_slug } : null,
        revisions: [],
      }
      index.set(row.slug, page)
      pages.push(page)
    }
    page.revisions.push(presentRevision(row, sourcesByRevision.get(String(row.revision_id)) || []))
  }
  return pages
}

export function presentComment(row) {
  return {
    id: String(row.id),
    parent_id: row.parent_in_archive ? String(row.parent_reply_id) : null,
    page_slug: row.page_slug,
    locale: row.locale,
    body: row.body_markdown,
    created_at: toIso(row.created_at),
    source: row.source_url ? {
      url: row.source_url,
      title: row.source_title || '',
      publisher: row.source_publisher || '',
      locator: row.source_locator || '',
      note: row.source_note || '',
    } : null,
  }
}

export function presentArchiveNode({ version = PRODUCT_VERSION, domain = '', origin = '', exportedAt = new Date() } = {}) {
  return {
    version: String(version),
    domain: clipText(domain, 253),
    origin: clipText(origin, 300),
    exported_at: toIso(exportedAt),
  }
}

export function buildNodeArchive({ domain, origin = '', version = PRODUCT_VERSION, exportedAt = new Date(), pages }) {
  return {
    aiki: NODE_ARCHIVE_KIND,
    version: ARCHIVE_VERSION,
    exported_at: toIso(exportedAt),
    domain: String(domain || ''),
    node: presentArchiveNode({ version, domain, origin, exportedAt }),
    pages,
  }
}

export function buildAccountArchive({ username, domain = '', origin = '', version = PRODUCT_VERSION, exportedAt = new Date(), pages, comments }) {
  return {
    aiki: ACCOUNT_ARCHIVE_KIND,
    version: ARCHIVE_VERSION,
    exported_at: toIso(exportedAt),
    node: presentArchiveNode({ version, domain, origin, exportedAt }),
    account: { username: username || null },
    pages,
    comments,
  }
}

export function parseAccountArchive(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return failure('Upload an AIKI account archive.')
  }
  if (input.aiki === NODE_ARCHIVE_KIND) {
    return failure('This file is the public node backup. Import the account archive from your cabinet.')
  }
  if (input.aiki !== ACCOUNT_ARCHIVE_KIND || !Number.isInteger(input.version) || input.version < 1) {
    return failure('Upload an AIKI account archive.')
  }
  if (input.version > ARCHIVE_VERSION) {
    return failure('This archive uses a newer file format. Upgrade this node before importing it.')
  }
  const extra = unknownKey(input, ['aiki', 'version', 'exported_at', 'node', 'account', 'pages', 'comments'])
  if (extra) return failure(`Unknown archive field: ${extra}`)
  const node = parseArchiveNode(input.node)
  if (!node.ok) return node
  if (input.account != null && (typeof input.account !== 'object' || Array.isArray(input.account))) {
    return failure('The account field in this archive is not usable.')
  }
  if (!Array.isArray(input.pages) || !Array.isArray(input.comments)) {
    return failure('This archive needs pages and comments lists.')
  }
  if (input.pages.length > IMPORT_PAGE_LIMIT || input.comments.length > IMPORT_COMMENT_LIMIT) {
    return failure('That archive is too large to import.')
  }
  if (input.pages.length + input.comments.length === 0) {
    return failure('This archive has nothing to import.')
  }

  const pages = []
  const slugs = new Set()
  for (const [index, page] of input.pages.entries()) {
    const parsed = parsePage(page, index)
    if (!parsed.ok) return parsed
    if (slugs.has(parsed.value.slug)) return failure(`Page ${index + 1} repeats an address already in this archive.`)
    slugs.add(parsed.value.slug)
    pages.push(parsed.value)
  }

  const comments = []
  const ids = new Set()
  for (const [index, comment] of input.comments.entries()) {
    const parsed = parseComment(comment, index)
    if (!parsed.ok) return parsed
    if (ids.has(parsed.value.id)) return failure(`Comment ${index + 1} repeats an id already in this archive.`)
    ids.add(parsed.value.id)
    comments.push(parsed.value)
  }
  const ordered = orderCommentThread(comments)
  if (!ordered.ok) return ordered
  return { ok: true, value: { pages, comments: ordered.comments, node: node.value } }
}

export async function loadNodeArchive(db, { domain, origin = '' }) {
  const counted = await db.query(
    `SELECT count(*)::int AS pages FROM topics
      WHERE status = 'published' AND kind = ANY($1::text[])`,
    [NODE_ARCHIVE_KINDS],
  )
  if (counted.rows[0].pages > NODE_ARCHIVE_PAGE_LIMIT) {
    throw createError({ statusCode: 413, statusMessage: 'This node has more published articles and questions than one public archive can hold.' })
  }
  const rows = await db.query(
    `SELECT t.slug, t.kind, t.created_at,
            CASE WHEN ${authorHiddenSql('t', 'a')} THEN NULL ELSE a.username END AS author,
            b.slug AS branch_slug, b.title AS branch_title,
            r.id AS revision_id, r.locale, r.title, r.body_markdown, r.summary,
            r.authorship_mode, r.model_name, r.human_contribution
       FROM topics t
       JOIN topic_current_revisions current ON current.topic_id = t.id
       JOIN revisions r ON r.id = current.revision_id
       LEFT JOIN actors a ON a.id = t.author_id
       LEFT JOIN branches b ON b.id = t.branch_id
      WHERE t.status = 'published' AND t.kind = ANY($1::text[])
      ORDER BY t.created_at, t.slug, r.locale`,
    [NODE_ARCHIVE_KINDS],
  )
  const sources = await loadRevisionSources(db, rows.rows.map(row => row.revision_id))
  return buildNodeArchive({ domain, origin, pages: groupArchivePages(rows.rows, sources) })
}

export async function loadAccountArchive(db, actor, { domain = '', origin = '' } = {}) {
  const [pagesCounted, commentsCounted] = await Promise.all([
    db.query(
      `SELECT count(*)::int AS pages FROM topics WHERE status = 'published' AND author_id = $1`,
      [actor.id],
    ),
    db.query(
      `SELECT count(*)::int AS comments FROM replies WHERE status = 'published' AND author_id = $1`,
      [actor.id],
    ),
  ])
  if (pagesCounted.rows[0].pages > ACCOUNT_ARCHIVE_PAGE_LIMIT || commentsCounted.rows[0].comments > ACCOUNT_ARCHIVE_COMMENT_LIMIT) {
    throw createError({ statusCode: 413, statusMessage: 'This account has more published material than one archive can hold.' })
  }
  const rows = await db.query(
    `SELECT t.slug, t.kind, t.created_at, a.username AS author,
            b.slug AS branch_slug, b.title AS branch_title,
            r.id AS revision_id, r.locale, r.title, r.body_markdown, r.summary,
            r.authorship_mode, r.model_name, r.human_contribution
       FROM topics t
       JOIN topic_current_revisions current ON current.topic_id = t.id
       JOIN revisions r ON r.id = current.revision_id
       LEFT JOIN actors a ON a.id = t.author_id
       LEFT JOIN branches b ON b.id = t.branch_id
      WHERE t.status = 'published' AND t.author_id = $1
      ORDER BY t.created_at, t.slug, r.locale`,
    [actor.id],
  )
  const comments = await db.query(
    `SELECT r.id, r.parent_reply_id, r.locale, r.body_markdown, r.created_at,
            t.slug AS page_slug,
            (parent.id IS NOT NULL AND parent.author_id = r.author_id AND parent.status = 'published') AS parent_in_archive,
            source.canonical_url AS source_url, source.title AS source_title,
            source.publisher AS source_publisher, source.locator AS source_locator, source.note AS source_note
       FROM replies r
       JOIN topics t ON t.id = r.topic_id AND t.status = 'published'
       LEFT JOIN replies parent ON parent.id = r.parent_reply_id
       LEFT JOIN LATERAL (
         SELECT s.canonical_url, s.title, s.publisher, c.locator, c.note
           FROM citations c
           JOIN sources s ON s.id = c.source_id
          WHERE c.reply_id = r.id
          ORDER BY c.retrieved_at, c.id
          LIMIT 1
       ) source ON true
      WHERE r.status = 'published' AND r.author_id = $1
      ORDER BY r.created_at, r.id`,
    [actor.id],
  )
  const sources = await loadRevisionSources(db, rows.rows.map(row => row.revision_id))
  return buildAccountArchive({
    username: actor.username,
    domain,
    origin,
    pages: groupArchivePages(rows.rows, sources),
    comments: comments.rows.map(presentComment),
  })
}

export async function importAccountArchive(client, actor, input) {
  const parsed = parseAccountArchive(input)
  if (!parsed.ok) throw createError({ statusCode: 400, statusMessage: parsed.message })
  const measured = Buffer.byteLength(JSON.stringify(input))
  if (measured > ARCHIVE_BYTE_LIMIT) throw createError({ statusCode: 413, statusMessage: 'That archive is too large to import.' })

  await client.query('BEGIN')
  try {
    const pagesBySlug = new Map()
    let pagesWithoutBranch = 0
    let importedPages = 0
    let alreadyPages = 0
    for (const page of parsed.value.pages) {
      const owned = await findOwnedTopic(client, actor.id, page.slug)
      if (owned) {
        await rememberImportKey(client, 'topics', owned.id, actor.id, page.slug)
        pagesBySlug.set(page.slug, owned.id)
        alreadyPages += 1
        continue
      }
      const branch = page.branchSlug ? await findBranchBySlug(client, page.branchSlug) : null
      if (page.branchSlug && !branch) pagesWithoutBranch += 1
      const slug = await uniqueSlug(client, page.slug)
      const created = await client.query(
        `INSERT INTO topics (node_id, author_id, slug, kind, branch_id, created_at, import_key)
         VALUES ($1, $2, $3, $4, $5, coalesce($6::timestamptz, now()), $7)
         RETURNING id, slug`,
        [actor.node_id, actor.id, slug, page.kind, branch?.id || null, page.createdAt, page.slug],
      )
      const topic = created.rows[0]
      const previousRevision = new Map()
      for (const revision of page.revisions) {
        const earlier = previousRevision.get(revision.locale) || null
        const inserted = await client.query(
          `INSERT INTO revisions (topic_id, parent_revision_id, author_id, locale, title, body_markdown, summary, authorship_mode, model_name, human_contribution, created_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, coalesce($11::timestamptz, now()))
           RETURNING id, created_at`,
          [topic.id, earlier?.id || null, actor.id, revision.locale, revision.title, revision.body, revision.summary,
            revision.authorship?.mode || null, revision.authorship?.modelName || null, revision.authorship?.humanContribution || null,
            page.createdAt],
        )
        await recordRevisionDiff(client, {
          revisionId: inserted.rows[0].id,
          parentRevisionId: earlier?.id || null,
          parentTitle: earlier?.title || '',
          parentBody: earlier?.body || '',
          title: revision.title,
          body: revision.body,
          origin: 'import',
          introducedBy: actor.id,
          confirmedBy: actor.id,
          introducedAt: page.createdAt || inserted.rows[0].created_at,
          confirmedAt: inserted.rows[0].created_at,
        })
        previousRevision.set(revision.locale, { id: inserted.rows[0].id, title: revision.title, body: revision.body })
        await client.query(
          'INSERT INTO topic_current_revisions (topic_id, locale, revision_id) VALUES ($1, $2, $3)',
          [topic.id, revision.locale, inserted.rows[0].id],
        )
        for (const source of revision.sources) await attachSource(client, { topicId: topic.id, revisionId: inserted.rows[0].id, source })
      }
      await client.query('INSERT INTO page_read_counts (topic_id) VALUES ($1) ON CONFLICT DO NOTHING', [topic.id])
      await client.query(
        `INSERT INTO actor_audit_log (actor_id, action, target_type, target_id, details)
         VALUES ($1, 'topic_created', 'topic', $2, jsonb_build_object('kind', $3::text, 'imported', true))`,
        [actor.id, topic.id, page.kind],
      )
      pagesBySlug.set(page.slug, topic.id)
      importedPages += 1
    }

    const commentIds = new Map()
    let skippedComments = 0
    let importedComments = 0
    let alreadyComments = 0
    for (const comment of parsed.value.comments) {
      const ownedReply = await findOwnedReply(client, actor.id, comment.id)
      if (ownedReply) {
        await rememberImportKey(client, 'replies', ownedReply.id, actor.id, comment.id)
        commentIds.set(comment.id, ownedReply.id)
        alreadyComments += 1
        continue
      }
      let topicId = pagesBySlug.get(comment.page_slug) || null
      if (!topicId) {
        const existing = await client.query(
          `SELECT id FROM topics WHERE ${topicKeyPredicate('topics', '$1')} AND status = 'published'`,
          [comment.page_slug],
        )
        topicId = existing.rows[0]?.id || null
      }
      if (!topicId) {
        skippedComments += 1
        continue
      }
      const parentId = comment.parent_id ? commentIds.get(comment.parent_id) || null : null
      const inserted = await client.query(
        `INSERT INTO replies (topic_id, parent_reply_id, author_id, locale, body_markdown, created_at, import_key)
         VALUES ($1, $2, $3, $4, $5, coalesce($6::timestamptz, now()), $7)
         RETURNING id`,
        [topicId, parentId, actor.id, comment.locale, comment.body, comment.createdAt, comment.id],
      )
      const replyId = inserted.rows[0].id
      commentIds.set(comment.id, replyId)
      if (comment.source) await attachSource(client, { topicId, replyId, source: comment.source })
      await client.query(
        `INSERT INTO actor_audit_log (actor_id, action, target_type, target_id, details)
         VALUES ($1, 'reply_created', 'reply', $2, jsonb_build_object('imported', true))`,
        [actor.id, replyId],
      )
      importedComments += 1
    }
    if (importedPages === 0 && importedComments === 0 && alreadyPages === 0 && alreadyComments === 0) {
      throw createError({ statusCode: 400, statusMessage: 'None of these comments match a page on this node.' })
    }
    const source = parsed.value.node
    await client.query(
      `INSERT INTO actor_audit_log (actor_id, action, target_type, details)
       VALUES ($1, 'archive_imported', 'actor', jsonb_build_object('pages', $2::int, 'comments', $3::int, 'already_pages', $4::int, 'already_comments', $5::int, 'skipped_comments', $6::int, 'node_version', $7::text, 'domain', $8::text, 'origin', $9::text, 'exported_at', $10::text))`,
      [actor.id, importedPages, importedComments, alreadyPages, alreadyComments, skippedComments,
        source?.version || null, source?.domain || null, source?.origin || null, source?.exported_at || null],
    )
    await client.query('COMMIT')
    return {
      imported: { pages: importedPages, comments: importedComments },
      alreadyPresent: { pages: alreadyPages, comments: alreadyComments },
      skippedComments,
      pagesWithoutBranch,
    }
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  }
}

function presentRevision(row, sources) {
  return {
    locale: row.locale,
    title: row.title,
    body: row.body_markdown,
    summary: row.summary || null,
    authorship: row.authorship_mode ? {
      mode: row.authorship_mode,
      modelName: row.model_name || null,
      humanContribution: row.human_contribution || null,
    } : null,
    sources: sources.map(source => ({
      url: source.canonical_url,
      title: source.title || '',
      publisher: source.publisher || '',
      locator: source.locator || '',
      note: source.note || '',
    })),
  }
}

async function loadRevisionSources(db, revisionIds) {
  const map = new Map()
  if (!revisionIds.length) return map
  const result = await db.query(
    `SELECT c.revision_id, s.canonical_url, s.title, s.publisher, c.locator, c.note
       FROM citations c
       JOIN sources s ON s.id = c.source_id
      WHERE c.revision_id = ANY($1::uuid[])
      ORDER BY c.retrieved_at, c.id`,
    [revisionIds],
  )
  for (const row of result.rows) {
    const key = String(row.revision_id)
    const list = map.get(key) || []
    list.push(row)
    map.set(key, list)
  }
  return map
}

function parsePage(page, index) {
  const label = `Page ${index + 1}`
  if (!page || typeof page !== 'object' || Array.isArray(page)) return failure(`${label} is not a page object.`)
  const extra = unknownKey(page, PAGE_KEYS)
  if (extra) return failure(`${label} has an unknown field: ${extra}`)
  if (!Array.isArray(page.revisions) || page.revisions.length < 1 || page.revisions.length > 8) {
    return failure(`${label} needs 1–8 current revisions.`)
  }
  const slug = normalizePageSlug(page.slug)
  if (!slug) return failure(`${label} needs an available page address.`)
  if (!TOPIC_KINDS.includes(page.kind)) return failure(`${label} has an unsupported type.`)
  const created = optionalTime(page.created_at)
  if (!created.ok) return failure(`${label} has a created time that cannot be kept.`)
  let branchSlug = null
  if (page.branch != null) {
    if (typeof page.branch !== 'object' || Array.isArray(page.branch)) return failure(`${label} has a branch that cannot be read.`)
    const branchExtra = unknownKey(page.branch, ['slug', 'title'])
    if (branchExtra) return failure(`${label} has an unknown branch field: ${branchExtra}`)
    branchSlug = normalizeBranchSlug(page.branch.slug)
    if (!branchSlug) return failure(`${label} has a branch address that cannot be used.`)
  }
  const revisions = []
  const locales = new Set()
  for (const [revisionIndex, revision] of page.revisions.entries()) {
    const parsed = parseRevision(revision, page.kind, `${label}, revision ${revisionIndex + 1}`)
    if (!parsed.ok) return parsed
    if (locales.has(parsed.value.locale)) return failure(`${label} repeats the ${parsed.value.locale} revision.`)
    locales.add(parsed.value.locale)
    revisions.push(parsed.value)
  }
  return { ok: true, value: { slug, kind: page.kind, createdAt: created.value, branchSlug, revisions } }
}

function parseRevision(revision, kind, label) {
  if (!revision || typeof revision !== 'object' || Array.isArray(revision)) return failure(`${label} is not a revision.`)
  const extra = unknownKey(revision, REVISION_KEYS)
  if (extra) return failure(`${label} has an unknown field: ${extra}`)
  const checked = validateTopic({ title: revision.title, body: revision.body, kind, locale: revision.locale })
  if (!checked.ok) return failure(`${label} does not match a publishable page.`)
  if (!Array.isArray(revision.sources)) return failure(`${label} needs a sources list.`)
  const sources = []
  for (const [sourceIndex, source] of revision.sources.entries()) {
    const parsed = parseSource(source, `${label}, source ${sourceIndex + 1}`)
    if (!parsed.ok) return parsed
    sources.push(parsed.value)
  }
  let authorship = null
  if (kind === 'article') {
    if (sources.length < 1 || sources.length > 20) return failure(`${label} needs 1–20 public sources.`)
    if (!revision.authorship || typeof revision.authorship !== 'object' || Array.isArray(revision.authorship)) {
      return failure(`${label} needs an authorship disclosure.`)
    }
    const authorshipExtra = unknownKey(revision.authorship, AUTHORSHIP_KEYS)
    if (authorshipExtra) return failure(`${label} has an unknown authorship field: ${authorshipExtra}`)
    const disclosure = validateAuthorship({
      authorshipMode: revision.authorship.mode,
      modelName: revision.authorship.modelName,
      humanContribution: revision.authorship.humanContribution,
    })
    if (!disclosure.ok) return failure(`${label} needs a complete authorship disclosure.`)
    authorship = disclosure.value
  } else if (revision.authorship != null || sources.length > 1) {
    return failure(`${label} can keep authorship and several sources only on an article.`)
  }
  const summary = revision.summary == null ? null : String(revision.summary).replace(/\0/g, '').trim()
  if (summary && summary.length > 2000) return failure(`${label} has a summary that is too long.`)
  return {
    ok: true,
    value: {
      locale: checked.value.locale,
      title: checked.value.title,
      body: checked.value.body,
      summary: summary || null,
      sources,
      authorship: authorship ? {
        mode: authorship.authorshipMode,
        modelName: authorship.modelName,
        humanContribution: authorship.humanContribution,
      } : null,
    },
  }
}

function parseComment(comment, index) {
  const label = `Comment ${index + 1}`
  if (!comment || typeof comment !== 'object' || Array.isArray(comment)) return failure(`${label} is not a comment.`)
  const extra = unknownKey(comment, COMMENT_KEYS)
  if (extra) return failure(`${label} has an unknown field: ${extra}`)
  const id = String(comment.id || '').trim()
  if (!id || id.length > 80) return failure(`${label} needs an id.`)
  const pageSlug = normalizePageSlug(comment.page_slug)
  if (!pageSlug) return failure(`${label} needs the address of its page.`)
  const checked = validateReply({ body: comment.body, locale: comment.locale })
  if (!checked.ok) return failure(`${label} is not a publishable comment.`)
  const created = optionalTime(comment.created_at)
  if (!created.ok) return failure(`${label} has a created time that cannot be kept.`)
  let source = null
  if (comment.source != null) {
    const parsed = parseSource(comment.source, label)
    if (!parsed.ok) return parsed
    source = parsed.value
  }
  const parentId = comment.parent_id == null || comment.parent_id === '' ? null : String(comment.parent_id).trim()
  if (parentId && parentId.length > 80) return failure(`${label} points at a parent that cannot be read.`)
  return {
    ok: true,
    value: { id, parent_id: parentId, page_slug: pageSlug, locale: checked.value.locale, body: checked.value.body, createdAt: created.value, source },
  }
}

function parseSource(source, label) {
  if (!source || typeof source !== 'object' || Array.isArray(source)) return failure(`${label} has a source that cannot be read.`)
  const extra = unknownKey(source, SOURCE_KEYS)
  if (extra) return failure(`${label} has an unknown source field: ${extra}`)
  const checked = validateCitation(source)
  if (!checked.ok) return failure(`${label} needs a public http(s) source.`)
  return { ok: true, value: checked.value }
}

function orderCommentThread(comments) {
  const ids = new Set(comments.map(comment => comment.id))
  const pending = [...comments]
  const ordered = []
  const depth = new Map()
  let guard = pending.length
  while (pending.length && guard--) {
    const index = pending.findIndex(comment => !comment.parent_id || !ids.has(comment.parent_id) || ordered.some(item => item.id === comment.parent_id))
    if (index < 0) return failure('Comment threads in this archive contain a loop.')
    const comment = pending.splice(index, 1)[0]
    const parentId = comment.parent_id && ids.has(comment.parent_id) ? comment.parent_id : null
    const level = parentId ? depth.get(parentId) + 1 : 1
    if (level > MAX_THREAD_DEPTH) return failure('A comment thread in this archive is deeper than 12 replies.')
    depth.set(comment.id, level)
    ordered.push({ ...comment, parent_id: parentId })
  }
  if (pending.length) return failure('Comment threads in this archive contain a loop.')
  return { ok: true, comments: ordered }
}

const IMPORT_COMMENT_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

async function findOwnedTopic(client, actorId, key) {
  const result = await client.query(
    `SELECT id FROM topics
      WHERE author_id = $1 AND (import_key = $2 OR slug = $2)
      ORDER BY (import_key = $2) DESC
      LIMIT 1`,
    [actorId, key],
  )
  return result.rows[0] || null
}

async function findOwnedReply(client, actorId, key) {
  const byKey = await client.query(
    `SELECT id FROM replies WHERE author_id = $1 AND import_key = $2 LIMIT 1`,
    [actorId, key],
  )
  if (byKey.rows[0]) return byKey.rows[0]
  if (!IMPORT_COMMENT_ID.test(key)) return null
  const byId = await client.query(
    `SELECT id FROM replies WHERE author_id = $1 AND id = $2::uuid LIMIT 1`,
    [actorId, key],
  )
  return byId.rows[0] || null
}

async function rememberImportKey(client, table, id, actorId, key) {
  if (table !== 'topics' && table !== 'replies') throw new Error('Unsupported import target')
  await client.query(
    `UPDATE ${table} SET import_key = $3
      WHERE id = $1 AND author_id = $2 AND import_key IS NULL`,
    [id, actorId, key],
  )
}

async function uniqueSlug(client, base) {
  const stem = slugify(base).slice(0, 80).replace(/-+$/g, '') || 'page'
  for (let suffix = 0; suffix < 100; suffix += 1) {
    const slug = suffix === 0 ? base : `${stem}-${randomUUID().slice(0, 8)}`
    if (!normalizePageSlug(slug)) continue
    const exists = await client.query('SELECT 1 FROM topics WHERE lower(slug) = lower($1) LIMIT 1', [slug])
    if (exists.rowCount === 0) return slug
  }
  throw createError({ statusCode: 503, statusMessage: 'Could not allocate a page address.' })
}

async function attachSource(client, { topicId, revisionId = null, replyId = null, source }) {
  const saved = await client.query(
    `INSERT INTO sources (canonical_url, title, publisher, source_type)
     VALUES ($1, NULLIF($2::text, ''), NULLIF($3::text, ''), 'external')
     ON CONFLICT (canonical_url) DO UPDATE SET
       title = coalesce(sources.title, EXCLUDED.title),
       publisher = coalesce(sources.publisher, EXCLUDED.publisher)
     RETURNING id`,
    [source.url, source.title, source.publisher],
  )
  await client.query(
    `INSERT INTO citations (topic_id, source_id, revision_id, reply_id, locator, note)
     VALUES ($1, $2, $3, $4, NULLIF($5::text, ''), NULLIF($6::text, ''))`,
    [topicId, saved.rows[0].id, revisionId, replyId, source.locator, source.note],
  )
}

function parseArchiveNode(node) {
  if (node == null) return { ok: true, value: null }
  if (typeof node !== 'object' || Array.isArray(node)) return failure('The node field in this archive is not usable.')
  const extra = unknownKey(node, ['version', 'domain', 'origin', 'exported_at'])
  if (extra) return failure(`Unknown archive field: node.${extra}`)
  if (typeof node.version !== 'string' || !parseVersion(node.version)) {
    return failure('This archive names a node version this node cannot read.')
  }
  const version = node.version.trim()
  if (isNewerVersion(version, PRODUCT_VERSION)) {
    return failure(`This archive comes from AIKI ${version}. This node is ${PRODUCT_VERSION}. Upgrade this node before importing a newer archive.`)
  }
  const domain = readNodeText(node.domain, 253)
  if (!domain.ok) return domain
  const origin = readNodeText(node.origin, 300)
  if (!origin.ok) return origin
  let exportedAt = null
  if (node.exported_at != null && node.exported_at !== '') {
    if (typeof node.exported_at !== 'string') return failure('The node field in this archive is not usable.')
    const created = optionalTime(node.exported_at)
    exportedAt = created.ok ? created.value : null
  }
  return { ok: true, value: { version, domain: domain.value, origin: origin.value, exported_at: exportedAt } }
}

function readNodeText(value, max) {
  if (value == null || value === '') return { ok: true, value: '' }
  if (typeof value !== 'string') return failure('The node field in this archive is not usable.')
  const text = value.replace(/\0/g, '').trim()
  if (text.length > max) return failure('The node field in this archive is not usable.')
  return { ok: true, value: text }
}

function clipText(value, max) {
  return String(value || '').replace(/\0/g, '').trim().slice(0, max)
}

function optionalTime(value) {
  if (value == null || value === '') return { ok: true, value: null }
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return { ok: false }
  const year = date.getUTCFullYear()
  if (year < 2000 || date.getTime() > Date.now() + 86_400_000) return { ok: false }
  return { ok: true, value: date.toISOString() }
}

function unknownKey(value, allowed) {
  return Object.keys(value).find(key => !allowed.includes(key)) || null
}

function failure(message) {
  return { ok: false, message }
}

function toIso(value) {
  if (!value) return new Date().toISOString()
  const date = value instanceof Date ? value : new Date(value)
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString()
}
