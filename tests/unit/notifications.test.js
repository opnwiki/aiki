import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { translate } from '../../app/utils/i18n.js'
import { isReservedSlug } from '../../server/utils/validation.js'
import { notificationHref } from '../../server/utils/notifications.js'
import { buildNotificationEmail } from '../../server/utils/notification-email-executor.js'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')

export async function run({ assert }) {
  assert.equal(notificationHref({ kind: 'edit_proposal', slug: 'citric-acid' }), '/citric-acid#article-proposals')
  assert.equal(notificationHref({ kind: 'page_comment', slug: 'citric-acid', replyId: '11111111-1111-4111-8111-111111111111' }), '/citric-acid#comment-11111111-1111-4111-8111-111111111111')
  assert.equal(notificationHref({ kind: 'page_transfer', slug: 'citric-acid' }), '/account#transfers')
  assert.equal(isReservedSlug('notifications'), true)
  assert.equal(translate('ru', 'notifications.title'), 'Уведомления')
  assert.equal(translate('en', 'notifications.kind.edit_proposal', { name: 'Ada', title: 'Acid' }), 'Ada proposed an edit to “Acid”.')
  assert.equal(translate('ru', 'nav.notifications'), 'Уведомления')
  assert.equal(translate('ru', 'notifications.filter.edits'), 'Правки')
  assert.equal(translate('ru', 'notifications.filter.comments'), 'Комментарии')
  assert.equal(translate('ru', 'notifications.filter.transfers'), 'Страницы')
  assert.equal(translate('en', 'notifications.filter.unread'), 'New')

  const email = buildNotificationEmail({
    kind: 'page_comment',
    email: 'reader@example.org',
    slug: 'citric-acid',
    reply_id: '11111111-1111-4111-8111-111111111111',
    title: '<Citric acid>',
    actor_name: 'Ada & Bob',
    excerpt: 'A new comment',
  }, { public: { siteUrl: 'https://aiki.wiki' } })
  assert.equal(email.to, 'reader@example.org')
  assert.match(email.subject, /New comment on your page/)
  assert.match(email.text, /https:\/\/aiki\.wiki\/citric-acid#comment-/)
  assert.match(email.html, /&lt;Citric acid&gt;/)

  const app = await readFile(path.join(root, 'app/app.vue'), 'utf8')
  const page = await readFile(path.join(root, 'app/pages/notifications.vue'), 'utf8')
  const replies = await readFile(path.join(root, 'server/api/topics/[slug]/replies.post.js'), 'utf8')
  const proposals = await readFile(path.join(root, 'server/api/topics/[slug]/proposals.post.js'), 'utf8')
  const migration = await readFile(path.join(root, 'database/migrations/082_notification_email_outbox.sql'), 'utf8')
  const plugin = await readFile(path.join(root, 'server/plugins/article-order-executor.js'), 'utf8')
  const notifications = await readFile(path.join(root, 'server/utils/notifications.js'), 'utf8')
  assert.match(app, /data-testid="nav-notifications"/)
  assert.match(app, /data-testid="notifications-badge"/)
  assert.match(app, /data-testid="drawer-notifications"/)
  assert.match(page, /data-testid="notifications-list"/)
  assert.match(page, /data-testid="notification-filters"/)
  assert.match(page, /notification-filter-\$\{filter\.id\}/)
  assert.match(page, /id: 'edits'/)
  assert.match(page, /id: 'comments'/)
  assert.match(page, /id: 'transfers'/)
  assert.match(page, /notification-icon-\$\{item\.kind\}/)
  assert.match(page, /i-lucide-pencil/)
  assert.match(page, /i-lucide-circle-check/)
  assert.match(page, /i-lucide-circle-x/)
  assert.match(page, /i-lucide-message-square/)
  assert.match(page, /i-lucide-reply/)
  assert.match(page, /i-lucide-arrow-right-left/)
  assert.match(replies, /notifyReply/)
  assert.match(proposals, /notifyEditProposal/)
  assert.match(migration, /notification_email_deliveries/)
  assert.match(migration, /notification_id UUID NOT NULL UNIQUE/)
  assert.match(plugin, /startNotificationEmailExecutor/)
  assert.match(notifications, /queueNotificationEmails/)
  assert.match(notifications, /recipient\.email/)
}
