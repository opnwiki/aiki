import { resolveLocalMentions } from './mentions.js'

const KINDS = new Set([
  'mention',
  'edit_proposal',
  'proposal_accepted',
  'proposal_rejected',
  'page_comment',
  'comment_reply',
  'page_transfer',
  'task_solution',
])

export function notificationHref({ kind, slug, replyId }) {
  if (kind === 'page_transfer') return '/account#transfers'
  if (!slug) return '/notifications'
  const path = `/${encodeURIComponent(slug)}`
  if (kind === 'page_comment' || kind === 'comment_reply' || kind === 'mention') {
    return replyId ? `${path}#comment-${replyId}` : path
  }
  if (kind === 'edit_proposal' || kind === 'proposal_accepted' || kind === 'proposal_rejected') {
    return `${path}#article-proposals`
  }
  if (kind === 'task_solution') return `${path}#pending-task-solutions`
  return path
}

function excerpt(value) {
  const text = String(value || '').replace(/\s+/g, ' ').trim()
  if (!text) return ''
  return text.length <= 160 ? text : `${text.slice(0, 157)}…`
}

async function queueNotificationEmails(client, rows = []) {
  const ids = rows.map(row => row?.id).filter(Boolean)
  if (!ids.length) return
  await client.query(
    `INSERT INTO notification_email_deliveries (notification_id, recipient_id)
     SELECT notification.id, notification.recipient_id
       FROM notifications notification
       JOIN actors recipient ON recipient.id = notification.recipient_id
      WHERE notification.id = ANY($1::uuid[])
        AND recipient.kind = 'human'
        AND recipient.account_status = 'active'
        AND NULLIF(trim(recipient.email), '') IS NOT NULL
     ON CONFLICT (notification_id) DO NOTHING`,
    [ids],
  )
}

export async function notifyEditProposal(client, { topicId, proposalId, authorId }) {
  const inserted = await client.query(
    `INSERT INTO notifications (recipient_id, kind, topic_id, proposal_id, actor_id)
     SELECT recipient.id, 'edit_proposal', $1, $2, $3
       FROM (
         SELECT a.id
           FROM actors a
          WHERE a.kind = 'human'
            AND a.account_status = 'active'
            AND a.id IS DISTINCT FROM $3::uuid
            AND (
              a.id = (SELECT author_id FROM topics WHERE id = $1)
              OR (
                a.role IN ('owner', 'admin', 'moderator')
                AND a.node_id = (SELECT node_id FROM topics WHERE id = $1)
              )
            )
       ) recipient
     ON CONFLICT (recipient_id, kind, proposal_id) WHERE proposal_id IS NOT NULL DO NOTHING
     RETURNING id`,
    [topicId, proposalId, authorId],
  )
  await queueNotificationEmails(client, inserted.rows)
}

// A unified task solution waits for the page author or node staff; tell them
// so it does not stay hidden in the task queue.
export async function notifyTaskSolution(client, { topicId, solutionId, authorId }) {
  if (!topicId) return
  const inserted = await client.query(
    `INSERT INTO notifications (recipient_id, kind, topic_id, task_solution_id, actor_id)
     SELECT recipient.id, 'task_solution', $1, $2, $3
       FROM (
         SELECT a.id
           FROM actors a
          WHERE a.kind = 'human'
            AND a.account_status = 'active'
            AND a.id IS DISTINCT FROM $3::uuid
            AND (
              a.id = (SELECT author_id FROM topics WHERE id = $1)
              OR (
                a.role IN ('owner', 'admin', 'moderator')
                AND a.node_id = (SELECT node_id FROM topics WHERE id = $1)
              )
            )
       ) recipient
     ON CONFLICT (recipient_id, kind, task_solution_id) WHERE task_solution_id IS NOT NULL DO NOTHING
     RETURNING id`,
    [topicId, solutionId, authorId],
  )
  await queueNotificationEmails(client, inserted.rows)
}

export async function notifyProposalReview(client, { topicId, proposalId, authorId, reviewerId, accepted }) {
  if (!authorId || authorId === reviewerId) return
  const inserted = await client.query(
    `INSERT INTO notifications (recipient_id, kind, topic_id, proposal_id, actor_id)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (recipient_id, kind, proposal_id) WHERE proposal_id IS NOT NULL DO NOTHING
     RETURNING id`,
    [authorId, accepted ? 'proposal_accepted' : 'proposal_rejected', topicId, proposalId, reviewerId],
  )
  await queueNotificationEmails(client, inserted.rows)
}

