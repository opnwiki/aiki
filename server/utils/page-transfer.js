import { createError } from 'h3'
import { notifyPageTransfer } from './notifications.js'
import { topicKeyPredicate } from './page-address.js'

const SLUG_PATTERN = /^[\p{L}\p{N}]+(?:-[\p{L}\p{N}]+)*$/u
const PUBLIC_ID_PATTERN = /^[1-9]\d{13}$/
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const USERNAME_PATTERN = /^[\p{L}\p{N}_-]+$/u

export function classifyRecipient(raw) {
  const value = String(raw ?? '').normalize('NFKC').trim()
  if (!value) return { ok: false, error: 'Enter an account id, email, or username.' }
  if (PUBLIC_ID_PATTERN.test(value)) return { ok: true, kind: 'public_id', value }
  if (value.includes('@')) {
    const email = value.toLowerCase()
    if (email.length > 254 || !EMAIL_PATTERN.test(email)) return { ok: false, error: 'Enter an account id, email, or username.' }
    return { ok: true, kind: 'email', value: email }
  }
  if (value.length < 3 || value.length > 32 || !USERNAME_PATTERN.test(value)) {
    return { ok: false, error: 'Enter an account id, email, or username.' }
  }
  return { ok: true, kind: 'username', value }
}

export function cleanNote(raw) {
  if (raw == null || raw === '') return { ok: true, value: null }
  const value = String(raw).replace(/\u0000/g, '').trim()
  if (!value) return { ok: true, value: null }
  if (value.length > 500) return { ok: false, error: 'A note can be at most 500 characters.' }
  return { ok: true, value }
}

export function managesPage(actor, topic) {
  if (!actor || !topic) return false
  if (actor.id && topic.author_id && actor.id === topic.author_id) return true
  const sameNode = topic.node_id == null || actor.node_id === topic.node_id
  return sameNode && ['owner', 'admin'].includes(actor.role)
}

export function isSlug(slug) {
  return typeof slug === 'string' && SLUG_PATTERN.test(slug)
}

function person(username, publicId, displayName = null) {
  if (!username && (publicId === null || publicId === undefined)) return null
  return { username: username || null, displayName: displayName || username || null, publicId: publicId == null ? null : String(publicId) }
}

function presentTransfer(row, actor) {
  const offer = {
    id: row.id,
    status: row.status,
    createdAt: row.created_at,
    note: row.note || null,
    from: person(row.from_username, row.from_public_id, row.from_display_name),
    to: person(row.to_username, row.to_public_id, row.to_display_name),
    offeredBy: person(row.offered_by_username, row.offered_by_public_id, row.offered_by_display_name),
    canAccept: false,
    canDecline: false,
    canCancel: false,
  }
  if (actor && row.status === 'pending') {
    const invited = actor.id === row.to_actor_id
    offer.canAccept = invited
    offer.canDecline = invited
    offer.canCancel = !invited && (actor.id === row.offered_by_actor_id
      || actor.id === row.author_id
      || (['owner', 'admin'].includes(actor.role) && (row.node_id == null || actor.node_id === row.node_id)))
  }
  return offer
}

const TRANSFER_ACTORS = `
  LEFT JOIN actors from_actor ON from_actor.id = tr.from_actor_id
  LEFT JOIN actors to_actor ON to_actor.id = tr.to_actor_id
  LEFT JOIN actors offered_by ON offered_by.id = tr.offered_by_actor_id`

const TRANSFER_FIELDS = `
  tr.id, tr.status, tr.note, tr.created_at, tr.to_actor_id, tr.offered_by_actor_id,
  t.author_id, t.node_id,
  from_actor.username AS from_username, from_actor.display_name AS from_display_name, from_actor.public_id AS from_public_id,
  to_actor.username AS to_username, to_actor.display_name AS to_display_name, to_actor.public_id AS to_public_id,
  offered_by.username AS offered_by_username, offered_by.display_name AS offered_by_display_name, offered_by.public_id AS offered_by_public_id`

