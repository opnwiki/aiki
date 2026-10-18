const AUTHORSHIP = {
  human_only: 'Written by a human',
  human_ai_collaboration: 'Created with human and AI collaboration',
  ai_generated_human_reviewed: 'AI-generated and reviewed by a human',
  ai_generated_unreviewed: 'AI-generated, not reviewed by a human',
  legacy_undisclosed: 'Authorship not disclosed',
}

export function buildMachineDocument(topic, { siteUrl, nodeDomain }) {
  const origin = String(siteUrl || '').replace(/\/$/, '')
  const slug = topic.page_number != null ? String(topic.page_number) : encodeURIComponent(topic.slug)
  const locale = topic.locale || 'en'
  const query = `?locale=${encodeURIComponent(locale)}`
  const canonicalUrl = `${origin}/${slug}`
  const formats = {
    html: canonicalUrl,
    markdown: `${origin}/${slug}.md${query}`,
    text: `${origin}/${slug}.txt${query}`,
    json: `${origin}/${slug}.json${query}`,
    jsonld: `${origin}/${slug}.jsonld${query}`,
  }
  const authorName = topic.hideAuthor ? 'Author hidden' : topic.author_display_name || `${topic.author || 'community'}@${nodeDomain}`
  const authorship = AUTHORSHIP[topic.authorship_mode] || null
  const sources = (topic.citations || []).map(source => ({
    url: source.canonical_url,
    title: source.title || null,
    publisher: source.publisher || null,
    locator: source.locator || null,
    note: source.note || null,
  }))
  const discussion = (topic.replies || []).map(reply => ({
    author: reply.anonymous ? 'Anonymous participant' : reply.author_display_name || `${reply.author || 'community'}@${nodeDomain}`,
    created_at: isoTimestamp(reply.created_at),
    body_markdown: reply.body_markdown,
  }))
  const document = {
    slug: topic.slug,
    title: topic.title,
    kind: topic.kind,
    locale,
    summary: topic.summary || null,
    body_markdown: topic.body_markdown,
    author: authorName,
    author_hidden: Boolean(topic.hideAuthor),
    authorship,
    authorship_mode: topic.authorship_mode || null,
    model_name: topic.model_name || null,
    human_contribution: topic.human_contribution || null,
    created_at: isoTimestamp(topic.created_at),
    updated_at: isoTimestamp(topic.revision_created_at),
    revision_id: topic.revision_id,
    canonical_url: canonicalUrl,
    formats,
    sources,
    discussion,
  }
  return {
    locale,
    markdown: renderMarkdown(document),
    text: renderText(document),
    json: document,
    jsonld: renderJsonLd(document, origin),
  }
}

function renderMarkdown(document) {
  const lines = [`# ${document.title}`, '']
  if (document.summary) lines.push(`> ${document.summary}`, '')
  lines.push(
    `- **Kind:** ${document.kind}`,
    `- **Locale:** ${document.locale}`,
    `- **Author:** ${document.author}`,
    `- **Canonical URL:** ${document.canonical_url}`,
    `- **Updated:** ${document.updated_at}`,
  )
  if (document.authorship) lines.push(`- **Authorship:** ${document.authorship}`)
  if (document.model_name) lines.push(`- **AI model:** ${document.model_name}`)
  if (document.human_contribution) lines.push(`- **Human contribution:** ${document.human_contribution}`)
  lines.push('', document.body_markdown.trim(), '', '## Sources', '')
  if (!document.sources.length) lines.push('No sources attached to this revision.')
  document.sources.forEach((source, index) => {
    const label = source.title || source.url
    const details = [source.publisher, source.locator, source.note].filter(Boolean).join(' — ')
    lines.push(`${index + 1}. [${label}](${source.url})${details ? ` — ${details}` : ''}`)
  })
  lines.push('', '## Discussion', '')
  if (!document.discussion.length) lines.push('No replies yet.')
  for (const reply of document.discussion) {
    lines.push(`### ${reply.author} · ${reply.created_at}`, '', reply.body_markdown.trim(), '')
  }
  return `${lines.join('\n').trim()}\n`
}

function renderText(document) {
  return `${markdownToText(renderMarkdown(document)).trim()}\n`
}

function renderJsonLd(document, origin) {
  const type = { article: 'Article', question: 'Question', discussion: 'DiscussionForumPosting' }[document.kind] || 'CreativeWork'
  const author = jsonLdAuthor(document)
  const citation = document.sources.map(source => ({
    '@type': 'CreativeWork',
    url: source.url,
    name: source.title || source.url,
    publisher: source.publisher ? { '@type': 'Organization', name: source.publisher } : undefined,
  }))
  const node = {
    '@type': type,
    '@id': document.canonical_url,
    url: document.canonical_url,
    inLanguage: document.locale,
    datePublished: document.created_at,
    dateModified: document.updated_at,
    author,
    publisher: { '@type': 'Organization', name: 'AIKI', url: origin },
    citation,
    creativeWorkStatus: document.authorship || undefined,
  }
  if (type === 'Question') {
    node.name = document.title
    node.text = document.body_markdown
  } else if (type === 'DiscussionForumPosting') {
    node.headline = document.title
    node.text = document.body_markdown
    node.comment = document.discussion.map(reply => ({
      '@type': 'Comment',
      text: reply.body_markdown,
      dateCreated: reply.created_at,
      author: { '@type': 'Person', name: reply.author },
    }))
  } else {
    node.headline = document.title
    node.description = document.summary || undefined
    node.articleBody = document.body_markdown
  }
  return {
    '@context': 'https://schema.org',
    ...stripEmpty(node),
  }
}

function jsonLdAuthor(document) {
  const software = document.model_name ? { '@type': 'SoftwareApplication', name: document.model_name } : null
  if (document.author_hidden) return software || undefined
  const person = { '@type': 'Person', name: document.author }
  if (document.authorship_mode === 'human_ai_collaboration' && software) return [person, software]
  if (document.authorship_mode?.startsWith('ai_generated') && software) return software
  return person
}

function stripEmpty(value) {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined))
}

function isoTimestamp(value) {
  if (!value) return null
  const date = value instanceof Date ? value : new Date(value)
  return Number.isNaN(date.getTime()) ? String(value) : date.toISOString()
}

function markdownToText(value) {
  return String(value)
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1 ($2)')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/^>\s?/gm, '')
    .replace(/\*\*/g, '')
}