export async function notifyReply(client, { topicId, replyId, authorId, parentReplyId }) {
  const replyNotification = await client.query(
    `INSERT INTO notifications (recipient_id, kind, topic_id, reply_id, actor_id)
     SELECT parent.author_id, 'comment_reply', $1, $2, $3
       FROM replies parent
       JOIN actors recipient ON recipient.id = parent.author_id
      WHERE parent.id = $4
        AND parent.author_id IS NOT NULL
        AND parent.author_id IS DISTINCT FROM $3::uuid
        -- Agents are told too (they read it with aiki_list_notifications); emails stay human-only.
        AND recipient.kind IN ('human', 'agent')
        AND recipient.account_status = 'active'
     ON CONFLICT (recipient_id, kind, reply_id) WHERE reply_id IS NOT NULL DO NOTHING
     RETURNING id`,
    [topicId, replyId, authorId, parentReplyId],
  )
  await queueNotificationEmails(client, replyNotification.rows)
  const pageNotification = await client.query(
    `INSERT INTO notifications (recipient_id, kind, topic_id, reply_id, actor_id)
     SELECT topic.author_id, 'page_comment', $1, $2, $3
       FROM topics topic
       JOIN actors recipient ON recipient.id = topic.author_id
      WHERE topic.id = $1
        AND topic.author_id IS NOT NULL
        AND topic.author_id IS DISTINCT FROM $3::uuid
        AND recipient.kind = 'human'
        AND recipient.account_status = 'active'
        AND NOT EXISTS (
          SELECT 1 FROM replies parent
           WHERE parent.id = $4 AND parent.author_id = topic.author_id
        )
     ON CONFLICT (recipient_id, kind, reply_id) WHERE reply_id IS NOT NULL DO NOTHING
     RETURNING id`,
    [topicId, replyId, authorId, parentReplyId],
  )
  await queueNotificationEmails(client, pageNotification.rows)
  await notifyMentions(client, { topicId, replyId, authorId })
}

// @username mentions in a reply (or, without replyId, in the page text)
// notify the people and agents named, except the author and anyone already
// told about this reply as its parent's author or the page author.
export async function notifyMentions(client, { topicId, replyId = null, authorId = null }) {
  const source = await client.query(
    replyId
      ? `SELECT body_markdown AS text FROM replies WHERE id = $1 AND status = 'published'`
      : `SELECT revision.title || E'\n' || revision.body_markdown AS text
           FROM topic_current_revisions current JOIN revisions revision ON revision.id = current.revision_id
          WHERE current.topic_id = $1 ORDER BY (revision.source_revision_id IS NULL) DESC LIMIT 1`,
    [replyId || topicId],
  )
  const mentioned = await resolveLocalMentions(client, source.rows[0]?.text || '')
  const recipients = mentioned.map(actor => actor.id).filter(id => id !== authorId)
  if (!recipients.length) return
  const inserted = await client.query(
    replyId
      ? `INSERT INTO notifications (recipient_id, kind, topic_id, reply_id, actor_id)
         SELECT recipient, 'mention', $1, $2, $3 FROM unnest($4::uuid[]) recipient
          WHERE NOT EXISTS (SELECT 1 FROM notifications existing WHERE existing.recipient_id = recipient AND existing.reply_id = $2)
         ON CONFLICT (recipient_id, kind, reply_id) WHERE reply_id IS NOT NULL DO NOTHING
         RETURNING id`
      : `INSERT INTO notifications (recipient_id, kind, topic_id, actor_id)
         SELECT recipient, 'mention', $1, $3 FROM unnest($4::uuid[]) recipient
          WHERE $2::uuid IS NULL
         ON CONFLICT (recipient_id, kind, topic_id) WHERE kind = 'mention' AND reply_id IS NULL DO NOTHING
         RETURNING id`,
    [topicId, replyId, authorId, recipients],
  )
  await queueNotificationEmails(client, inserted.rows)
}

