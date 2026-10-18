import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { validateTags } from '../../server/utils/tags.js'
import { presentTagTranslations } from '../../server/utils/translate-tags.js'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')

export async function run({ assert }) {
  assert.deepEqual(validateTags(), { ok: true, errors: {}, value: [] })
  const checked = validateTags(['AI', '#машинное обучение', 'ai', ''])
  assert.equal(checked.ok, false)
  assert.deepEqual(checked.value, [
    { slug: 'ai', label: 'AI' },
    { slug: 'машинное-обучение', label: 'машинное обучение' },
  ])
  assert.equal(validateTags(['AI', 'ai']).ok, true)
  assert.equal(validateTags(Array.from({ length: 9 }, (_, index) => `tag-${index}`)).ok, false)
  assert.equal(validateTags('AI').ok, false)
  assert.equal(validateTags(['###']).ok, false)
  assert.deepEqual(presentTagTranslations([
    { id: 'one', slug: 'ai', label: 'AI' },
    { id: 'two', slug: 'science', label: 'Science' },
  ], new Map([['one', { label: 'ИИ' }]])), [
    { slug: 'ai', label: 'ИИ' },
    { slug: 'science', label: 'Science' },
  ])

  const migration = await readFile(path.join(root, 'database/migrations/048_topic_tags.sql'), 'utf8')
  assert.match(migration, /CREATE TABLE IF NOT EXISTS tags/)
  assert.match(migration, /CREATE TABLE IF NOT EXISTS topic_tags/)
  assert.match(migration, /UNIQUE \(node_id, slug\)/)
  const tagTranslationMigration = await readFile(path.join(root, 'database/migrations/077_tag_translations.sql'), 'utf8')
  assert.match(tagTranslationMigration, /CREATE TABLE IF NOT EXISTS tag_translations/)
  assert.match(tagTranslationMigration, /source_locale TEXT/)

  const topicRoute = await readFile(path.join(root, 'server/api/topics.post.js'), 'utf8')
  assert.match(topicRoute, /validateTags/)
  assert.match(topicRoute, /attachTopicTags/)
  const topicReadRoute = await readFile(path.join(root, 'server/api/topics/[slug].get.js'), 'utf8')
  assert.match(topicReadRoute, /ensureTagTranslations/)
  const autocomplete = await readFile(path.join(root, 'server/api/tags.get.js'), 'utf8')
  assert.match(autocomplete, /usage_count/)
  const composer = await readFile(path.join(root, 'app/components/TopicComposer.vue'), 'utf8')
  assert.match(composer, /data-testid="topic-tags-input"/)
  assert.match(composer, /\/api\/tags/)
  const mcp = await readFile(path.join(root, 'server/routes/mcp.post.js'), 'utf8')
  assert.match(mcp, /tags: \{ type: 'array'/)
  assert.match(mcp, /attachTopicTags/)
}
