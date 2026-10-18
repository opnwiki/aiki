import fs from 'node:fs'
import path from 'node:path'
import { extractHashtags, fetchHashtagTimeline, hashtagHtml, hashtagName, hashtagObjects, hashtagsFromLabels, linkHashtagsHtml, normalizeInstanceOrigin } from '../../server/utils/federation-hashtags.js'
import { fetchFediverseThread, parseFediversePostUrl } from '../../server/utils/federation-import.js'

function jsonResponse(value, status = 200) {
  return { ok: status < 400, status, text: async () => JSON.stringify(value) }
}

export async function run({ assert }) {
  const origin = 'https://node.test'
  // Tag labels become one-word hashtags; labels without letters do not.
  assert.equal(hashtagName('machine learning'), 'MachineLearning')
  assert.equal(hashtagName('ИИ'), 'ИИ')
  assert.equal(hashtagName('#rust'), 'rust')
  assert.equal(hashtagName('2026'), null)
  assert.deepEqual(hashtagsFromLabels(['Rust', 'rust', 'web dev'], origin), [
    { name: 'Rust', href: 'https://node.test/topics?tag=rust' },
    { name: 'WebDev', href: 'https://node.test/topics?tag=webdev' },
  ])

  // #words in replies, but not inside code or link addresses.
  const tags = extractHashtags('Talking #rust and #ИИ. `#notatag` see [x](https://a.example/#frag) and https://b.example/#y, also a&#39;b', origin)
  assert.deepEqual(tags.map(tag => tag.name), ['rust', 'ИИ'])
  const html = linkHashtagsHtml('<p>Talking #rust <a href="https://x/#rust">#rust</a> <code>#rust</code></p>', tags)
  assert.equal((html.match(/class="mention hashtag"/g) || []).length, 1)
  assert.match(html, /<a href="https:\/\/node\.test\/topics\?tag=rust" class="mention hashtag" rel="tag">#<span>rust<\/span><\/a> <a href="https:\/\/x\/#rust">#rust<\/a> <code>#rust<\/code>/)
  assert.match(hashtagHtml(tags), /^<p><a [^>]+>#<span>rust<\/span><\/a> <a /)
  assert.equal(hashtagHtml([]), '')
  const objects = hashtagObjects(tags)
  assert.equal(objects[0].name, '#rust')
  assert.equal(objects[0].href.href, 'https://node.test/topics?tag=rust')

  // Hashtag timelines: public posts only, full mentions, paging by max_id.
  assert.equal(normalizeInstanceOrigin('mastodon.social'), 'https://mastodon.social')
  assert.equal(normalizeInstanceOrigin('http://mastodon.social'), null)
  assert.equal(normalizeInstanceOrigin('https://localhost'), null)
  let requested
  const timeline = await fetchHashtagTimeline({
    instance: 'fosstodon.org',
    tag: '#rust',
    limit: 2,
    before: '111',
    fetchImpl: async (url) => {
      requested = url
      return jsonResponse([
        { id: '110', uri: 'https://fosstodon.org/users/a/statuses/110', url: 'https://fosstodon.org/@a/110', visibility: 'public', content: '<p>Hello <a href="https://fosstodon.org/tags/rust" class="mention hashtag">#<span>rust</span></a></p>', account: { acct: 'a', display_name: 'A', url: 'https://fosstodon.org/@a', bot: false }, tags: [{ name: 'rust' }], media_attachments: [], replies_count: 2, reblogs_count: 1, favourites_count: 5, created_at: '2026-10-01T00:00:00Z', language: 'en' },
        { id: '109', uri: 'https://other.example/notes/1', visibility: 'public', content: 'Remote', account: { acct: 'b@other.example', display_name: 'B' } },
        { id: '108', visibility: 'unlisted', content: 'hidden', account: { acct: 'c' } },
      ])
    },
  })
  assert.equal(requested, 'https://fosstodon.org/api/v1/timelines/tag/rust?limit=2&max_id=111')
  assert.equal(timeline.posts.length, 2)
  assert.equal(timeline.posts[0].author.mention, '@a@fosstodon.org')
  assert.equal(timeline.posts[1].author.mention, '@b@other.example')
  assert.equal(timeline.posts[0].likes, 5)
  assert.match(timeline.posts[0].text, /Hello #rust/)
  assert.equal(timeline.nextBefore, '108')
  await assert.rejects(
    fetchHashtagTimeline({ instance: 'closed.example', tag: 'rust', fetchImpl: async () => jsonResponse({ error: 'no' }, 422) }),
    /does not show hashtag timelines to visitors/,
  )
  await assert.rejects(fetchHashtagTimeline({ instance: 'x.example', tag: 'two words', fetchImpl: async () => jsonResponse([]) }), /one hashtag/)

  // Any public post URL can be imported; non-Mastodon ones (or a closed
  // Mastodon API) are read through ActivityPub.
  assert.equal(parseFediversePostUrl('https://misskey.example/notes/9abc').ok, true)
  assert.equal(parseFediversePostUrl('https://misskey.example/').ok, false)
  assert.equal(parseFediversePostUrl('http://misskey.example/notes/1').ok, false)
  assert.equal(parseFediversePostUrl('https://127.0.0.1/notes/1').ok, false)
  assert.equal(parseFediversePostUrl('https://mastodon.social/@a/123').value.id, '123')
  const viaActivityPub = await fetchFediverseThread('https://misskey.example/notes/9abc', {
    fetchImpl: async () => { throw new Error('Mastodon API must not be called') },
    fetchActivityPub: async url => ({ requestedUrl: url, items: [] }),
  })
  assert.equal(viaActivityPub.requestedUrl, 'https://misskey.example/notes/9abc')
  const fallback = await fetchFediverseThread('https://closed.example/@a/1', {
    fetchImpl: async () => jsonResponse({ error: 'auth' }, 401),
    fetchActivityPub: async () => ({ via: 'activitypub' }),
  })
  assert.equal(fallback.via, 'activitypub')

  // Pages and replies carry hashtags wherever a Note is built.
  const federation = fs.readFileSync(path.resolve('server/federation.js'), 'utf8')
  assert.equal((federation.match(/tags: hashtagObjects\(hashtags\)/g) || []).length, 3)
  assert.match(fs.readFileSync(path.resolve('server/utils/federation-channels.js'), 'utf8'), /tags: hashtagObjects\(hashtags\)/)
  assert.match(fs.readFileSync(path.resolve('server/utils/federation-outbound.js'), 'utf8'), /tags = \[\.\.\.tags, \.\.\.hashtagObjects\(hashtags\)\]/)
}