export async function loadTransferState(db, { slug, actor }) {
  const topic = await db.query(
    `SELECT topics.id, topics.node_id, topics.author_id, topics.status,
            author.username AS author_username, author.display_name AS author_display_name, author.public_id AS author_public_id
       FROM topics
       LEFT JOIN actors author ON author.id = topics.author_id
      WHERE ${topicKeyPredicate('topics', '$1')} AND topics.status = 'published'
      LIMIT 1`,
    [slug],
  )
  if (!topic.rows[0]) throw createError({ statusCode: 404, statusMessage: 'Topic not found.' })
  const row = topic.rows[0]
  const pending = await db.query(
    `SELECT ${TRANSFER_FIELDS}
       FROM page_transfers tr
       JOIN topics t ON t.id = tr.topic_id
       ${TRANSFER_ACTORS}
      WHERE tr.topic_id = $1 AND tr.status = 'pending'
      LIMIT 1`,
    [row.id],
  )
  const offer = pending.rows[0] ? presentTransfer(pending.rows[0], actor) : null
  const manages = managesPage(actor, row)
  const invited = Boolean(offer && actor && offer.canAccept)
  return {
    canOffer: manages && !pending.rows[0],
    steward: (manages || invited) ? person(row.author_username, row.author_public_id, row.author_display_name) : null,
    offer,
  }
}

async function findRecipient(client, topic, classified) {
  const params = classified.kind === 'public_id'
    ? [classified.value, topic.node_id]
    : [classified.value, topic.node_id]
  const where = classified.kind === 'public_id'
    ? 'public_id = $1::bigint'
    : classified.kind === 'email'
      ? 'lower(email) = $1'
      : 'lower(username) = lower($1)'
  const found = await client.query(
    `SELECT id, public_id, username, display_name
       FROM actors
      WHERE kind = 'human' AND account_status = 'active'
        AND node_id IS NOT DISTINCT FROM $2::uuid
        AND ${where}`,
    params,
  )
  if (found.rowCount > 1) {
    throw createError({ statusCode: 409, statusMessage: 'That name matches more than one account. Use the 14-digit id.' })
  }
  if (!found.rows[0]) {
    throw createError({ statusCode: 404, statusMessage: 'No active account matches that id, email, or username.' })
  }
  return found.rows[0]
}

export async function offerPageTransfer(client, { slug, actor, recipientRaw, noteRaw }) {
  const classified = classifyRecipient(recipientRaw)
  if (!classified.ok) throw createError({ statusCode: 400, statusMessage: classified.error })
  const note = cleanNote(noteRaw)
  if (!note.ok) throw createError({ statusCode: 400, statusMessage: note.error })

  const topicResult = await client.query(
    `SELECT id, node_id, author_id FROM topics WHERE ${topicKeyPredicate('topics', '$1')} AND status = 'published' FOR UPDATE`,
    [slug],
  )
  const topic = topicResult.rows[0]
  if (!topic) throw createError({ statusCode: 404, statusMessage: 'Topic not found.' })
  if (!managesPage(actor, topic)) {
    throw createError({ statusCode: 403, statusMessage: 'Only the current steward or a node owner or admin can offer this page.' })
  }
  const pending = await client.query(
    `SELECT id FROM page_transfers WHERE topic_id = $1 AND status = 'pending' FOR UPDATE`,
    [topic.id],
  )
  if (pending.rows[0]) {
    throw createError({ statusCode: 409, statusMessage: 'This page already has an offer waiting for a reply.' })
  }
  const recipient = await findRecipient(client, topic, classified)
  if (recipient.id === topic.author_id) {
    throw createError({ statusCode: 400, statusMessage: 'That account already manages this page.' })
  }

  let inserted
  try {
    inserted = await client.query(
      `INSERT INTO page_transfers (topic_id, from_actor_id, to_actor_id, offered_by_actor_id, note)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, status, created_at`,
      [topic.id, topic.author_id, recipient.id, actor.id, note.value],
    )
  } catch (error) {
    if (error.code === '23505') {
      throw createError({ statusCode: 409, statusMessage: 'This page already has an offer waiting for a reply.' })
    }
    throw error
  }
  const transfer = inserted.rows[0]
  await client.query(
    `INSERT INTO actor_audit_log (actor_id, action, target_type, target_id, details)
     VALUES ($1, 'page_transfer_offered', 'page_transfer', $2, jsonb_build_object(
       'topic_id', $3::text, 'from_actor_id', $4::text, 'to_actor_id', $5::text,
       'to_public_id', $6::text, 'to_username', $7::text, 'lookup', $8::text))`,
    [actor.id, transfer.id, topic.id, topic.author_id, recipient.id, String(recipient.public_id), recipient.username, classified.kind],
  )
  await notifyPageTransfer(client, {
    topicId: topic.id,
    transferId: transfer.id,
    recipientId: recipient.id,
    actorId: actor.id,
  })
  return {
    transfer: {
      id: transfer.id,
      status: transfer.status,
      createdAt: transfer.created_at,
      to: person(recipient.username, recipient.public_id, recipient.display_name),
    },
  }
}

