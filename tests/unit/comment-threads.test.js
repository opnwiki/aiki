import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildCommentThreads, hasDeepCommentThread } from '../../app/utils/comment-threads.js'
import { translate } from '../../app/utils/i18n.js'
import { MAX_REPLY_DEPTH, presentReplyVote, requirePublishedParent } from '../../server/utils/replies.js'
import { inferReplyLocale } from '../../server/utils/translate-replies.js'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')

export async function run({ assert }) {
  const parent = reply('parent', null, 1, 0, '2026-10-02T00:00:00.000Z')
  const child = reply('child', 'parent', 3, 0, '2026-10-02T00:01:00.000Z')
  const later = reply('later', null, 0, 0, '2026-10-02T00:02:00.000Z')
  const threads = buildCommentThreads([later, child, parent])
  assert.deepEqual(threads.map(item => item.id), ['parent', 'later'])
  assert.deepEqual(threads[0].children.map(item => item.id), ['child'])
  assert.equal(threads[0].score, 1)
  assert.equal(threads[0].children[0].score, 3)
  assert.equal(hasDeepCommentThread(threads), false)
  assert.equal(hasDeepCommentThread([{ children: [{ children: [{ children: [] }] }] }]), true)

  // GitHub-style: every answer sits flat under its top-level comment, by time,
  // and an answer to an answer remembers whom it answers.
  const grandchild = reply('grandchild', 'child', 0, 0, '2026-10-02T00:03:00.000Z')
  const sibling = reply('sibling', 'parent', 9, 0, '2026-10-02T00:02:30.000Z')
  const flat = buildCommentThreads([grandchild, sibling, later, child, parent])
  assert.deepEqual(flat[0].children.map(item => item.id), ['child', 'sibling', 'grandchild'])
  assert.equal(flat[0].children[2].reply_to.id, 'child')
  assert.equal(flat[0].children[0].reply_to, null)
  assert.equal(flat[0].children.every(item => item.children.length === 0), true)
  assert.deepEqual(buildCommentThreads([parent, later], { sort: 'newest' }).map(item => item.id), ['later', 'parent'])
  assert.deepEqual(buildCommentThreads([later, parent], { sort: 'top' }).map(item => item.id), ['parent', 'later'])
  assert.deepEqual(buildCommentThreads([later, parent], { sort: 'bogus' }).map(item => item.id), ['parent', 'later'])

  const hoisted = buildCommentThreads([reply('orphan', 'missing', 0, 0, '2026-10-02T00:00:00.000Z')])
  assert.equal(hoisted[0].id, 'orphan')
  assert.equal(hoisted[0].children.length, 0)

  const cyclic = buildCommentThreads([
    { ...reply('a', 'b', 0, 0, '2026-10-02T00:00:00.000Z') },
    { ...reply('b', 'a', 0, 0, '2026-10-02T00:01:00.000Z') },
  ])
  assert.deepEqual(cyclic.map(item => item.id).sort(), ['a', 'b'])
  assert.equal(cyclic.every(item => item.children.length === 0), true)

  const sameScore = buildCommentThreads([
    reply('second', null, 1, 0, '2026-10-02T00:02:00.000Z'),
    reply('first', null, 2, 1, '2026-10-02T00:01:00.000Z'),
  ])
  assert.deepEqual(sameScore.map(item => item.id), ['first', 'second'])
  assert.equal(presentReplyVote({ upvotes: 2, downvotes: 5 }, -1).score, -3)
  assert.equal(presentReplyVote({ upvotes: 1, downvotes: 0 }, 0).my_vote, null)

  const calls = []
  await assert.rejects(
    () => requirePublishedParent({ query: async (sql, params) => { calls.push({ sql, params }); return { rows: [{ found: 0, depth: 0 }] } } }, 'topic', '00000000-0000-4000-8000-000000000099'),
    (error) => error.statusCode === 400 && /published comment/.test(error.statusMessage),
  )
  assert.match(calls[0].sql, /\$1::uuid/)
  assert.equal(calls[0].params[2], MAX_REPLY_DEPTH)
  const accepted = await requirePublishedParent({
    query: async () => ({ rows: [{ found: 1, depth: MAX_REPLY_DEPTH - 1 }] }),
  }, 'topic', '00000000-0000-4000-8000-000000000099')
  assert.equal(accepted, '00000000-0000-4000-8000-000000000099')
  await assert.rejects(
    () => requirePublishedParent({ query: async () => ({ rows: [{ found: 1, depth: MAX_REPLY_DEPTH }] }) }, 'topic', '00000000-0000-4000-8000-000000000099'),
    (error) => error.statusCode === 400 && /as deep as replies can go/.test(error.statusMessage),
  )
  assert.equal(await requirePublishedParent({ query: async () => { throw new Error('should not query') } }, 'topic', null), null)

  const voteRoute = await readFile(path.join(root, 'server/api/topics/[slug]/replies/[replyId]/votes.post.js'), 'utf8')
  assert.match(voteRoute, /ON CONFLICT \(actor_id, target_type, target_id\)/)
  assert.match(voteRoute, /\$1::uuid, 'reply', \$2::uuid/)
  assert.match(voteRoute, /\$2::text/)
  const replyRoute = await readFile(path.join(root, 'server/api/topics/[slug]/replies.post.js'), 'utf8')
  assert.match(replyRoute, /parent_reply_id/)
  assert.match(replyRoute, /VALUES \(\$1, NULLIF\(\$2::text, ''\), NULLIF\(\$3::text, ''\), 'external', \$4::date\)/)
  assert.doesNotMatch(replyRoute, /\$6::date/)
  const editReplyRoute = await readFile(path.join(root, 'server/api/topics/[slug]/replies/[replyId].patch.js'), 'utf8')
  const deleteReplyRoute = await readFile(path.join(root, 'server/api/topics/[slug]/replies/[replyId].delete.js'), 'utf8')
  assert.match(editReplyRoute, /Only your own replies can be edited/)
  assert.match(editReplyRoute, /updated_at = now\(\)/)
  assert.match(editReplyRoute, /DELETE FROM reply_translations/)
  assert.match(deleteReplyRoute, /Only your own replies can be deleted/)
  assert.match(deleteReplyRoute, /SET status = 'deleted'/)
  assert.match(deleteReplyRoute, /DELETE FROM reply_translations/)
  const editMigration = await readFile(path.join(root, 'database/migrations/059_reply_edits.sql'), 'utf8')
  assert.match(editMigration, /updated_at TIMESTAMPTZ/)
  const migration = await readFile(path.join(root, 'database/migrations/018_reply_thread_indexes.sql'), 'utf8')
  assert.match(migration, /replies_parent_reply_idx/)
  assert.match(migration, /votes_target_idx/)
  const page = await readFile(path.join(root, 'app/pages/[slug]/index.vue'), 'utf8')
  const thread = await readFile(path.join(root, 'app/components/CommentThread.vue'), 'utf8')
  assert.match(page, /buildCommentThreads/)
  assert.match(page, /comment-list/)
  assert.match(page, /data-testid="comment-tree"/)
  // Text always wraps: the tree never becomes as wide as its longest line.
  assert.doesNotMatch(page, /comment-tree-scroll--active/)
  assert.match(thread, /const VISIBLE_REPLIES = 3/)
  assert.match(thread, /data-testid="comment-show-previous"/)
  assert.match(page, /data-testid="comment-sort"/)
  assert.match(page, /@click="toggleOverview"/)
  assert.match(page, /i-lucide-chevron-down/)
  assert.match(page, /data-testid="topic-reply-anonymous"/)
  assert.match(page, /replyAnonymous\.value === true/)
  assert.match(page, /submitReplyEdit/)
  assert.match(page, /data-testid="comment-delete-confirm"/)
  assert.match(thread, /data-testid="comment-reply-anonymous"/)
  assert.match(thread, /data-testid="comment-edit"/)
  assert.match(thread, /data-testid="comment-delete"/)
  assert.match(thread, /data-testid="comment-edit-anonymous"/)
  assert.match(thread, /data-testid="comment-edited"/)
  assert.match(thread, /:title="formatDateTime\(reply\.created_at\)" data-testid="comment-created-at"/)
  assert.match(thread, /anonymous: anonymous\.value/)
  assert.match(thread, /data-testid="comment-translation-toggle"/)
  assert.match(thread, /data-testid="comment-sources"/)
  assert.match(thread, /data-testid="comment-branch-toggle"/)
  assert.doesNotMatch(thread, /comment-branch--scroll/)
  assert.match(thread, /hasBranchControls/)
  assert.match(thread, /reply\.citations/)
  assert.match(thread, /topic\.replySources/)
  assert.match(thread, /class="mt-2 flex flex-wrap items-center gap-2" data-testid="comment-actions"/)
  assert.match(thread, /translation\.sourceLocale !== locale\.value/)
  assert.match(thread, /showOriginal \? reply\.original_html : reply\.html/)
  const topicRoute = await readFile(path.join(root, 'server/api/topics/[slug].get.js'), 'utf8')
  assert.match(topicRoute, /replyTranslations\.get\(reply\.id\)/)
  assert.match(topicRoute, /WHERE c\.reply_id = r\.id/)
  assert.equal(inferReplyLocale('Русский ответ с кириллицей.', 'en'), 'ru')
  assert.equal(inferReplyLocale('English reply.', 'en'), 'en')
  assert.equal(inferReplyLocale('¿Qué es AIKI y para qué se necesita?', 'ru'), 'es')
  assert.equal(translate('ru', 'topic.reply'), 'Ответить')
  assert.equal(translate('ru', 'topic.replyAnonymous'), 'Ответить анонимно')
  assert.equal(translate('ru', 'topic.showOriginal'), 'Показать оригинал')
  assert.equal(translate('en', 'topic.anonymousReply'), 'Anonymous participant')
  assert.equal(translate('en', 'topic.join'), ' to join the discussion.')
  assert.equal(translate('ru', 'topic.upvote'), 'За')
  assert.equal(translate('en', 'topic.downvote'), 'Downvote')
  assert.equal(translate('ru', 'topic.editReply'), 'Редактировать ответ')
  assert.equal(translate('ru', 'topic.deleteReply'), 'Удалить ответ')
}

function reply(id, parentReplyId, upvotes, downvotes, createdAt) {
  return { id, parent_reply_id: parentReplyId, upvotes, downvotes, my_vote: null, created_at: createdAt, author: id, html: '<p>ok</p>' }
}
