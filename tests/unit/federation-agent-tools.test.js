import fs from 'node:fs'
import path from 'node:path'

export async function run({ assert }) {
  const mcp = fs.readFileSync(path.resolve('server/routes/mcp.post.js'), 'utf8')
  // Reading tools: listed, executable, rate limited, and nothing is copied.
  for (const tool of ['aiki_fediverse_lookup', 'aiki_fediverse_hashtag']) {
    assert.match(mcp, new RegExp(`name: '${tool}'`))
    assert.match(mcp, new RegExp(`name === '${tool}'`))
  }
  assert.match(mcp, /action: 'fediverse-lookup', limit: 30, actor/)
  assert.match(mcp, /action: 'fediverse-hashtag', limit: 30, actor/)
  assert.match(mcp, /'fediverse_lookup', 'fediverse_hashtag'/)
  // Import takes any public post URL.
  assert.match(mcp, /const checked = parseFediversePostUrl\(args\.url\)/)
  assert.match(fs.readFileSync(path.resolve('server/api/federation/import.post.js'), 'utf8'), /parseFediversePostUrl\(body\?\.url\)/)

  // Votes on pages and replies (not proposals) federate after the vote is saved.
  assert.match(mcp, /withFediverseLike\(await voteTarget\(\{ slug, targetType: 'topic'/)
  assert.match(mcp, /withFediverseLike\(await voteTarget\(\{ slug, targetId: replyId, targetType: 'reply'/)
  assert.doesNotMatch(mcp, /withFediverseLike\(await voteTarget\(\{ slug, targetId: proposalId/)
  for (const file of ['server/api/topics/[slug]/votes.post.js', 'server/api/topics/[slug]/replies/[replyId]/votes.post.js']) {
    const source = fs.readFileSync(path.resolve(file), 'utf8')
    assert.match(source, /await client\.query\('COMMIT'\)\s*\n\s*\/\/[^\n]*\n\s*void federateVote\(/, `${file} federates after COMMIT`)
  }

  // Likes: sent from the voter's own actor, one live Like per post, Undo on removal.
  const likes = fs.readFileSync(path.resolve('server/utils/federation-outbound-likes.js'), 'utf8')
  assert.match(likes, /author\.is_local = false/)
  assert.match(likes, /federationAllowsOutbound\(currentFederationSettings\(row\)\)/)
  assert.match(likes, /row\.actor_enabled !== true/)
  assert.match(likes, /new Like\(\{ id: new URL\(activityUri\), actor: actorUri, object: new URL\(remote\.object_uri\) \}\)/)
  assert.match(likes, /new Undo\(/)
  const migration = fs.readFileSync(path.resolve('database/migrations/102_federation_outbound_likes.sql'), 'utf8')
  assert.match(migration, /ON federation_outbound_likes \(local_actor_id, object_uri\) WHERE undone_at IS NULL/)

  // Reads are signed as the node, and private posts are not shown.
  const browse = fs.readFileSync(path.resolve('server/utils/federation-browse.js'), 'utf8')
  assert.match(browse, /const READER = 'hub'/)
  assert.match(browse, /This post is not public\./)
}