export async function decidePageTransfer(client, { slug, transferId, actor, action }) {
  if (!['accept', 'decline', 'cancel'].includes(action)) {
    throw createError({ statusCode: 400, statusMessage: 'Choose accept, decline, or cancel.' })
  }
  const selected = await client.query(
    `SELECT tr.id, tr.topic_id, tr.from_actor_id, tr.to_actor_id, tr.offered_by_actor_id, tr.status,
            t.author_id, t.node_id, t.slug, to_actor.username AS to_username
       FROM page_transfers tr
       JOIN topics t ON t.id = tr.topic_id
       JOIN actors to_actor ON to_actor.id = tr.to_actor_id
      WHERE ${topicKeyPredicate('t', '$1')} AND tr.id = $2 AND t.status = 'published'
      FOR UPDATE OF tr, t`,
    [slug, transferId],
  )
  const row = selected.rows[0]
  if (!row) throw createError({ statusCode: 404, statusMessage: 'Offer not found.' })
  if (row.status !== 'pending') throw createError({ statusCode: 409, statusMessage: 'This offer is no longer waiting.' })

  const invited = actor.id === row.to_actor_id
  if ((action === 'accept' || action === 'decline') && !invited) {
    throw createError({ statusCode: 403, statusMessage: 'Only the invited account can accept or decline.' })
  }
  const canCancel = actor.id === row.offered_by_actor_id
    || actor.id === row.author_id
    || (['owner', 'admin'].includes(actor.role) && (row.node_id == null || actor.node_id === row.node_id))
  if (action === 'cancel' && !canCancel) {
    throw createError({ statusCode: 403, statusMessage: 'Only the person who offered it, the current steward, or a node owner or admin can cancel.' })
  }

  let status = action === 'accept' ? 'accepted' : action === 'decline' ? 'declined' : 'cancelled'
  let auditAction = action === 'accept' ? 'page_transfer_accepted' : action === 'decline' ? 'page_transfer_declined' : 'page_transfer_cancelled'
  if (action === 'accept') {
    const moved = await client.query(
      `UPDATE topics SET author_id = $1, updated_at = now()
        WHERE id = $2 AND author_id IS NOT DISTINCT FROM $3`,
      [row.to_actor_id, row.topic_id, row.from_actor_id],
    )
    if (moved.rowCount !== 1) {
      status = 'withdrawn'
      auditAction = 'page_transfer_withdrawn'
    }
  }

  const updated = await client.query(
    `UPDATE page_transfers
        SET status = $1, decided_at = now(), decided_by_actor_id = $2
      WHERE id = $3 AND status = 'pending'
      RETURNING id, status, decided_at`,
    [status, actor.id, row.id],
  )
  if (updated.rowCount !== 1) throw createError({ statusCode: 409, statusMessage: 'This offer is no longer waiting.' })
  await client.query(
    `INSERT INTO actor_audit_log (actor_id, action, target_type, target_id, details)
     VALUES ($1, $2, 'page_transfer', $3, jsonb_build_object(
       'topic_id', $4::text, 'from_actor_id', $5::text, 'to_actor_id', $6::text, 'status', $7::text))`,
    [actor.id, auditAction, row.id, row.topic_id, row.from_actor_id, row.to_actor_id, status],
  )
  const transfer = { id: updated.rows[0].id, status: updated.rows[0].status, decidedAt: updated.rows[0].decided_at }
  if (status === 'withdrawn') return { conflict: 'steward_changed', transfer }
  return { transfer }
}

