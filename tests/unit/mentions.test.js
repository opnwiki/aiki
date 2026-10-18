import fs from 'node:fs'
import path from 'node:path'
import { extractMentions, mentionHref } from '../../server/utils/mentions.js'
import { htmlToPlainText } from '../../server/utils/fediverse-text.js'
import { renderSafeMarkdown } from '../../server/utils/markdown.js'

export async function run({ assert }) {
  const domain = 'aiki.wiki'
  assert.deepEqual(extractMentions('Hi @alice and @bob@infosec.exchange, also @alice@aiki.wiki.', domain), [
    { username: 'alice', domain: null, local: true },
    { username: 'bob', domain: 'infosec.exchange', local: false },
  ])
  assert.deepEqual(extractMentions('mail a@b.com and `@code` and ```\n@block\n```', domain), [])
  assert.equal(mentionHref('alice', null, domain), '/alice')
  assert.equal(mentionHref('x', 'infosec.exchange', domain), 'https://infosec.exchange/@x')

  // Rendered as profile links outside code and links.
  const html = renderSafeMarkdown('Hi @alice, see @x@infosec.exchange. `@code` [@link](https://example.com)')
  assert.match(html, /<a href="\/alice" class="mention"[^>]*>@alice<\/a>/)
  // Remote mentions show @user and keep the full address on hover.
  assert.match(html, /<a href="https:\/\/infosec\.exchange\/@x" class="mention"[^>]*title="@x@infosec\.exchange"[^>]*>@x<\/a>/)
  assert.match(html, /<code>@code<\/code>/)
  assert.ok(!html.includes('href="/link"'))

  // Mastodon mention links keep the full address (only @user for this node).
  const inbound = htmlToPlainText('<p><a href="https://infosec.exchange/@bob" class="u-url mention">@<span>bob</span></a> hi <a href="https://aiki.wiki/alice" class="u-url mention">@<span>alice</span></a></p>', { domain })
  assert.equal(inbound, '@bob@infosec.exchange hi @alice')

  // Notifications, delivery and MCP know about mentions.
  assert.match(fs.readFileSync(path.resolve('server/utils/notifications.js'), 'utf8'), /await notifyMentions\(client, \{ topicId, replyId, authorId \}\)/)
  assert.match(fs.readFileSync(path.resolve('server/utils/federation-outbound.js'), 'utf8'), /for \(const mentioned of await mentionedActors\(context, database, row\.body_markdown\)\)/)
  const mcp = fs.readFileSync(path.resolve('server/routes/mcp.post.js'), 'utf8')
  assert.match(mcp, /name: 'aiki_find_people'/)
  assert.match(mcp, /if \(name === 'aiki_find_people'\) return findPeople\(args\)/)
  assert.match(fs.readFileSync(path.resolve('database/migrations/098_mention_notifications.sql'), 'utf8'), /'mention'/)
}
