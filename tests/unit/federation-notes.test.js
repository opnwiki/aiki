import fs from 'node:fs'
import path from 'node:path'
import { channelNoteHtml, channelNoteUri, escapeHtml, pageUrl, plainExcerpt } from '../../server/utils/federation-notes.js'

export async function run({ assert }) {
  const origin = 'https://node.test'
  const row = { slug: 'abc', page_number: 63, title: 'Rates <and> "money"', body_markdown: '## Heading\n\nSee [the bank](https://cbr.ru) and **bold** text.' }
  assert.equal(pageUrl(row, origin), 'https://node.test/63')
  assert.equal(pageUrl({ slug: 'a b' }, origin), 'https://node.test/a%20b')
  const html = channelNoteHtml(row, origin)
  assert.match(html, /<strong>Rates &lt;and&gt; &quot;money&quot;<\/strong>/)
  assert.match(html, /See the bank and bold text\./, 'Markdown is flattened, not sent raw')
  assert.match(html, /<a href="https:\/\/node\.test\/63">/)
  assert.ok(!html.includes('##') && !html.includes('**'))
  assert.equal(escapeHtml(`<script>'x'</script>`), '&lt;script&gt;&#39;x&#39;&lt;/script&gt;')
  assert.ok(plainExcerpt('word '.repeat(200), 40).endsWith('…'))
  assert.equal(channelNoteUri('t1', {}, origin).href, 'https://node.test/ap/objects/notes/topics-t1')
  assert.equal(channelNoteUri('t1', { personal: true }, origin).href, 'https://node.test/ap/objects/notes/messages-t1')

  // Mastodon never polls outboxes: new pages must be pushed to followers, and
  // @ask/@hot boost the @new post instead of re-posting it under another author.
  const channels = fs.readFileSync(path.resolve('server/utils/federation-channels.js'), 'utf8')
  assert.match(channels, /const activity = BOOSTING_CHANNELS\.includes\(row\.purpose\)\s*\? new Announce/)
  // @hub posts pages; message channels boost the authors' own posts.
  assert.match(channels, /feed\.purpose IN \('hub', 'new'\)/)
  assert.match(channels, /feed\.purpose IN \('live', 'agents', 'humans'\)/)
  assert.match(channels, /await ensureMessageAuthorActors\(database\)/)
  assert.match(fs.readFileSync(path.resolve('database/migrations/093_federation_hub_channels.sql'), 'utf8'), /\('hub', 'service', 'AIKI'/)
  assert.match(channels, /context\.sendActivity\(\{ identifier: actorIdentifier\(row\.actor_uri, row\.local_handle\) \}, recipients, activity\)/)
  assert.match(fs.readFileSync(path.resolve('server/plugins/federation-executor.js'), 'utf8'), /startChannelPostExecutor/)
  assert.match(fs.readFileSync(path.resolve('database/migrations/092_federation_channel_posts.sql'), 'utf8'), /interval '1 day'/)
  // Changed profiles (link, avatar, name) are pushed to followers as an Update.
  assert.match(channels, /export async function announceChangedProfiles/)
  assert.match(channels, /await announceChangedProfiles\(database\)/)
  const federation = fs.readFileSync(path.resolve('server/federation.js'), 'utf8')
  assert.match(federation, /url: new URL\(await actorProfileUrl\(database, row\)\)/)
  assert.match(fs.readFileSync(path.resolve('server/routes/users/[username].get.js'), 'utf8'), /if \(isChannelHandle\(username\)\) return sendRedirect\(event, '\/fediverse', 301\)/)
}
