import { accessChoices, nextTopicStatus, presentAccess, readableTopicSql } from '../../server/utils/page-access.js'

const author = { id: 'author', role: 'member' }
const moderator = { id: 'mod', role: 'moderator' }
const stranger = { id: 'reader', role: 'member' }

export function run({ assert }) {
  const link = { author_id: 'author', status: 'unlisted' }
  const open = { author_id: 'author', status: 'published' }
  const secret = { author_id: 'author', status: 'hidden' }

  assert.deepEqual(accessChoices(link, author), ['link', 'public', 'author'])
  assert.deepEqual(accessChoices(open, moderator), ['link', 'public'])
  assert.deepEqual(accessChoices(secret, moderator), [])
  assert.deepEqual(accessChoices(link, stranger), [])
  assert.equal(nextTopicStatus(open, moderator, 'link'), 'unlisted')
  assert.equal(nextTopicStatus(open, moderator, 'author'), null)
  assert.equal(nextTopicStatus(secret, author, 'public'), 'published')
  assert.equal(nextTopicStatus(secret, stranger, 'public'), null)
  assert.equal(presentAccess(link, null).access, 'link')
  assert.equal(presentAccess(link, null).canChangeAccess, false)
  assert.match(readableTopicSql('t', '$3'), /t\.status IN \('published', 'unlisted'\)/)
  assert.match(readableTopicSql('t', '$3'), /\$3::uuid/)
  assert.match(readableTopicSql('t', '$3'), /pending/)
  const waiting = { author_id: 'author', status: 'pending' }
  assert.deepEqual(accessChoices(waiting, author), [])
  assert.equal(presentAccess(waiting, author).access, 'pending')
  assert.equal(nextTopicStatus(waiting, author, 'public'), null)
}
