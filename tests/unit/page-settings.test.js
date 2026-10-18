import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { translate } from '../../app/utils/i18n.js'
import { maskAuthorName, maskPerson } from '../../server/utils/author-privacy.js'
import { authorVisibility, effectiveAuthorHidden } from '../../server/utils/author-visibility.js'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')

export async function run({ assert }) {
  assert.equal(maskAuthorName('ada', 'ada'), null)
  assert.equal(maskAuthorName('grace', 'ada'), 'grace')
  assert.equal(maskPerson({ username: 'ada', publicId: '1' }, 'ada'), null)
  assert.deepEqual(maskPerson({ username: 'grace', publicId: '2' }, 'ada'), { username: 'grace', publicId: '2' })
  assert.equal(effectiveAuthorHidden(null, false), true)
  assert.equal(effectiveAuthorHidden(null, true), false)
  assert.equal(effectiveAuthorHidden(false, false), false)
  assert.equal(effectiveAuthorHidden(true, true), true)
  assert.equal(authorVisibility(null), 'profile')
  assert.equal(authorVisibility(false), 'show')
  assert.equal(authorVisibility(true), 'hide')

  const page = await readFile(path.join(root, 'app/pages/[slug]/index.vue'), 'utf8')
  const modal = await readFile(path.join(root, 'app/components/AppModal.vue'), 'utf8')
  assert.match(page, /data-testid="page-settings"/)
  assert.match(page, /:open="settingsOpen"/)
  assert.match(page, /@close="settingsOpen = false"/)
  assert.match(modal, /data-testid="app-modal-backdrop"/)
  assert.match(modal, /backdrop-blur-sm/)
  assert.match(page, /data-testid="page-edit-open"/)
  assert.match(page, /data-testid="page-edit-form"/)
  assert.match(page, /data-testid="page-author-visibility"/)
  assert.match(page, /data-testid="page-access-choice"/)
  assert.match(page, /PageTransferPanel plain/)
  const settings = page.slice(page.indexOf('page-settings-panel'), page.indexOf('id="article-content"'))
  assert.match(settings, /AssistantModerationPanel plain/)
  assert.equal(page.split('AssistantModerationPanel').length - 1, 1)
  assert.equal(translate('ru', 'moderation.assistantTitle'), 'Проверка моделью')
  assert.match(translate('ru', 'moderation.assistantHint'), /переключатель/)
  assert.match(translate('ru', 'moderation.nodeModelHint'), /всего узла/)
  assert.doesNotMatch(translate('ru', 'moderation.adminHint'), /настройках этой страницы/)
    assert.match(page, /data-testid="revision-history-open"/)
    assert.match(page, /RevisionHistoryPanel/)
    assert.doesNotMatch(page, /href="#article-history"/)
  assert.match(page, /data-testid="page-last-edit"/)
  const details = page.slice(page.indexOf('page-details-heading'))
  assert.ok(details.indexOf('page-short-url') < details.indexOf('page-last-edit'))

  const home = await readFile(path.join(root, 'app/pages/index.vue'), 'utf8')
  assert.doesNotMatch(home, /excerpt\(item\.body_markdown\)/)
  assert.match(home, /searchExcerpt\(item\?\.body_markdown\)/)
  assert.match(home, /data-testid="result-excerpt"/)
  assert.match(home, /await navigateTo\(target\)/)

  const task = await readFile(path.join(root, 'server/api/writing-tasks/[id].get.js'), 'utf8')
  assert.match(task, /task\.id = \$2::uuid/)

  const migration = await readFile(path.join(root, 'database/migrations/037_hide_author.sql'), 'utf8')
  assert.match(migration, /hide_author BOOLEAN NOT NULL DEFAULT false/)
  const defaultsMigration = await readFile(path.join(root, 'database/migrations/074_author_visibility_defaults.sql'), 'utf8')
  assert.match(defaultsMigration, /show_author BOOLEAN NOT NULL DEFAULT true/)
  assert.match(defaultsMigration, /ALTER COLUMN hide_author DROP NOT NULL/)
  assert.match(defaultsMigration, /SET hide_author = NULL/)

  assert.equal(translate('ru', 'order.create'), 'Создать статью')
  assert.equal(translate('en', 'order.create'), 'Create article')
  assert.equal(translate('ru', 'topic.hideAuthor'), 'Скрыть автора')
  assert.equal(translate('ru', 'topic.lastEdited'), 'Последнее редактирование')
  assert.match(translate('en', 'topic.hideAuthorHint'), /username and email/)
  assert.match(translate('en', 'topic.hideAuthorHint'), /AI model/)
  assert.equal(translate('ru', 'topic.authorHidden'), 'Автор скрыт')
  assert.equal(translate('ru', 'topic.authorVisibilityProfile'), 'Как в профиле')
  assert.equal(translate('ru', 'topic.authorVisibilityShow'), 'Показывать автора')
  assert.equal(translate('ru', 'topic.authorshipHumanHidden'), 'Автор человек, скрыт')
  assert.equal(translate('ru', 'topic.authorshipAIHidden'), 'Автор ИИ, скрыт')
  assert.equal(translate('ru', 'topic.authorshipAIReviewed'), 'Сгенерировано ИИ, проверено человеком')
  assert.equal(translate('ru', 'topic.editPage'), 'Редактировать страницу')
}
