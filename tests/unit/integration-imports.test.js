import { Readable } from 'node:stream'
import { validateIntegrationImport, importContentHash, importRevisionDecision, publicImportState, IMPORT_BODY_BYTES } from '../../server/utils/integration-import-validation.js'
import { presentImportProvenance } from '../../server/utils/integration-imports.js'
import { readIntegrationBody } from '../../server/utils/integration-body.js'
import { reviewArticle } from '../../server/utils/article-rules.js'
import { validateAuthorship } from '../../server/utils/authorship.js'

export async function run({ assert }) {
  const credential = { provider: 'telegram', identity_providers: ['telegram', 'web'], allowed_media_origins: ['https://bot.aiki.wiki'] }
  const identity = { provider: 'telegram', subjectType: 'user', subjectKey: 'user-17', displayName: 'Reader' }
  const body = { version: 1, idempotencyKey: 'job-1', externalSourceKey: 'channel:10:message:20', submitter: identity,
    author: { ...identity, subjectType: 'channel', subjectKey: 'channel-10', displayName: 'News channel' },
    source: { url: 'https://t.me/news/20', visibility: 'public', publishedAt: '2026-10-12', authorSignature: 'Reporter' },
    content: { title: 'A public news report', body: 'This is the complete original report, with facts from the source.', kind: 'article', locale: 'en', overview: 'The report describes an event.', tags: ['news'] },
    sources: [{ url: 'https://t.me/news/20' }], media: [], formatting: { provider: 'openai', model: 'test-model', mode: 'preserved' } }
  const input = validateIntegrationImport(body, credential)
  assert.equal(input.submitter.subjectKey, 'user-17')
  assert.equal(input.author.subjectKey, 'channel-10')
  assert.equal(input.source.publishedAt, '2026-10-12T00:00:00.000Z')
  assert.equal(input.content.tags[0].slug, 'news')
  assert.throws(() => validateIntegrationImport({ ...body, authorId: 'chosen-admin' }, credential), /Unknown import field/)
  assert.throws(() => validateIntegrationImport({ ...body, submitter: body.author }, credential), /verified user/)
  assert.throws(() => validateIntegrationImport({ ...body, author: { ...body.author, provider: 'other' } }, credential), /permitted identity/)
  assert.throws(() => validateIntegrationImport({ ...body, source: { ...body.source, visibility: 'private' } }, credential), /public source/)
  assert.throws(() => validateIntegrationImport({ ...body, source: { ...body.source, publishedAt: '2026-02-31' } }, credential), /publication date/)
  assert.throws(() => validateIntegrationImport({ ...body, source: { ...body.source, url: 'https://news.example/%zz' } }, credential), /URL encoding/)
  assert.throws(() => validateIntegrationImport({ ...body, sources: [] }, credential), /1–20/)
  assert.throws(() => validateIntegrationImport({ ...body, content: { ...body.content, kind: 'page' } }, credential), /completed page type/)
  assert.throws(() => validateIntegrationImport({ ...body, content: { ...body.content, publicUsefulnessScore: NaN } }, credential), /usefulness/)
  assert.throws(() => validateIntegrationImport({ ...body, media: [{ url: 'https://evil.example/a.png', mediaType: 'image/png' }] }, credential), /allowed media/)
  assert.throws(() => validateIntegrationImport({ ...body, source: { visibility: 'public', url: 'https://api.telegram.org/file/bot123:secret/file.png' } }, credential), /without credentials/)
  const hidden = validateIntegrationImport({ ...body, author: null, source: { visibility: 'confirmed', authorName: 'Hidden author' }, content: { ...body.content, kind: 'message' }, sources: [] }, credential)
  assert.equal(hidden.author, null)
  assert.equal(hidden.source.authorName, 'Hidden author')
  assert.equal(validateIntegrationImport({ ...body, author: { provider: 'web', subjectType: 'publisher', subjectKey: 'http://news.example', profileUrl: 'http://news.example' } }, credential).author.provider, 'web')
  assert.equal(importContentHash({ ...input, content: { ...input.content, title: 'Different AI heading', overview: 'Different overview' } }), input.sourceHash, 'retry formatting must not revise an unchanged source')
  assert.notEqual(importContentHash({ ...input, content: { ...input.content, body: `${input.content.body} A correction.` } }), input.sourceHash)
  const stored = { status: 'published', source_hash: input.sourceHash, current_revision_id: 'rev1', last_revision_id: 'rev1', locale: 'en', kind: 'article' }
  assert.equal(importRevisionDecision(stored, input), 'reuse')
  const changed = { ...input, sourceHash: 'changed' }
  assert.equal(importRevisionDecision(stored, changed), 'revision')
  assert.equal(importRevisionDecision({ ...stored, current_revision_id: 'local-revision' }, changed), 'proposal')
  assert.equal(importRevisionDecision({ ...stored, status: 'pending' }, changed), 'proposal')
  assert.equal(importRevisionDecision({ ...stored, status: 'hidden' }, changed), 'unavailable')
  assert.equal(importRevisionDecision({ ...stored, status: 'deleted' }, input), 'unavailable')
  assert.equal(publicImportState('published', null, true), 'pending')
  assert.equal(publicImportState('hidden', 'proposal1'), 'rejected')
  assert.equal(publicImportState('published', 'proposal1'), 'proposed')
  assert.equal(validateAuthorship({ authorshipMode: 'external_import' }).ok, false, 'ordinary publishing cannot choose the import exception')
  const article = { title: body.content.title, body: body.content.body, sources: body.sources, authorshipMode: 'external_import' }
  assert.equal(reviewArticle(article).ok, false)
  assert.equal(reviewArticle({ ...article, importSourceVerified: true }).ok, true)
  const provenance = { revision_id: 'imported', current_revision_id: 'local', imported_at: '2026-10-12', source_snapshot: { url: body.source.url, authorSignature: 'Reporter', sender: 'private-user' },
    author_snapshot: { name: 'Source author', subjectKey: 'private-id', avatarUrl: 'https://bot.aiki.wiki/media/x.webp' }, formatting: { provider: 'openai', model: 'test-model', mode: 'preserved', apiKey: 'secret' }, requested_by_actor_id: 'private-user' }
  const presented = presentImportProvenance(provenance)
  assert.equal(presented.editedLocally, true)
  assert.equal(presented.author.name, 'Source author')
  assert.doesNotMatch(JSON.stringify(presented), /private-user|private-id|apiKey|secret/)
  assert.equal(presentImportProvenance(provenance, { hideAuthor: true }).author, null)
  assert.equal(presentImportProvenance(provenance, { hideAuthor: true }).authorSignature, null)
  const event = chunks => ({ node: { req: Object.assign(Readable.from(chunks), { headers: { 'content-type': 'application/json' } }) } })
  assert.deepEqual(await readIntegrationBody(event(['{"version":', '1}'])), { version: 1 })
  await assert.rejects(() => readIntegrationBody(event([Buffer.alloc(IMPORT_BODY_BYTES + 1)])), error => error.statusCode === 413)
  await assert.rejects(() => readIntegrationBody(event(['bad json'])), error => error.statusCode === 400)
}
