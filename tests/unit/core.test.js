import { isReservedSlug, normalizePageSlug, slugify, validateCitation, validateEditProposal, validatePageReport, validateReply, validateReplyVote, validateTopic } from '../../server/utils/validation.js'

export function run({ assert }) {
  assert.equal(slugify('Welcome to AIKI — 开放知识'), 'welcome-to-aiki-开放知识')
  assert.equal(slugify('   A / B: C  '), 'a-b-c')
  assert.equal(slugify(''), '')
  assert.equal(isReservedSlug('login'), true)
  assert.equal(isReservedSlug('mcp'), true)
  assert.equal(isReservedSlug('account'), true)
  assert.equal(isReservedSlug('node'), true)
  assert.equal(isReservedSlug('admin'), true)
  assert.equal(normalizePageSlug('node'), null)
  assert.equal(normalizePageSlug('admin'), null)
  assert.equal(isReservedSlug('robots-txt'), true)
  for (const reserved of ['agent', 'api-txt', 'openapi-v1-yaml', 'llms-txt', 'reports']) {
    assert.equal(isReservedSlug(reserved), true)
    assert.equal(normalizePageSlug(reserved), null)
  }
  assert.equal(isReservedSlug('medigoround'), false)
  assert.equal(normalizePageSlug(' Aiki-Article '), 'aiki-article')
  assert.equal(normalizePageSlug('login'), null)
  assert.equal(normalizePageSlug('bad/path'), null)
  assert.equal(normalizePageSlug('x'.repeat(97)), null)

  assert.equal(validateTopic({ title: 'A real topic title', body: 'A sufficiently useful body.', kind: 'discussion', locale: 'en' }).ok, true)
  assert.equal(validateTopic({ title: 'x', body: '', kind: 'invalid', locale: 'xx' }).ok, false)
  assert.equal(validateReply({ body: 'A sufficiently useful reply.', locale: 'ru' }).ok, true)
  assert.equal(validateReply({ body: '   ', locale: 'en' }).ok, false)
  const nestedReply = validateReply({ body: 'A nested reply.', locale: 'en', parentReplyId: '00000000-0000-4000-8000-000000000099' })
  assert.equal(nestedReply.ok, true)
  assert.equal(nestedReply.value.parentReplyId, '00000000-0000-4000-8000-000000000099')
  assert.equal(validateReply({ body: 'An anonymous reply.', anonymous: true }).value.anonymous, true)
  assert.equal(validateReply({ body: 'A named reply.', anonymous: false }).value.anonymous, false)
  assert.equal(validateReply({ body: 'A top level reply.' }).value.parentReplyId, null)
  assert.equal(validateReply({ body: 'A nested reply.', parentReplyId: 'not-a-uuid' }).ok, false)
  assert.equal(validateReplyVote({ value: 1 }).ok, true)
  assert.equal(validateReplyVote({ value: 0 }).value, 0)
  assert.equal(validateReplyVote({ value: -1 }).ok, true)
  assert.equal(validateReplyVote({ value: '1' }).ok, false)
  assert.equal(validateReplyVote({ value: 2 }).ok, false)
  assert.equal(validateCitation({ url: 'https://example.org/article', title: 'Article' }).ok, true)
  assert.equal(validateCitation({ url: 'javascript:alert(1)', title: 'Unsafe' }).ok, false)
  assert.equal(validateCitation({ url: 'http://127.0.0.1/private', title: 'Private host' }).ok, false)
  assert.equal(validateCitation({ url: 'https://user:pass@example.org/private', title: 'Credentials' }).ok, false)
  const validProposal = validateEditProposal({
    baseRevisionId: '00000000-0000-4000-8000-000000000021',
    locale: 'ru',
    proposedBody: 'A sufficiently complete proposed revision body.',
    rationale: 'Clarifies the evidence and scope.',
  })
  assert.equal(validProposal.ok, true)
  assert.equal(validProposal.value.locale, 'ru')
  assert.equal(validateEditProposal({ baseRevisionId: 'not-a-uuid', locale: 'xx', proposedBody: 'x', rationale: 'short' }).ok, false)
  assert.equal(validateEditProposal({ baseRevisionId: '00000000-0000-4000-8000-000000000021', proposedTitle: 'tiny', proposedBody: 'A sufficiently complete proposed revision body.', rationale: 'A valid rationale for this change.' }).ok, false)
  const report = validatePageReport({ reason: 'rights', details: '  The quoted passage exceeds the source.  ' })
  assert.equal(report.ok, true)
  assert.equal(report.value.details, 'The quoted passage exceeds the source.')
  assert.equal(validatePageReport({ reason: 'spam', details: 'This report is long enough.' }).ok, false)
  assert.equal(validatePageReport({ reason: 'other', details: 'short' }).ok, false)

}
