import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { validateTopicRevision } from '../../server/utils/validation.js'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')

export async function run({ assert }) {
  const valid = validateTopicRevision({
    locale: 'ru',
    title: 'Обновлённое обсуждение',
    body: 'Новый текст страницы достаточно длинный для сохранения редакции.',
    summary: 'Краткий обзор страницы для читателей.',
  })
  assert.equal(valid.ok, true)
  assert.equal(valid.value.locale, 'ru')
  assert.equal(valid.value.summary, 'Краткий обзор страницы для читателей.')
  assert.equal(validateTopicRevision({ title: 'short', body: 'too short' }).ok, false)

  const route = await readFile(path.join(root, 'server/api/topics/[slug]/revisions.post.js'), 'utf8')
  assert.match(route, /Only the page author can edit this page/)
  assert.match(route, /INSERT INTO revisions/)
  assert.match(route, /INSERT INTO citations/)
  assert.match(route, /origin: 'author_edit'/)
  assert.match(route, /UPDATE topic_current_revisions SET revision_id/)

  const migration = await readFile(path.join(root, 'database/migrations/051_author_revision_edits.sql'), 'utf8')
  assert.match(migration, /author_edit/)
}