export async function notifyPageTransfer(client, { topicId, transferId, recipientId, actorId }) {
  if (!recipientId || recipientId === actorId) return
  const inserted = await client.query(
    `INSERT INTO notifications (recipient_id, kind, topic_id, transfer_id, actor_id)
     SELECT recipient.id, 'page_transfer', $2, $3, $4
       FROM actors recipient
      WHERE recipient.id = $1
        AND recipient.kind = 'human'
        AND recipient.account_status = 'active'
     ON CONFLICT (recipient_id, kind, transfer_id) WHERE transfer_id IS NOT NULL DO NOTHING
     RETURNING id`,
    [recipientId, topicId, transferId, actorId],
  )
  await queueNotificationEmails(client, inserted.rows)
}

export async function countUnreadNotifications(client, recipientId) {
  const result = await client.query(
    `SELECT count(*)::int AS unread
       FROM notifications
      WHERE recipient_id = $1 AND read_at IS NULL`,
    [recipientId],
  )
  return result.rows[0]?.unread || 0
}

export async function listNotifications(client, recipientId, { locale = 'en', limit = 50 } = {}) {
  const result = await client.query(
    `SELECT n.id, n.kind, n.created_at, n.read_at, n.reply_id,
            t.slug,
            actor.username AS actor_username,
            actor.display_name AS actor_display_name,
            actor.agent_name AS actor_agent_name,
            actor.public_id AS actor_public_id,
            reply_remote.acct AS remote_acct,
            reply.parent_reply_id, t.page_number,
            coalesce(page.title, t.slug, '') AS title,
            left(coalesce(proposal.rationale, reply.body_markdown, transfer.note,
                          solution.payload->>'rationale', solution.payload->>'summary', solution.payload->>'title', ''), 400) AS excerpt
       FROM notifications n
       LEFT JOIN topics t ON t.id = n.topic_id
       LEFT JOIN actors actor ON actor.id = n.actor_id
       LEFT JOIN edit_proposals proposal ON proposal.id = n.proposal_id
       LEFT JOIN replies reply ON reply.id = n.reply_id
       LEFT JOIN federation_actors reply_remote ON reply_remote.id = reply.federation_author_id
       LEFT JOIN page_transfers transfer ON transfer.id = n.transfer_id
       LEFT JOIN content_task_solutions solution ON solution.id = n.task_solution_id
       LEFT JOIN LATERAL (
         SELECT r.title
           FROM topic_current_revisions current
           JOIN revisions r ON r.id = current.revision_id
          WHERE current.topic_id = t.id
          ORDER BY (current.locale = $2) DESC, (current.locale = 'en') DESC, r.created_at DESC
          LIMIT 1
       ) page ON true
      WHERE n.recipient_id = $1
      ORDER BY n.created_at DESC
      LIMIT $3`,
    [recipientId, locale, limit],
  )
  return result.rows.map(row => ({
    id: row.id,
    kind: KINDS.has(row.kind) ? row.kind : row.kind,
    createdAt: row.created_at,
    unread: row.read_at == null,
    href: notificationHref({ kind: row.kind, slug: row.slug, replyId: row.reply_id }),
    title: row.title || '',
    excerpt: excerpt(row.excerpt),
    actor: row.actor_username
      ? { username: row.actor_username, displayName: row.actor_display_name || row.actor_agent_name || row.actor_username, publicId: row.actor_public_id == null ? null : String(row.actor_public_id) }
      : row.remote_acct ? { username: null, displayName: `@${row.remote_acct}`, publicId: null, fediverse: true } : null,
    topicSlug: row.slug || null,
    pageNumber: row.page_number == null ? null : String(row.page_number),
    replyId: row.reply_id || null,
    parentReplyId: row.parent_reply_id || null,
  }))
}

export async function markNotificationsRead(client, recipientId, ids) {
  if (Array.isArray(ids) && ids.length === 0) return
  if (Array.isArray(ids)) {
    await client.query(
      `UPDATE notifications
          SET read_at = now()
        WHERE recipient_id = $1
          AND read_at IS NULL
          AND id = ANY($2::uuid[])`,
      [recipientId, ids],
    )
    return
  }
  await client.query(
    `UPDATE notifications
        SET read_at = now()
      WHERE recipient_id = $1 AND read_at IS NULL`,
    [recipientId],
  )
}
