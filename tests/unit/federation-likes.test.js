import fs from 'node:fs'
import path from 'node:path'
import { applyInboundLike, undoInboundLike } from '../../server/utils/federation-inbound.js'

function fakeDatabase() {
  const calls = []
  return {
    calls,
    async query(sql, values) {
      calls.push({ sql, values })
      if (sql.includes('FROM replies WHERE id')) return { rows: [{}] }
      if (sql.includes('FROM topics WHERE id')) return { rows: [{}] }
      if (sql.includes('INSERT INTO federation_actors')) return { rows: [{ id: 'remote-1' }] }
      if (sql.includes('DELETE FROM federation_likes')) return { rows: values[1] === 'https://toot.io/likes/1' ? [{ id: 'l1' }] : [] }
      return { rows: [] }
    },
  }
}

const url = value => new URL(value)

export async function run({ assert }) {
  // A like on one of our reply notes (also the @anon copy) is an upvote for that reply.
  const db = fakeDatabase()
  const liked = await applyInboundLike(db, {
    id: url('https://toot.io/likes/1'),
    actorId: url('https://toot.io/users/alice'),
    objectId: url('https://aiki.wiki/ap/objects/notes/replies-acdbc255-1e5a-4dc0-abd8-74b06196690f-anon'),
  })
  assert.deepEqual(liked, { liked: true, target: { type: 'reply', id: 'acdbc255-1e5a-4dc0-abd8-74b06196690f' } })
  const insert = db.calls.find(call => call.sql.includes('INSERT INTO federation_likes'))
  assert.deepEqual(insert.values.slice(1, 4), ['remote-1', 'reply', 'acdbc255-1e5a-4dc0-abd8-74b06196690f'])

  // A page note maps to the page.
  const page = await applyInboundLike(fakeDatabase(), {
    id: url('https://toot.io/likes/2'),
    actorId: url('https://toot.io/users/alice'),
    objectId: url('https://aiki.wiki/ap/objects/notes/topics-e57a7d67-0160-48d9-8653-c3f78fbbbb28'),
  })
  assert.equal(page.target.type, 'topic')

  // Unknown objects are ignored; Undo removes the like.
  const unknown = await applyInboundLike(fakeDatabase(), { id: url('https://x.example/l'), actorId: url('https://x.example/u'), objectId: url('https://x.example/notes/1') })
  assert.equal(unknown.liked, false)
  assert.equal((await undoInboundLike(fakeDatabase(), { actorId: url('https://toot.io/users/alice'), objectId: url('https://toot.io/likes/1') })).undone, true)

  // Scores count likes as upvotes, and @ask boosts the post it was mentioned in.
  const page2 = fs.readFileSync(path.resolve('server/api/topics/[slug].get.js'), 'utf8')
  assert.match(page2, /FROM all_votes WHERE target_type = 'reply'/)
  assert.match(fs.readFileSync(path.resolve('database/migrations/097_federation_likes.sql'), 'utf8'), /CREATE OR REPLACE VIEW all_votes/)
  const federation = fs.readFileSync(path.resolve('server/federation.js'), 'utf8')
  assert.match(federation, /\.on\(Like, \(ctx, activity\) => recordInboundActivity/)
  assert.match(federation, /ask-boost-\$\{topicId\}/)
}
