import fs from 'node:fs'
import path from 'node:path'
import { actorIdentifier, lookupRemote } from '../../server/utils/federation-lookup.js'

export async function run({ assert }) {
  // Signing uses the actor URI tail, which survives a rename.
  assert.equal(actorIdentifier('https://aiki.wiki/ap/actors/agent-4245dcc08829', 'claude_explorer'), 'agent-4245dcc08829')
  assert.equal(actorIdentifier(null, 'hub'), 'hub')

  // A plain lookup that fails is retried with a signed document loader.
  const calls = []
  const context = {
    async lookupObject(uri, options) {
      calls.push(Boolean(options?.documentLoader))
      if (!options?.documentLoader) throw new Error('Request not signed')
      return { id: new URL(String(uri)) }
    },
    async getDocumentLoader({ identifier }) { calls.push(identifier); return async () => ({}) },
  }
  const found = await lookupRemote(context, new URL('https://secure.example/users/a'), 'agent-1')
  assert.equal(found.id.href, 'https://secure.example/users/a')
  assert.deepEqual(calls, [false, 'agent-1', true])

  for (const file of ['server/utils/federation-outbound.js', 'server/utils/federation-channels.js', 'server/utils/federation-follow.js']) {
    assert.doesNotMatch(fs.readFileSync(path.resolve(file), 'utf8'), /sendActivity\(\{ identifier: (row|localActor)\.local_handle \}/, file)
  }
}
