import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { reviewArticle } from '../../server/utils/article-rules.js'
import { markdownGallerySource } from '../../server/utils/markdown-gallery.js'
import { MARKDOWN_FORMAT_VERSION, markdownFormat, renderSafeMarkdown } from '../../server/utils/markdown.js'

export async function run({ assert }) {
  const html = renderSafeMarkdown('# Hello\n\n## Evidence\n\n### Evidence\n\n## 你好 & evidence!\n\n<script>alert(1)</script> [unsafe](javascript:alert(1))\n\n[safe](https://example.org/source)\n\nhttps://example.org/visible-source\n\n![pixel](https://example.org/track.png "track")')
  assert.match(html, /<h1 id="hello">Hello<\/h1>/)
  assert.match(html, /<h2 id="evidence">Evidence<\/h2>/)
  assert.match(html, /<h3 id="evidence-2">Evidence<\/h3>/)
  assert.match(html, /<h2 id="你好-evidence">你好 &amp; evidence!<\/h2>/)
  assert.doesNotMatch(html, /<script/i)
  assert.doesNotMatch(html, /href="javascript:/i)
  assert.match(html, /\[unsafe\]\(javascript:alert\(1\)\)/)
  assert.match(html, /<img src="https:\/\/example\.org\/track\.png" alt="pixel" title="track" \/>/)
  assert.match(html, /<a href="https:\/\/example\.org\/source" rel="nofollow noopener noreferrer">safe<\/a>/)
    // Unsafe image addresses stay text, they never become an src attribute.
    const unsafeImg = renderSafeMarkdown('![pixel](javascript:alert(1))\n\n![pixel](//host/evil.png)')
    assert.doesNotMatch(unsafeImg, /src=/)
    assert.match(unsafeImg, /javascript:alert\(1\)/)
  assert.match(html, /href="https:\/\/example\.org\/visible-source"/)

  assert.equal(markdownFormat.version, MARKDOWN_FORMAT_VERSION)
  assert.equal(markdownFormat.constructs.length > 10, true)
  for (const item of markdownFormat.constructs) {
    assert.equal(typeof item.name, 'string')
    assert.equal(typeof item.syntax, 'string')
    const rendered = renderSafeMarkdown(item.example)
    assert.equal(rendered.includes(item.produces), true, `${item.name} should produce ${item.produces}`)
  }

  const button = renderSafeMarkdown(':::button https://example.org/source\nOpen the source\n:::')
  assert.match(button, /class="aiki-button"/)
  assert.equal(button.split('Open the source').length, 2)

  const spoiler = renderSafeMarkdown(':::spoiler Hidden\n\nsecret **bit**\n\n:::')
  assert.match(spoiler, /<summary>Hidden<\/summary>/)
  assert.match(spoiler, /<strong>bit<\/strong>/)

  const hostile = renderSafeMarkdown('[p](//evil.example/x) <a href="https://example.org" onclick="alert(1)">x</a> <iframe src="https://evil.example"></iframe> <input type="text">')
  assert.doesNotMatch(hostile, /<a [^>]*href="\/\/evil/)
  assert.match(hostile, /\[p\]\(\/\/evil\.example\/x\)/)
  assert.doesNotMatch(hostile, /onclick/i)
  assert.doesNotMatch(hostile, /iframe/i)
  assert.doesNotMatch(hostile, /<input/i)
  assert.match(hostile, /href="https:\/\/example\.org"/)

  const review = reviewArticle({
    title: 'Markdown gallery sample',
    body: markdownGallerySource,
    authorshipMode: 'human_only',
    humanContribution: 'Written for the render check.',
    sources: [{ url: 'https://example.org/markdown-gallery' }],
  }, [])
  assert.equal(review.ok, true, JSON.stringify(review.findings))
  assert.equal(/^\s*#\s+\S/.test(markdownGallerySource), false)

  const gallery = renderSafeMarkdown(markdownGallerySource)
  const fragments = [
    '<h2 id="second-heading">Second heading</h2>',
    '<h3 id="third-heading">Third heading</h3>',
    '<h4 id="fourth-heading">Fourth heading</h4>',
    '<h5 id="fifth-heading">Fifth heading</h5>',
    '<h6 id="sixth-heading">Sixth heading</h6>',
    '<strong>gallery-bold</strong>',
    '<em>gallery-italic</em>',
    '<em><strong>gallery-both</strong></em>',
    '<s>gallery-strike</s>',
    '<code>gallery-code</code>',
    'class="language-js"',
    'class="language-mermaid"',
    '<blockquote>',
    'aiki-alert-note',
    'aiki-alert-tip',
    'aiki-alert-important',
    'aiki-alert-warning',
    'aiki-alert-caution',
    '<ul>',
    '<ol>',
    'nested item',
    'first ordered',
    'type="checkbox"',
    'checked',
    'href="https://example.org/markdown-gallery"',
    'rel="nofollow noopener noreferrer"',
    'href="https://example.org/visible-source"',
    'href="#second-heading"',
    'href="/node"',
    'class="aiki-button"',
    '<summary>Hidden detail</summary>',
    '<strong>gallery-hidden</strong>',
    'text-align:left',
    'text-align:center',
    'text-align:right',
    '<hr',
    'href="#fn-note"',
    'id="fn-note"',
    '<kbd>Ctrl</kbd>',
    '<sub>2</sub>',
    '<sup>2</sup>',
    '<mark>gallery-mark</mark>',
    '<br',
    '[[wikilink]]',
    'alt="pixel"',
    '[unsafe](javascript:alert(1))',
  ]
  for (const fragment of fragments) {
    assert.equal(gallery.includes(fragment), true, `gallery HTML should include ${fragment}`)
  }
  assert.equal(gallery.split('class="aiki-button"').length, 3)
  assert.equal(gallery.split('type="checkbox"').length, 3)
  assert.match(gallery, /<img [^>]*src="https:\/\/example\.org\/track\.png"[^>]*>/)
  assert.doesNotMatch(gallery, /<script/i)
  assert.doesNotMatch(gallery, /<iframe/i)
  assert.doesNotMatch(gallery, /href="[^"]*wikilink/)
  assert.doesNotMatch(gallery, /<svg/i)
  assert.match(gallery, /const n = 1/)
  assert.match(gallery, /graph TD/)

  const sources = [
    { canonical_url: 'https://example.org/first', title: 'First source' },
    { canonical_url: 'javascript:alert(1)', title: 'Blocked' },
    { url: 'https://example.org/third', title: 'Third "source"' },
  ]
  const cited = renderSafeMarkdown('Claim [1] and again [1]. Missing [2]. Later [3].\n\n`[1]` stays text.\n\n```\n[1]\n```\n\nSee [1](https://example.org/explicit).\n\n:::spoiler Note\n\nInside [3].\n\n:::\n\nFoot[^n]\n\n[^n]: Also [1].', { citations: sources })
  assert.match(cited, /<a href="https:\/\/example\.org\/first" target="_blank" class="aiki-citation" title="First source" rel="nofollow noopener noreferrer">\[1\]<\/a>/)
  assert.equal(cited.split('https://example.org/first').length, 4)
  assert.match(cited, /Missing \[2\]\./)
  assert.doesNotMatch(cited, /javascript:alert/)
  assert.match(cited, /<a href="https:\/\/example\.org\/third" target="_blank" class="aiki-citation" title="Third &quot;source&quot;" rel="nofollow noopener noreferrer">\[3\]<\/a>/)
  assert.match(cited, /<code>\[1\]<\/code>/)
  assert.match(cited, /<pre><code>\[1\]\n<\/code><\/pre>/)
  assert.match(cited, /<a href="https:\/\/example\.org\/explicit" rel="nofollow noopener noreferrer">1<\/a>/)
  assert.match(cited, /<summary>Note<\/summary>[\s\S]*href="https:\/\/example\.org\/third"/)
  assert.match(cited, /id="fn-n"[\s\S]*href="https:\/\/example\.org\/first"/)
  assert.doesNotMatch(renderSafeMarkdown('Plain [1] without sources.'), /aiki-citation/)

  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
  const topicPage = await readFile(path.join(root, 'server/api/topics/[slug].get.js'), 'utf8')
  const revisionPage = await readFile(path.join(root, 'server/api/topics/[slug]/revisions/[revisionId].get.js'), 'utf8')
  assert.match(topicPage, /renderSafeMarkdown\(topic\.body_markdown, \{ citations: citations\.rows \}\)/)
  assert.match(revisionPage, /renderSafeMarkdown\(revision\.body_markdown, \{ citations: citations\.rows \}\)/)
}
