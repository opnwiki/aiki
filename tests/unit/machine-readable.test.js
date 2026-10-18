import { buildMachineDocument } from '../../server/utils/machine-readable.js'

const topic = {
  slug: 'welcome-to-aiki',
  kind: 'article',
  locale: 'en',
  title: 'Welcome to AIKI',
  summary: 'Local starter fixture',
  body_markdown: 'AIKI is an open space.\n\n## How this node works\n\nReading is open.',
  author: 'aiki-starter',
  authorship_mode: 'ai_generated_unreviewed',
  model_name: 'Loopback fixture model',
  human_contribution: null,
  created_at: '2026-10-02T00:00:00.000Z',
  revision_created_at: '2026-10-02T01:00:00.000Z',
  revision_id: '00000000-0000-4000-8000-000000000021',
  citations: [{ canonical_url: 'https://example.org/source', title: 'Example source', publisher: 'Example', locator: 'p. 2', note: null }],
  replies: [{ author: 'reader', created_at: '2026-10-02T02:00:00.000Z', body_markdown: 'A public reply.' }],
}

export function run({ assert }) {
  const document = buildMachineDocument(topic, { siteUrl: 'https://aiki.wiki/', nodeDomain: 'aiki.wiki' })
  assert.match(document.markdown, /^# Welcome to AIKI\n/)
  assert.match(document.markdown, /AI-generated, not reviewed by a human/)
  assert.match(document.markdown, /Loopback fixture model/)
  assert.match(document.markdown, /\[Example source\]\(https:\/\/example\.org\/source\) — Example — p\. 2/)
  assert.match(document.markdown, /### reader@aiki\.wiki/)
  assert.doesNotMatch(document.markdown, /human_contribution/)
  assert.match(document.text, /Welcome to AIKI/)
  assert.match(document.text, /Example source \(https:\/\/example\.org\/source\)/)
  assert.doesNotMatch(document.text, /\[Example source\]/)
  assert.equal(document.json.canonical_url, 'https://aiki.wiki/welcome-to-aiki')
  assert.equal(document.json.formats.markdown, 'https://aiki.wiki/welcome-to-aiki.md?locale=en')
  assert.equal(document.json.sources[0].url, 'https://example.org/source')
  assert.equal(document.jsonld['@context'], 'https://schema.org')
  assert.equal(document.jsonld['@type'], 'Article')
  assert.equal(document.jsonld.headline, 'Welcome to AIKI')
  assert.equal(document.jsonld.author['@type'], 'SoftwareApplication')
  assert.equal(document.jsonld.author.name, 'Loopback fixture model')
  assert.equal(document.jsonld.citation[0].url, 'https://example.org/source')

  const question = buildMachineDocument({ ...topic, kind: 'question', authorship_mode: 'human_only', model_name: null }, { siteUrl: 'https://aiki.wiki', nodeDomain: 'aiki.wiki' })
  assert.equal(question.jsonld['@type'], 'Question')
  assert.equal(question.jsonld.author['@type'], 'Person')
  assert.equal(question.jsonld.name, 'Welcome to AIKI')
}
