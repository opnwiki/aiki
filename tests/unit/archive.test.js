import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { translate } from '../../app/utils/i18n.js'
import {
  ACCOUNT_ARCHIVE_KIND,
  buildAccountArchive,
  buildNodeArchive,
  groupArchivePages,
  NODE_ARCHIVE_KIND,
  NODE_ARCHIVE_KINDS,
  parseAccountArchive,
  presentComment,
} from '../../server/utils/archive.js'
import { PRODUCT_VERSION } from '../../server/utils/release.js'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')

export async function run({ assert }) {
  assert.deepEqual(NODE_ARCHIVE_KINDS, ['article', 'question'])
  const pages = groupArchivePages([
    { slug: 'maps', kind: 'article', created_at: '2026-01-02T00:00:00.000Z', author: 'ada', branch_slug: 'maps', branch_title: 'Maps', revision_id: 'rev-1', locale: 'en', title: 'How to read an old map', body_markdown: 'A published article body with enough detail.', summary: null, authorship_mode: 'human_only', model_name: null, human_contribution: 'Ada wrote it.' },
    { slug: 'maps', kind: 'article', created_at: '2026-01-02T00:00:00.000Z', author: 'ada', branch_slug: 'maps', branch_title: 'Maps', revision_id: 'rev-2', locale: 'ru', title: 'Как читать старую карту', body_markdown: 'Текст статьи достаточной длины для публикации.', summary: null, authorship_mode: 'human_only', model_name: null, human_contribution: 'Ада написала текст.' },
  ], new Map([
    ['rev-1', [{ canonical_url: 'https://example.org/map', title: 'Map', publisher: '', locator: '', note: '' }]],
  ]))
  assert.equal(pages.length, 1)
  assert.equal(pages[0].revisions.length, 2)
  assert.equal(pages[0].branch.slug, 'maps')
  assert.equal(pages[0].revisions[0].sources[0].url, 'https://example.org/map')
  assert.equal(pages[0].revisions[1].sources.length, 0)
  assert.equal(Object.hasOwn(pages[0], 'email'), false)

  const comment = presentComment({ id: 'c1', parent_reply_id: 'c0', parent_in_archive: false, page_slug: 'maps', locale: 'en', body_markdown: 'A note', created_at: '2026-01-03T00:00:00.000Z', source_url: null })
  assert.equal(comment.parent_id, null)

  const account = buildAccountArchive({
    username: 'ada',
    domain: 'aiki.wiki',
    origin: 'https://aiki.wiki',
    exportedAt: '2026-01-04T00:00:00.000Z',
    pages,
    comments: [comment],
  })
  assert.equal(account.node.version, PRODUCT_VERSION)
  assert.equal(account.node.domain, 'aiki.wiki')
  assert.equal(account.node.origin, 'https://aiki.wiki')
  assert.equal(account.node.exported_at, account.exported_at)
  const roundTrip = parseAccountArchive({
    ...account,
    pages: [{
      slug: 'reading-maps',
      kind: 'article',
      created_at: '2026-01-02T00:00:00.000Z',
      author: 'ada',
      branch: { slug: 'maps', title: 'Maps' },
      revisions: [{
        locale: 'en',
        title: 'How to read an old map',
        body: 'A published article body with enough detail.',
        summary: null,
        authorship: { mode: 'human_only', modelName: null, humanContribution: 'Ada wrote it.' },
        sources: [{ url: 'https://example.org/map', title: 'Map', publisher: '', locator: '', note: '' }],
      }],
    }],
    comments: [{
      id: 'c1',
      parent_id: null,
      page_slug: 'reading-maps',
      locale: 'en',
      body: 'A short note on the page.',
      created_at: '2026-01-03T00:00:00.000Z',
      source: null,
    }],
  })
  assert.equal(roundTrip.ok, true)
  assert.equal(roundTrip.value.pages[0].branchSlug, 'maps')
  assert.equal(roundTrip.value.comments[0].page_slug, 'reading-maps')
  assert.equal(roundTrip.value.node.version, PRODUCT_VERSION)
  assert.equal(roundTrip.value.node.domain, 'aiki.wiki')

  const nodeArchive = buildNodeArchive({
    domain: 'aiki.wiki',
    origin: 'https://aiki.wiki',
    exportedAt: '2026-01-04T00:00:00.000Z',
    pages: [],
  })
  assert.equal(nodeArchive.aiki, NODE_ARCHIVE_KIND)
  assert.equal(nodeArchive.version, 1)
  assert.equal(nodeArchive.domain, 'aiki.wiki')
  assert.equal(nodeArchive.exported_at, '2026-01-04T00:00:00.000Z')
  assert.equal(nodeArchive.node.version, PRODUCT_VERSION)
  assert.equal(nodeArchive.node.origin, 'https://aiki.wiki')
  assert.equal(nodeArchive.node.exported_at, nodeArchive.exported_at)

  const older = parseAccountArchive(archiveWithNode('1.0.0'))
  assert.equal(older.ok, true)
  assert.equal(older.value.node.version, '1.0.0')
  assert.equal(older.value.node.domain, 'old.example')
  const same = parseAccountArchive(archiveWithNode(PRODUCT_VERSION))
  assert.equal(same.ok, true)
  const newer = parseAccountArchive(archiveWithNode('9.9.9'))
  assert.equal(newer.ok, false)
  assert.match(newer.message, /newer archive/)
  assert.match(newer.message, new RegExp(PRODUCT_VERSION.replaceAll('.', '\\.')))
  const unread = parseAccountArchive(archiveWithNode('soon'))
  assert.equal(unread.ok, false)
  assert.match(unread.message, /cannot read/)
  const futureFormat = parseAccountArchive({ ...archiveWithComments([]), version: 2 })
  assert.equal(futureFormat.ok, false)
  assert.match(futureFormat.message, /newer file format/)
  const beforeNodeField = parseAccountArchive(archiveWithComments([]))
  assert.equal(beforeNodeField.ok, true)
  assert.equal(beforeNodeField.value.node, null)

  const nodeFile = parseAccountArchive({ aiki: NODE_ARCHIVE_KIND, version: 2, node: { version: '9.9.9' }, pages: [], comments: [] })
  assert.equal(nodeFile.ok, false)
  assert.match(nodeFile.message, /public node backup/)

  const loop = parseAccountArchive(archiveWithComments([
    { id: 'a', parent_id: 'b', page_slug: 'reading-maps' },
    { id: 'b', parent_id: 'a', page_slug: 'reading-maps' },
  ]))
  assert.equal(loop.ok, false)
  assert.match(loop.message, /loop/)

  const childFirst = parseAccountArchive(archiveWithComments([
    { id: 'child', parent_id: 'parent', page_slug: 'reading-maps' },
    { id: 'parent', parent_id: null, page_slug: 'reading-maps' },
  ]))
  assert.equal(childFirst.ok, true)
  assert.deepEqual(childFirst.value.comments.map(item => item.id), ['parent', 'child'])

  const [nodePage, accountPage, loader] = await Promise.all([
    readFile(path.join(root, 'app/pages/node.vue'), 'utf8'),
    readFile(path.join(root, 'app/pages/account.vue'), 'utf8'),
    readFile(path.join(root, 'server/utils/archive.js'), 'utf8'),
  ])
  assert.match(nodePage, /data-testid="node-archive-download"/)
  assert.match(nodePage, /href="\/api\/node-archive"/)
  assert.match(accountPage, /data-testid="account-export"/)
  assert.match(accountPage, /data-testid="account-import"/)
  assert.match(loader, /kind = ANY\(\$1::text\[\]\)/)
  assert.equal(translate('ru', 'node.archiveDownload'), 'Скачать архив')
  assert.equal(translate('ru', 'account.archiveTitle'), 'Импорт и экспорт')
  assert.equal(translate('en', 'account.export'), 'Export')
  assert.equal(ACCOUNT_ARCHIVE_KIND, 'account-archive')
  assert.match(translate('en', 'account.archiveRules'), /keeps the pages and comments you already have/)
  assert.match(translate('en', 'account.archiveRules'), /newer AIKI cannot be imported/)
  assert.match(translate('en', 'node.archiveNote'), /version of this node/)
  assert.match(translate('ru', 'account.archiveRules'), /оставляет ваши страницы и комментарии как есть/)
  assert.match(translate('ru', 'account.archiveRules'), /более новой версии/)
  assert.match(translate('ru', 'node.archiveNote'), /версия этого узла/)
  assert.match(translate('ru', 'account.importAlready'), /оставлены как есть/)
  assert.match(loader, /import_key/)
  assert.match(loader, /alreadyPresent/)
}

function archiveWithNode(version) {
  return {
    ...archiveWithComments([]),
    node: {
      version,
      domain: 'old.example',
      origin: 'https://old.example',
      exported_at: '2026-01-01T00:00:00.000Z',
    },
  }
}

function archiveWithComments(comments) {
  return {
    aiki: ACCOUNT_ARCHIVE_KIND,
    version: 1,
    pages: [{
      slug: 'reading-maps',
      kind: 'question',
      revisions: [{
        locale: 'en',
        title: 'How should a map be cited?',
        body: 'Which part of an old map should a reader be able to check?',
        sources: [],
      }],
    }],
    comments: comments.map(comment => ({
      locale: 'en',
      body: 'A comment long enough to publish.',
      created_at: '2026-01-03T00:00:00.000Z',
      source: null,
      ...comment,
    })),
  }
}
