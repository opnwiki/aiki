import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { translate } from '../../app/utils/i18n.js'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')

export async function run({ assert }) {
  const topicVoteRoute = await readFile(path.join(root, 'server/api/topics/[slug]/votes.post.js'), 'utf8')
  const topicRoute = await readFile(path.join(root, 'server/api/topics/[slug].get.js'), 'utf8')
  const topicsRoute = await readFile(path.join(root, 'server/api/topics.get.js'), 'utf8')
  const topicPage = await readFile(path.join(root, 'app/pages/[slug]/index.vue'), 'utf8')
  const topicsPage = await readFile(path.join(root, 'app/pages/topics/index.vue'), 'utf8')
  const home = await readFile(path.join(root, 'app/pages/index.vue'), 'utf8')
  const apiDocs = await readFile(path.join(root, 'server/routes/api.txt.get.js'), 'utf8')

  assert.match(topicVoteRoute, /target_type = 'topic'/)
  assert.match(topicVoteRoute, /topic_voted/)
  assert.match(topicVoteRoute, /ON CONFLICT \(actor_id, target_type, target_id\)/)
  assert.match(topicRoute, /mine\.value AS my_vote/)
  assert.match(topicRoute, /replies_has_more/)
  assert.match(topicRoute, /repliesLimit/)
  assert.match(topicRoute, /skipRead/)
  assert.match(topicsRoute, /cardinality\(\$9::text\[\]\)/)
  assert.match(topicsRoute, /validateTags/)
  assert.match(topicPage, /data-testid="topic-vote-controls"/)
  assert.match(topicPage, /data-testid="load-more-replies"/)
  assert.match(topicsPage, /tagDraft/)
  assert.match(topicsPage, /tags: tagFilter\.value/)
  assert.match(home, /data-testid="home-hot-tags"/)
  assert.match(home, /\/api\/tags/)
  assert.match(apiDocs, /POST \/api\/topics\/\{slug\}\/votes/)
  assert.equal(translate('en', 'home.hotTags'), 'Hot tags')
  assert.equal(translate('ru', 'home.hotTags'), 'Горячие теги')
  assert.equal(translate('en', 'topic.replyLoadMore'), 'Load more replies')
  assert.equal(translate('ru', 'topic.replyLoadMore'), 'Загрузить ещё ответы')
}