function activityEvent(row) {
  return {
    at: row.at,
    kind: row.kind,
    actor: person(row.actor_username, row.actor_public_id, row.actor_display_name),
    other: person(row.other_username, row.other_public_id, row.other_display_name),
    from: person(row.from_username, row.from_public_id, row.from_display_name),
    title: row.title || null,
    detail: row.detail || null,
    refId: row.ref_id,
    status: row.status || null,
  }
}

export async function listPageActivity(db, topicId, { limit, offset }) {
  const [items, count] = await Promise.all([
    db.query(
      `SELECT at, kind, actor_username, actor_display_name, actor_public_id,
              other_username, other_display_name, other_public_id,
              from_username, from_display_name, from_public_id, title, detail, ref_id, status
         FROM (
           SELECT r.created_at AS at,
                  CASE WHEN r.id = (
                    SELECT id FROM revisions WHERE topic_id = $1 ORDER BY created_at ASC, id ASC LIMIT 1
                  ) THEN 'page_created' ELSE 'revision_published' END AS kind,
                  author.username AS actor_username, author.display_name AS actor_display_name, author.public_id AS actor_public_id,
                  NULL::text AS other_username, NULL::text AS other_display_name, NULL::bigint AS other_public_id,
                  NULL::text AS from_username, NULL::text AS from_display_name, NULL::bigint AS from_public_id,
                  r.title AS title, left(r.summary, 500) AS detail, r.id::text AS ref_id, NULL::text AS status
             FROM revisions r
             LEFT JOIN actors author ON author.id = r.author_id
            WHERE r.topic_id = $1
           UNION ALL
           SELECT p.created_at, 'edit_proposed',
                  author.username, author.display_name, author.public_id,
                  NULL::text, NULL::text, NULL::bigint, NULL::text, NULL::text, NULL::bigint,
                  p.proposed_title, left(p.rationale, 500), p.id::text, p.status
             FROM edit_proposals p
             LEFT JOIN actors author ON author.id = p.author_id
            WHERE p.topic_id = $1
           UNION ALL
           SELECT p.reviewed_at,
                  CASE WHEN p.status = 'rejected' THEN 'edit_rejected' ELSE 'edit_accepted' END,
                  reviewer.username, reviewer.display_name, reviewer.public_id,
                  author.username, author.display_name, author.public_id,
                  NULL::text, NULL::text, NULL::bigint,
                  p.proposed_title, left(p.review_comment, 500), p.id::text, p.status
             FROM edit_proposals p
             LEFT JOIN actors reviewer ON reviewer.id = p.reviewed_by_actor_id
             LEFT JOIN actors author ON author.id = p.author_id
            WHERE p.topic_id = $1 AND p.reviewed_at IS NOT NULL
              AND p.status IN ('accepted', 'rejected', 'partially_accepted')
           UNION ALL
           SELECT tr.created_at, 'transfer_offered',
                  offerer.username, offerer.display_name, offerer.public_id,
                  recipient.username, recipient.display_name, recipient.public_id,
                  steward.username, steward.display_name, steward.public_id,
                  NULL::text, tr.note, tr.id::text, tr.status
             FROM page_transfers tr
             LEFT JOIN actors offerer ON offerer.id = tr.offered_by_actor_id
             LEFT JOIN actors recipient ON recipient.id = tr.to_actor_id
             LEFT JOIN actors steward ON steward.id = tr.from_actor_id
            WHERE tr.topic_id = $1
           UNION ALL
           SELECT tr.decided_at,
                  CASE tr.status
                    WHEN 'accepted' THEN 'transfer_accepted'
                    WHEN 'declined' THEN 'transfer_declined'
                    WHEN 'cancelled' THEN 'transfer_cancelled'
                    ELSE 'transfer_withdrawn'
                  END,
                  decider.username, decider.display_name, decider.public_id,
                  CASE tr.status WHEN 'accepted' THEN steward.username WHEN 'declined' THEN offerer.username ELSE recipient.username END,
                  CASE tr.status WHEN 'accepted' THEN steward.display_name WHEN 'declined' THEN offerer.display_name ELSE recipient.display_name END,
                  CASE tr.status WHEN 'accepted' THEN steward.public_id WHEN 'declined' THEN offerer.public_id ELSE recipient.public_id END,
                  steward.username, steward.display_name, steward.public_id,
                  NULL::text, NULL::text, tr.id::text, tr.status
             FROM page_transfers tr
             LEFT JOIN actors decider ON decider.id = tr.decided_by_actor_id
             LEFT JOIN actors recipient ON recipient.id = tr.to_actor_id
             LEFT JOIN actors offerer ON offerer.id = tr.offered_by_actor_id
             LEFT JOIN actors steward ON steward.id = tr.from_actor_id
            WHERE tr.topic_id = $1 AND tr.decided_at IS NOT NULL AND tr.status <> 'pending'
         ) events
        ORDER BY at DESC, kind ASC, ref_id DESC
        LIMIT $2 OFFSET $3`,
      [topicId, limit, offset],
    ),
    db.query(
      `SELECT (
         (SELECT count(*) FROM revisions WHERE topic_id = $1)
         + (SELECT count(*) FROM edit_proposals WHERE topic_id = $1)
         + (SELECT count(*) FROM edit_proposals WHERE topic_id = $1 AND reviewed_at IS NOT NULL AND status IN ('accepted', 'rejected', 'partially_accepted'))
         + (SELECT count(*) FROM page_transfers WHERE topic_id = $1)
         + (SELECT count(*) FROM page_transfers WHERE topic_id = $1 AND decided_at IS NOT NULL AND status <> 'pending')
       )::int AS total`,
      [topicId],
    ),
  ])
  return { items: items.rows.map(activityEvent), total: count.rows[0]?.total || 0 }
}

