import { notificationHref } from './notifications.js'
import { sendEmail, emailDeliveryEnabled } from './email.js'

const POLL_INTERVAL_MS = 15_000
const BATCH_SIZE = 10
const MAX_ATTEMPTS = 8

export function startNotificationEmailExecutor(database, runtimeConfig = {}) {
  if (!database || !emailDeliveryEnabled(runtimeConfig)) return () => {}
  let tickRunning = false
  const tick = async () => {
    if (tickRunning) return
    tickRunning = true
    try {
      const jobs = await claimDueDeliveries(database)
      for (const job of jobs) {
        try {
          await sendEmail(buildNotificationEmail(job, runtimeConfig), runtimeConfig)
          await database.query(
            `UPDATE notification_email_deliveries
                SET status = 'sent', sent_at = now(), locked_until = NULL,
                    last_error = NULL, updated_at = now()
              WHERE id = $1 AND status = 'sending'`,
            [job.id],
          )
        } catch (error) {
          await recordDeliveryFailure(database, job, error)
          console.error('[notification-email] delivery failed', error?.message || error)
        }
      }
    } finally {
      tickRunning = false
    }
  }
  void tick().catch(error => console.error('[notification-email] executor tick failed', error?.message || error))
  const timer = setInterval(() => { void tick().catch(error => console.error('[notification-email] executor tick failed', error?.message || error)) }, POLL_INTERVAL_MS)
  timer.unref?.()
  return () => clearInterval(timer)
}

async function claimDueDeliveries(database) {
  const client = await database.connect()
  try {
    await client.query('BEGIN')
    const claimed = await client.query(
      `WITH due AS (
         SELECT delivery.id
           FROM notification_email_deliveries delivery
          WHERE delivery.attempts < $1
            AND (
              (delivery.status IN ('pending', 'failed') AND delivery.next_attempt_at <= now())
              OR (delivery.status = 'sending' AND delivery.locked_until < now())
            )
          ORDER BY delivery.next_attempt_at, delivery.created_at
          FOR UPDATE SKIP LOCKED
          LIMIT $2
       )
       UPDATE notification_email_deliveries delivery
          SET status = 'sending', attempts = delivery.attempts + 1,
              locked_until = now() + interval '5 minutes', updated_at = now()
         FROM due
        WHERE delivery.id = due.id
       RETURNING delivery.id`,
      [MAX_ATTEMPTS, BATCH_SIZE],
    )
    const ids = claimed.rows.map(row => row.id)
    if (!ids.length) {
      await client.query('COMMIT')
      return []
    }
    const jobs = await client.query(
      `SELECT delivery.id, delivery.attempts,
              notification.kind, notification.reply_id,
              recipient.email,
              topic.slug,
              coalesce(page.title, topic.slug, 'AIKI') AS title,
              coalesce(actor.display_name, actor.agent_name, actor.username, 'AIKI') AS actor_name,
              left(coalesce(proposal.rationale, reply.body_markdown, transfer.note,
                            solution.payload->>'rationale', solution.payload->>'summary',
                            solution.payload->>'title', ''), 400) AS excerpt
         FROM notification_email_deliveries delivery
         JOIN notifications notification ON notification.id = delivery.notification_id
         JOIN actors recipient ON recipient.id = delivery.recipient_id
         LEFT JOIN topics topic ON topic.id = notification.topic_id
         LEFT JOIN actors actor ON actor.id = notification.actor_id
         LEFT JOIN edit_proposals proposal ON proposal.id = notification.proposal_id
         LEFT JOIN replies reply ON reply.id = notification.reply_id
         LEFT JOIN page_transfers transfer ON transfer.id = notification.transfer_id
         LEFT JOIN content_task_solutions solution ON solution.id = notification.task_solution_id
         LEFT JOIN LATERAL (
           SELECT revision.title
             FROM topic_current_revisions current
             JOIN revisions revision ON revision.id = current.revision_id
            WHERE current.topic_id = topic.id
            ORDER BY (current.locale = 'en') DESC, revision.created_at DESC
            LIMIT 1
         ) page ON true
        WHERE delivery.id = ANY($1::uuid[])`,
      [ids],
    )
    await client.query('COMMIT')
    return jobs.rows
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
}

export function buildNotificationEmail(job, runtimeConfig = {}) {
  const title = String(job.title || 'AIKI')
  const actor = String(job.actor_name || 'Someone')
  const excerpt = String(job.excerpt || '').replace(/\s+/g, ' ').trim()
  const subject = subjectFor(job.kind, title)
  const href = notificationHref({ kind: job.kind, slug: job.slug, replyId: job.reply_id })
  const siteUrl = String(runtimeConfig.public?.siteUrl || '').replace(/\/$/, '')
  const url = siteUrl ? `${siteUrl}${href}` : href
  const message = messageFor(job.kind, actor, title)
  const text = [message, excerpt, `Open in AIKI: ${url}`].filter(Boolean).join('\n\n')
  const html = `<p>${escapeHtml(message)}</p>${excerpt ? `<p>${escapeHtml(excerpt)}</p>` : ''}<p><a href="${escapeHtml(url)}">Open in AIKI</a></p>`
  return { to: job.email, subject, text, html }
}

function subjectFor(kind, title) {
  const prefix = {
    edit_proposal: 'New edit proposal',
    proposal_accepted: 'Your edit proposal was accepted',
    proposal_rejected: 'Your edit proposal was declined',
    page_comment: 'New comment on your page',
    comment_reply: 'New reply to your comment',
    page_transfer: 'A page was offered to you',
    task_solution: 'A task solution is waiting for review',
  }[kind] || 'New AIKI notification'
  return `${prefix}: ${title}`.slice(0, 240)
}

function messageFor(kind, actor, title) {
  const subject = {
    edit_proposal: `${actor} proposed an edit to “${title}”.`,
    proposal_accepted: `${actor} accepted your edit proposal for “${title}”.`,
    proposal_rejected: `${actor} declined your edit proposal for “${title}”.`,
    page_comment: `${actor} commented on “${title}”.`,
    comment_reply: `${actor} replied to your comment on “${title}”.`,
    page_transfer: `${actor} offered you the page “${title}”.`,
    task_solution: `${actor} submitted a task solution for “${title}”. It is waiting for your review.`,
  }[kind]
  return subject || `There is a new notification for “${title}” on AIKI.`
}

async function recordDeliveryFailure(database, job, error) {
  const retryable = error?.retryable !== false && Number(job.attempts || 0) < MAX_ATTEMPTS
  const delaySeconds = Math.min(3600, 30 * (2 ** Math.min(Number(job.attempts || 1) - 1, 6)))
  const lastError = String(error?.message || error || 'Email delivery failed').replace(/\s+/g, ' ').trim().slice(0, 1000)
  await database.query(
    `UPDATE notification_email_deliveries
        SET status = 'failed', locked_until = NULL,
            next_attempt_at = CASE WHEN $2::boolean THEN now() + ($3 * interval '1 second') ELSE now() + interval '100 years' END,
            last_error = $4, updated_at = now()
      WHERE id = $1 AND status = 'sending'`,
    [job.id, retryable, delaySeconds, lastError],
  )
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]))
}
