import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { translate } from '../../app/utils/i18n.js'
import { classifyRecipient, cleanNote, managesPage } from '../../server/utils/page-transfer.js'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')

export async function run({ assert }) {
  assert.equal(classifyRecipient('12345678901234').kind, 'public_id')
  assert.equal(classifyRecipient('  Ada@Example.org ').kind, 'email')
  assert.equal(classifyRecipient('  Ada@Example.org ').value, 'ada@example.org')
  assert.equal(classifyRecipient('northern-writer').kind, 'username')
  assert.equal(classifyRecipient('ab').ok, false)
  assert.equal(classifyRecipient('not an email').ok, false)
  assert.equal(classifyRecipient('01234567890123').kind, 'username')
  assert.equal(cleanNote('  hello  ').value, 'hello')
  assert.equal(cleanNote('').value, null)
  assert.equal(cleanNote('x'.repeat(501)).ok, false)

  const steward = { id: 'author', node_id: 'node', role: 'member' }
  const owner = { id: 'owner', node_id: 'node', role: 'owner' }
  const stranger = { id: 'other', node_id: 'node', role: 'member' }
  const topic = { author_id: 'author', node_id: 'node' }
  assert.equal(managesPage(steward, topic), true)
  assert.equal(managesPage(owner, topic), true)
  assert.equal(managesPage(stranger, topic), false)
  assert.equal(managesPage(owner, { author_id: 'author', node_id: 'elsewhere' }), false)

  const source = await readFile(path.join(root, 'server/utils/page-transfer.js'), 'utf8')
  const activity = source.slice(source.indexOf('export async function listPageActivity'))
  assert.equal(activity.includes('email'), false)
  assert.match(activity, /page_created/)
  assert.match(activity, /edit_proposed/)
  assert.match(activity, /transfer_offered/)

  const page = await readFile(path.join(root, 'app/pages/[slug]/index.vue'), 'utf8')
  const activityComponent = await readFile(path.join(root, 'app/components/PageActivityLog.vue'), 'utf8')
  const account = await readFile(path.join(root, 'app/pages/account.vue'), 'utf8')
  assert.match(page, /data-testid="page-activity"|PageActivityLog/)
  assert.match(page, /displayedSources/)
  assert.match(page, /hiddenSourceCount/)
  assert.match(page, /retrieved_at/)
  assert.match(activityComponent, /items\.value\.slice\(0, 4\)/)
  assert.match(activityComponent, /hiddenCount/)
  assert.match(page, /PageTransferPanel/)
  assert.match(account, /data-testid="account-transfers"/)
  assert.match(account, /data-testid="account-transfer-accept"/)
  assert.match(account, /data-testid="account-transfer-decline"/)
  assert.equal(translate('ru', 'topic.transferTitle'), 'Управление доступом')
  assert.equal(translate('ru', 'topic.accessLevelManages'), 'Управляет')
  assert.equal(translate('ru', 'topic.accessRemove'), 'Удалить')
  assert.equal(translate('en', 'topic.transferOffer'), 'Invite')
  assert.equal(translate('ru', 'topic.activityTitle'), 'Журнал страницы')
  assert.equal(translate('ru', 'topic.showRemaining', { count: 3 }), 'Показать ещё: 3')
  assert.equal(translate('en', 'topic.hideRemaining'), 'Show less')
  assert.equal(translate('en', 'topic.transferAccept'), 'Accept')
  assert.match(translate('ru', 'topic.activityOffered', { name: 'a@n', other: 'b@n' }), /a@n/)
}