export async function listIncomingTransfers(db, actorId) {
  const result = await db.query(
    `SELECT tr.id, t.slug, r.title, tr.note, tr.created_at,
            offerer.username AS offered_by_username, offerer.display_name AS offered_by_display_name, offerer.public_id AS offered_by_public_id,
            steward.username AS from_username, steward.display_name AS from_display_name, steward.public_id AS from_public_id
       FROM page_transfers tr
       JOIN topics t ON t.id = tr.topic_id AND t.status = 'published'
       JOIN LATERAL (
         SELECT revision_id FROM topic_current_revisions
          WHERE topic_id = t.id
          ORDER BY (locale = 'en') DESC, locale
          LIMIT 1
       ) current ON true
       JOIN revisions r ON r.id = current.revision_id
       LEFT JOIN actors offerer ON offerer.id = tr.offered_by_actor_id
       LEFT JOIN actors steward ON steward.id = tr.from_actor_id
      WHERE tr.to_actor_id = $1 AND tr.status = 'pending'
      ORDER BY tr.created_at DESC
      LIMIT 50`,
    [actorId],
  )
  return result.rows.map(row => ({
    id: row.id,
    slug: row.slug,
    title: row.title,
    note: row.note || null,
    createdAt: row.created_at,
    offeredBy: person(row.offered_by_username, row.offered_by_public_id, row.offered_by_display_name),
    from: person(row.from_username, row.from_public_id, row.from_display_name),
  }))
}
