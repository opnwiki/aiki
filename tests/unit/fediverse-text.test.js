import { htmlToPlainText, shortTitle, stripLeadingMentions } from '../../server/utils/fediverse-text.js'

export async function run({ assert }) {
  // Paragraphs survive instead of gluing words ("look</p><p>I" -> "lookI").
  assert.equal(htmlToPlainText('<p>that look</p><p>I also<br>was</p>'), 'that look\n\nI also\nwas')
  assert.equal(htmlToPlainText('<p>Tom &amp; Jerry&#39;s</p>'), "Tom & Jerry's")
  // Automatic reply mentions are dropped; a mention-only post is kept as is.
  assert.equal(stripLeadingMentions('@Sempf @bob@infosec.exchange cuz you can tell'), 'cuz you can tell')
  assert.equal(stripLeadingMentions('Hi @ask there'), 'Hi @ask there')
  assert.equal(stripLeadingMentions('@ask'), '@ask')
  // Titles: first sentence, no links, at most ~100 characters.
  assert.equal(shortTitle('@ask@aiki.wiki Many small shops close this year. Why?', 'x'), 'Many small shops close this year.')
  assert.ok(!shortTitle('Look https://example.com/very/long and more text here', 'x').includes('http'))
  assert.ok(shortTitle('word '.repeat(60), 'x').length <= 101)
  assert.equal(shortTitle('', 'Fallback'), 'Fallback')
}
