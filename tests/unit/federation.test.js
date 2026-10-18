import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fetchMastodonThread, parseMastodonStatusUrl } from '../../server/utils/federation-import.js'
import { currentFederationSettings, ensureFederationSigningKey, federationAllowsInbound, federationAllowsOutbound, federationConfigurationStatus, normalizeFederationSettings } from '../../server/utils/federation-settings.js'
import { TOPIC_KINDS } from '../../server/utils/validation.js'
import { federationHandleTakenSql, validateFederationUsername } from '../../server/utils/usernames.js'
import { toDate, withoutMentions } from '../../server/utils/federation-inbound.js'
import { isAccessControlExempt } from '../../server/utils/access-control.js'
import { Temporal } from 'temporal-polyfill'

export async function run({ assert }) {
  // Fedify dates are Temporal.Instant; new Date(instant) throws and made every
  // inbound post fail before 2026-10-13.
  assert.equal(toDate(Temporal.Instant.from('2026-10-12T16:46:00Z')).toISOString(), '2026-10-12T16:46:00.000Z')
  assert.equal(toDate('not a date'), null)
  // Category access blocks must not cut off ActivityPub servers in data centres.
  for (const path of ['/ap/actors/ask/inbox', '/ap/inbox', '/.well-known/webfinger', '/.well-known/nodeinfo']) {
    assert.equal(isAccessControlExempt({ path }), true, path)
  }
  assert.equal(isAccessControlExempt({ path: '/apple' }), false)
  assert.equal(isAccessControlExempt({ path: '/admin' }), false)
  // Fedify passes collection dispatchers a plain identifier string; reading
  // values.identifier there made every outbox and followers collection 404.
  const federationSource = fs.readFileSync(path.resolve('server/federation.js'), 'utf8')
  assert.match(federationSource, /setOutboxDispatcher\('[^']+', async \(_ctx, identifier, cursor\)/)
  assert.match(federationSource, /setFollowersDispatcher\('[^']+', async \(_ctx, identifier\)/)
  assert.match(federationSource, /if \(created\?\.question\) await acknowledgeAskQuestion/)
  // A page announced by @new also has a local root object; replies must still
  // target the remote thread, mention its author and be caught up if missed.
  const outboundSource = fs.readFileSync(path.resolve('server/utils/federation-outbound.js'), 'utf8')
  assert.match(outboundSource, /\) root_remote ON true/)
  assert.match(outboundSource, /object_actor\.is_local = false/)
  assert.match(outboundSource, /tags = \[new Mention\(\{ href: remoteActor\.id/)
  assert.match(outboundSource, /await enqueueMissedFederationReplies\(database\)/)
  // Anonymous replies are posted by @anon; edits, anonymity changes and
  // deletions are mirrored on the Fediverse copy.
  assert.match(outboundSource, /row\.author_hidden === true \? await anonActor\(client, row\.node_id\) : await ensureLocalActor\(client, row\)/)
  assert.match(outboundSource, /replies-\$\{row\.id\}\$\{row\.author_hidden === true \? '-anon' : ''\}/)
  assert.match(outboundSource, /export async function syncFederatedReply/)
  assert.match(outboundSource, /new Delete\(\{/)
  assert.match(outboundSource, /\(reply\.author_hidden IS TRUE\) <> \(local_actor\.purpose = 'anon'\)/)
  assert.match(fs.readFileSync(path.resolve('server/api/topics/[slug]/replies/[replyId].patch.js'), 'utf8'), /void syncFederatedReply\(getDatabase\(\), replyId\)/)
  assert.match(fs.readFileSync(path.resolve('server/api/topics/[slug]/replies/[replyId].delete.js'), 'utf8'), /void syncFederatedReply\(getDatabase\(\), replyId\)/)
  // A reply mentioning @ask copies the thread; mention-only posts ask nothing.
  assert.equal(withoutMentions('@ask@aiki.wiki'), '')
  assert.equal(withoutMentions('@alice @ask'), '')
  assert.equal(withoutMentions('Hi @ask@aiki.wiki what is x?'), 'Hi what is x?')
  assert.equal(withoutMentions('mail me a@b.com'), 'mail me a@b.com')
  const inboundSource = fs.readFileSync(path.resolve('server/utils/federation-inbound.js'), 'utf8')
  assert.match(inboundSource, /if \(await isAddressedToAsk\(database, object\)\) return ingestAskThread/)
  assert.match(inboundSource, /importMastodonThread\(database, \{ nodeId, actorId: null, url: statusUrl, forceSync: true \}\)/)
  const importSource = fs.readFileSync(path.resolve('server/utils/federation-import.js'), 'utf8')
  assert.match(importSource, /requested_url = \$2 OR canonical_root_uri = \$3/)
  // Our own posts coming back in a remote thread are never imported, and
  // replies in a remote thread also reach the thread's first author.
  assert.match(importSource, /if \(isOwnObject\(item\.objectUri\)\) \{/)
  assert.match(outboundSource, /The thread's first author too/)
  // Followed threads are refreshed by activity, and @ask questions are followed too.
  assert.match(importSource, /WHEN activity\.last_at > now\(\) - interval '2 hours' THEN interval '5 minutes'/)
  assert.match(inboundSource, /Follow the thread from now on/)
  // Replies in a thread started here go to its Fediverse audience too.
  assert.match(outboundSource, /row\.target_object_uri = row\.parent_local_object_uri \|\| await ensureLocalThreadRoot\(client, row\)/)
  assert.match(outboundSource, /recipients = await threadAudience\(context, database, row\)/)
  assert.match(federationSource, /isLocalReply \? linkHashtagsHtml\(renderSafeMarkdown\(row\.content\), hashtags\)/)
    // The reply language is stored in the DB and federated as the post
    // language (contentMap), so Fediverse translators can detect it.
    assert.match(outboundSource, /reply\.body_markdown, reply\.locale, reply\.author_hidden/)
    assert.match(outboundSource, /new LanguageString\(\(mentionHtml \+ linkHashtagsHtml\(renderSafeMarkdown\(row\.body_markdown\), hashtags\)\)\.replace\(/)
    assert.match(outboundSource, /reply\.body_markdown, reply\.locale, reply\.federation_object_uri/)
    assert.match(federationSource, /reply\.locale AS reply_locale, revision\.locale AS revision_locale/)
    assert.match(federationSource, /content: locale \? new LanguageString\(content, locale\) : content/)
    const channelsSource = fs.readFileSync(path.resolve('server/utils/federation-channels.js'), 'utf8')
    assert.match(channelsSource, /revision\.title, revision\.body_markdown, revision\.locale/)
    assert.match(channelsSource, /new LanguageString\(channelNoteHtml\(row\) \+ hashtagHtml\(hashtags\), row\.locale \|\| 'en'\)/)
  // A renamed account keeps its old actor URI, so that name stays taken.
  const taken = federationHandleTakenSql('$2', '$3')
  assert.match(taken, /split_part\(retired\.actor_uri, '\/ap\/actors\/', 2\)\) = lower\(\$2\)/)
  assert.match(taken, /local_actor_id IS DISTINCT FROM \$3::uuid/)
  assert.ok(!federationHandleTakenSql('$1').includes('DISTINCT'))
  // People can change their login; the actor keeps its URI and followers get an Update.
  const usernameChange = fs.readFileSync(path.resolve('server/api/account/username.patch.js'), 'utf8')
  assert.match(usernameChange, /federationHandleTakenSql\('\$2', '\$3'\)/)
  assert.match(usernameChange, /announceActorUpdate\(database, actor\.id\)/)
  assert.match(usernameChange, /enforceRateLimit\(event, \{ action: 'username-change'/)
  assert.match(federationSource, /export async function buildLocalActor/)
  // WebFinger maps any handle (current or old) to the stable actor identifier.
  assert.match(federationSource, /\.mapHandle\(\(_ctx, username\) => actorIdentifierForHandle\(username\)\)/)
  // Deletes that arrive before a failed Create leave a tombstone.
  assert.match(fs.readFileSync(path.resolve('server/utils/federation-inbound.js'), 'utf8'), /'tombstone', 'unknown', 'deleted'/)
  // Failed inbound activities are replayed from stored, already verified JSON.
  assert.match(federationSource, /export async function retryFailedInboundActivities/)
  assert.match(fs.readFileSync(path.resolve('server/utils/federation-channels.js'), 'utf8'), /await retryFailedInboundActivities\(database\)/)
  assert.deepEqual(normalizeFederationSettings({ enabled: false, mode: 'open' }).value, { enabled: false, mode: 'paused' })
  assert.deepEqual(currentFederationSettings({ federationEnabled: true, federationMode: 'open' }), { enabled: true, mode: 'open' })
  assert.equal(normalizeFederationSettings({ enabled: true, mode: 'invalid' }).ok, false)
  assert.equal(federationAllowsInbound({ enabled: true, mode: 'open' }), true)
  assert.equal(federationAllowsInbound({ enabled: true, mode: 'outbound_only' }), false)
  assert.equal(federationAllowsOutbound({ enabled: true, mode: 'inbound_only' }), false)
  assert.equal(TOPIC_KINDS.includes('message'), true)
  assert.equal(validateFederationUsername('alice').ok, true)
  assert.equal(validateFederationUsername('Alice').ok, false)
  assert.equal(validateFederationUsername('ask').ok, false)
  assert.equal(federationConfigurationStatus({ NODE_ENV: 'production', SITE_URL: 'http://example.test' }).ready, false)
  assert.equal(federationConfigurationStatus({ NODE_ENV: 'production', SITE_URL: 'https://example.test', FEDERATION_PRIVATE_KEY_JWK: JSON.stringify({ kty: 'RSA', d: 'abcdefghijklmnopqrstuvwxyz' }) }).ready, true)

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aiki-fed-key-'))
  const keyEnv = { NODE_ENV: 'production', SITE_URL: 'https://example.test', FEDERATION_PRIVATE_KEY_FILE: path.join(tempDir, 'signing-key.jwk') }
  try {
    const created = await ensureFederationSigningKey(keyEnv)
    assert.equal(created.created, true)
    assert.equal(federationConfigurationStatus(keyEnv).ready, true)
    const reused = await ensureFederationSigningKey(keyEnv)
    assert.equal(reused.created, false)
    assert.equal(JSON.parse(fs.readFileSync(keyEnv.FEDERATION_PRIVATE_KEY_FILE, 'utf8')).rsa.privateKeyJwk.kty, 'RSA')
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true })
  }

  assert.equal(parseMastodonStatusUrl('https://mastodon.social/@alice/117424047946230444').ok, true)
  assert.equal(parseMastodonStatusUrl('http://mastodon.social/@user/1').ok, false)
  assert.equal(parseMastodonStatusUrl('https://127.0.0.1/@user/1').ok, false)
  assert.equal(parseMastodonStatusUrl('https://[::1]/@user/1').ok, false)
  assert.equal(parseMastodonStatusUrl('https://[fd00::1]/@user/1').ok, false)
  assert.equal(parseMastodonStatusUrl('https://mastodon.social/@user/not-a-status').ok, false)

  const responses = new Map([
    ['https://mastodon.social/api/v1/statuses/1', {
      id: '1', uri: 'https://mastodon.social/users/root/statuses/1', url: 'https://mastodon.social/@root/1', visibility: 'public',
      content: '<p>Root &amp; context</p>', created_at: '2026-10-11T00:00:00.000Z', account: { url: 'https://mastodon.social/@root', acct: 'root', display_name: 'Root' }, media_attachments: [],
    }],
    ['https://mastodon.social/api/v1/statuses/1/context', {
      ancestors: [], descendants: [
        { id: '2', uri: 'https://mastodon.social/users/reply/statuses/2', url: 'https://mastodon.social/@reply/2', visibility: 'public', in_reply_to_id: '1', content: '<p>Reply</p>', created_at: '2026-10-11T01:00:00.000Z', account: { url: 'https://mastodon.social/@reply', acct: 'reply', display_name: 'Reply' }, media_attachments: [] },
        { id: '3', uri: 'https://mastodon.social/users/private/statuses/3', url: 'https://mastodon.social/@private/3', visibility: 'followers', in_reply_to_id: '1', content: '<p>Private</p>', account: { url: 'https://mastodon.social/@private', acct: 'private', display_name: 'Private' }, media_attachments: [] },
      ],
    }],
  ])
  const thread = await fetchMastodonThread('https://mastodon.social/@root/1', {
    fetchImpl: async url => ({ ok: true, status: 200, text: async () => JSON.stringify(responses.get(url)) }),
  })
  assert.equal(thread.items.length, 2)
  assert.equal(thread.items[0].body, 'Root & context')
  assert.equal(thread.items[1].parentObjectUri, thread.items[0].objectUri)
  assert.equal(thread.items[1].actorHandle, 'reply')
  assert.equal(thread.observed.public, 2)

  const withAncestor = await fetchMastodonThread('https://mastodon.social/@root/10', {
    fetchImpl: async url => ({
      ok: true,
      status: 200,
      text: async () => JSON.stringify(url.endsWith('/context')
        ? { ancestors: [{ id: '9', uri: 'https://mastodon.social/users/root/statuses/9', url: 'https://mastodon.social/@root/9', visibility: 'public', content: '<p>Ancestor</p>', created_at: '2026-10-10T23:00:00.000Z', account: { url: 'https://mastodon.social/@root', acct: 'root', display_name: 'Root' }, media_attachments: [] }], descendants: [] }
        : { id: '10', uri: 'https://mastodon.social/users/root/statuses/10', url: 'https://mastodon.social/@root/10', visibility: 'public', content: '<p>Requested</p>', in_reply_to_id: '9', created_at: '2026-10-11T00:00:00.000Z', account: { url: 'https://mastodon.social/@root', acct: 'root', display_name: 'Root' }, media_attachments: [] }),
    }),
  })
  assert.equal(withAncestor.root.body, 'Ancestor')
  assert.equal(withAncestor.requested.body, 'Requested')
  assert.equal(withAncestor.items[1].parentObjectUri, withAncestor.items[0].objectUri)

  // @ask called from one branch still brings the other branches of the thread.
  const status = (id, parent, text) => ({ id, uri: `https://mastodon.social/users/u/statuses/${id}`, url: `https://mastodon.social/@u/${id}`, visibility: 'public', in_reply_to_id: parent, content: `<p>${text}</p>`, created_at: '2026-10-11T00:00:00.000Z', account: { url: 'https://mastodon.social/@u', acct: 'u', display_name: 'U' }, media_attachments: [] })
  const branchResponses = new Map([
    ['https://mastodon.social/api/v1/statuses/21', status('21', '20', 'Branch A')],
    ['https://mastodon.social/api/v1/statuses/21/context', { ancestors: [status('20', null, 'Start')], descendants: [] }],
    ['https://mastodon.social/api/v1/statuses/20/context', { ancestors: [], descendants: [status('21', '20', 'Branch A'), status('22', '20', 'Branch B')] }],
  ])
  const branch = await fetchMastodonThread('https://mastodon.social/@u/21', {
    fetchImpl: async url => ({ ok: true, status: 200, text: async () => JSON.stringify(branchResponses.get(url)) }),
  })
  assert.deepEqual(branch.items.map(item => item.body), ['Start', 'Branch A', 'Branch B'])

  // A thread started on another server is read from that server.
  const remote = (origin, id, parent, text) => ({ ...status(id, parent, text), uri: `${origin}/users/u/statuses/${id}`, url: `${origin}/@u/${id}` })
  const crossResponses = new Map([
    ['https://toot.io/api/v1/statuses/31', remote('https://toot.io', '31', '900', 'My reply')],
    ['https://toot.io/api/v1/statuses/31/context', { ancestors: [remote('https://infosec.exchange', '900', null, 'Origin post')], descendants: [] }],
    ['https://infosec.exchange/api/v1/statuses/30', remote('https://infosec.exchange', '30', null, 'Origin post')],
    ['https://infosec.exchange/api/v1/statuses/30/context', { ancestors: [], descendants: [remote('https://infosec.exchange', '32', '30', 'Someone else'), remote('https://infosec.exchange', '33', '30', 'My reply')] }],
  ])
  crossResponses.get('https://toot.io/api/v1/statuses/31/context').ancestors[0].url = 'https://infosec.exchange/@u/30'
  const cross = await fetchMastodonThread('https://toot.io/@u/31', {
    fetchImpl: async url => ({ ok: true, status: 200, text: async () => JSON.stringify(crossResponses.get(url)) }),
  })
  assert.deepEqual(cross.items.map(item => item.body), ['Origin post', 'Someone else', 'My reply'])
  assert.equal(cross.requestedUrl, 'https://toot.io/@u/31')
}
