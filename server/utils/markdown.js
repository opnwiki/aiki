import MarkdownIt from 'markdown-it'
import sanitizeHtml from 'sanitize-html'
import { localDomain, mentionHref, mentionPattern } from './mentions.js'

export const MARKDOWN_FORMAT_VERSION = 'aiki-markdown-1'

const ALERTS = ['NOTE', 'TIP', 'IMPORTANT', 'WARNING', 'CAUTION']
const SAFE_LINK = /^(https?:\/\/|mailto:)/i

export const markdownFormat = {
  version: MARKDOWN_FORMAT_VERSION,
  storedAs: 'body_markdown',
  versioning: 'Pages store Markdown source and are rendered with the current dialect. A page does not keep its own template version. The theme template layer is not versioned until that package exists, and a theme must not change this dialect.',
  constructs: [
    { name: 'heading', syntax: '## Title', example: '## Evidence', produces: 'id="evidence"' },
    { name: 'heading_deep', syntax: '##### Fifth and ###### Sixth', example: '##### Fifth\n\n###### Sixth', produces: 'id="fifth"' },
    { name: 'bold', syntax: '**bold** or __bold__', example: '**bold** and __also__', produces: '<strong>bold</strong>' },
    { name: 'italic', syntax: '*italic* or _italic_', example: '*italic*', produces: '<em>italic</em>' },
    { name: 'bold_italic', syntax: '***both***', example: '***both***', produces: '<em><strong>both</strong></em>' },
    { name: 'strike', syntax: '~~gone~~', example: '~~gone~~', produces: '<s>gone</s>' },
    { name: 'code', syntax: '`code`', example: 'use `code`', produces: '<code>code</code>' },
    { name: 'code_fence', syntax: '```lang then the code then ```', example: '```js\nconst n = 1\n```', produces: 'class="language-js"' },
    { name: 'quote', syntax: '> quoted', example: '> quoted', produces: '<blockquote>' },
    { name: 'alert', syntax: '> [!NOTE] then the text. Kinds: NOTE, TIP, IMPORTANT, WARNING, CAUTION', example: '> [!WARNING]\n> Be careful', produces: 'aiki-alert-warning' },
    { name: 'list', syntax: '- item or 1. item, including nested lists', example: '- one\n- two', produces: '<ul>' },
    { name: 'task', syntax: '- [ ] open and - [x] done', example: '- [x] done\n- [ ] open', produces: 'type="checkbox"' },
    { name: 'link', syntax: '[label](https://example.org) with http, https, mailto, /same-node-path, or #anchor', example: '[safe](https://example.org/source)', produces: 'href="https://example.org/source"' },
    { name: 'image', syntax: '![alt](https://example.org/pixel.png) external http/https images', example: '![diagram](https://example.org/diagram.png)', produces: 'src="https://example.org/diagram.png"' },
    { name: 'autolink', syntax: 'https://example.org or <https://example.org>', example: 'See https://example.org/visible-source', produces: 'href="https://example.org/visible-source"' },
    { name: 'button', syntax: '[label](https://example.org){button} or a :::button block', example: '[Open](https://example.org/source){button}', produces: 'class="aiki-button"' },
    { name: 'spoiler', syntax: ':::spoiler Title then Markdown then a line with only :::', example: ':::spoiler Hidden\n\nsecret **bit**\n\n:::', produces: '<details>' },
    { name: 'table', syntax: '| A | B | with | :--- | :---: | ---: | for alignment', example: '| A | B |\n| :--- | ---: |\n| 1 | 2 |', produces: 'text-align:right' },
    { name: 'rule', syntax: '---', example: '---', produces: '<hr' },
    { name: 'footnote', syntax: 'Claim[^note] then [^note]: The note', example: 'Claim[^note]\n\n[^note]: The note', produces: 'href="#fn-note"' },
    { name: 'keyboard', syntax: '<kbd>Ctrl</kbd>', example: '<kbd>Ctrl</kbd>', produces: '<kbd>Ctrl</kbd>' },
    { name: 'subsup', syntax: 'H<sub>2</sub>O and x<sup>2</sup>', example: 'H<sub>2</sub>O', produces: '<sub>2</sub>' },
    { name: 'mark', syntax: '<mark>term</mark>', example: '<mark>term</mark>', produces: '<mark>term</mark>' },
    { name: 'hard_break', syntax: 'end the line with two spaces', example: 'one  \ntwo', produces: '<br' },
  ],
  omitted: [
    'External images must use https (or http) addresses. javascript:, data:, and protocol-relative //host image and link addresses stay text.',
    'script, iframe, style, svg, forms, and event handlers are removed.',
    '[[wikilinks]] are not links yet.',
    'Math, mermaid and emoji shortcodes are ordinary text. A fenced mermaid block stays code.',
    '@username mentions a person or agent here, @user@server anyone on the Fediverse; both become profile links and notify them.',
    'A button is only a link. It cannot submit, call an API, or run script.',
  ],
}

const markdown = new MarkdownIt({ html: true, linkify: true, breaks: false, typographer: false })
markdown.validateLink = (url) => {
  const value = String(url || '').trim()
  if (!value || value.startsWith('//') || /^[a-z][a-z0-9+.-]*:/i.test(value) && !SAFE_LINK.test(value)) return false
  return true
}
markdown.block.ruler.before('paragraph', 'aiki_spoiler', spoilerRule)
markdown.block.ruler.before('paragraph', 'aiki_button', buttonBlockRule)
markdown.block.ruler.before('paragraph', 'aiki_footnote_def', footnoteDefRule)
markdown.inline.ruler.before('link', 'aiki_button', buttonInlineRule)
markdown.inline.ruler.before('link', 'aiki_citation', citationRefRule)
markdown.inline.ruler.after('emphasis', 'aiki_footnote_ref', footnoteRefRule)
markdown.core.ruler.after('inline', 'aiki_alerts', alertRule)
markdown.core.ruler.after('inline', 'aiki_task_lists', taskListRule)
markdown.core.ruler.after('inline', 'aiki_footnote_tail', footnoteTailRule)
markdown.core.ruler.after('inline', 'aiki_mentions', mentionRule)
markdown.renderer.rules.image = (tokens, idx) => {
  const attributes = tokens[idx].attrs || []
  const get = (name) => {
    const found = attributes.find(([key]) => key === name)
    return found ? found[1] : ''
  }
  const href = safeHref(get('src'))
  const alt = markdown.utils.escapeHtml(tokens[idx].content || get('alt'))
  const title = markdown.utils.escapeHtml(get('title'))
  if (!href) {
    // Keep the alternate text but drop an unsafe image address.
    return alt || ''
  }
  return '<img src="' + markdown.utils.escapeHtml(href) + '" alt="' + alt + '"' + (title ? ' title="' + title + '"' : '') + '>'
}
markdown.renderer.rules.aiki_fn_ref = (tokens, idx) => footnoteRefHtml(tokens[idx].meta)
markdown.renderer.rules.aiki_fn_tail = (tokens, idx, options, env) => footnoteTailHtml(env)
markdown.renderer.rules.aiki_nested = (tokens, idx, options) => {
  const meta = tokens[idx].meta || { tokens: [], env: {} }
  return markdown.renderer.render(meta.tokens, options, meta.env)
}

// @username and @user@server become profile links (outside code and links).
function mentionRule(state) {
  const domain = localDomain()
  for (const block of state.tokens) {
    if (block.type !== 'inline' || !block.children) continue
    const children = []
    let insideLink = 0
    for (const token of block.children) {
      if (token.type === 'link_open') insideLink += 1
      if (token.type === 'link_close') insideLink = Math.max(0, insideLink - 1)
      if (token.type !== 'text' || insideLink || !token.content.includes('@')) {
        children.push(token)
        continue
      }
      let last = 0
      const text = token.content
      for (const match of text.matchAll(mentionPattern())) {
        const username = match[2].replace(/[.-]+$/, '')
        if (!username) continue
        const start = match.index + match[1].length
        const end = start + 1 + username.length + (match[3] ? match[3].length + 1 : 0)
        if (start > last) children.push(Object.assign(new state.Token('text', '', 0), { content: text.slice(last, start) }))
        const open = new state.Token('link_open', 'a', 1)
        const external = Boolean(match[3]) && match[3].toLowerCase() !== domain
        open.attrs = [['href', mentionHref(username, match[3], domain)], ['class', 'mention']]
        if (external) open.attrs.push(['rel', 'nofollow noopener noreferrer'])
        // Like Mastodon: show @user, the full @user@server on hover.
        if (match[3]) open.attrs.push(['title', `@${username}@${match[3]}`])
        children.push(open)
        children.push(Object.assign(new state.Token('text', '', 0), { content: `@${username}` }))
        children.push(new state.Token('link_close', 'a', -1))
        last = end
      }
      if (last === 0) children.push(token)
      else if (last < text.length) children.push(Object.assign(new state.Token('text', '', 0), { content: text.slice(last) }))
    }
    block.children = children
  }
}

export function renderSafeMarkdown(source, options = {}) {
  const env = { citations: citationHrefs(options.citations) }
  const tokens = markdown.parse(String(source || ''), env)
  assignHeadingIds(tokens, new Map())
  return sanitizeHtml(markdown.renderer.render(tokens, markdown.options, env), sanitizeOptions())
}

function assignHeadingIds(tokens, counts) {
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index]
    if (token.meta?.tokens) assignHeadingIds(token.meta.tokens, counts)
    if (token.type !== 'heading_open') continue
    const inline = tokens[index + 1]
    const text = inline?.type === 'inline' && inline.children
      ? inline.children.map(child => child.content || '').join('')
      : ''
    const base = headingSlug(text)
    const count = (counts.get(base) || 0) + 1
    counts.set(base, count)
    token.attrSet('id', count === 1 ? base : `${base}-${count}`)
  }
}

function sanitizeOptions() {
  return {
    allowedTags: [
      'a', 'abbr', 'address', 'article', 'aside', 'blockquote', 'br', 'caption', 'code', 'dd', 'del', 'details', 'div',
      'dl', 'dt', 'em', 'figcaption', 'figure', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'hr', 'input', 'ins', 'kbd', 'li',
      'img', 'mark', 'ol', 'p', 'pre', 's', 'section', 'strong', 'sub', 'summary', 'sup', 'table', 'tbody', 'td', 'th', 'thead', 'tr', 'ul',
    ],
    allowedAttributes: {
      a: ['href', 'name', 'target', 'rel', 'class', 'title'],
      abbr: ['title'],
      code: ['class'],
      details: ['open'],
      div: ['class'],
      h1: ['id'], h2: ['id'], h3: ['id'], h4: ['id'], h5: ['id'], h6: ['id'],
      img: ['src', 'alt', 'title'],
      input: ['type', 'checked', 'disabled'],
      li: ['id', 'class'],
      ol: ['start'],
      section: ['class'],
      sup: ['id'],
      td: ['style'],
      th: ['style'],
    },
    allowedClasses: {
      a: ['aiki-button', 'aiki-citation', 'mention'],
      code: [/^language-[A-Za-z0-9_+-]+$/],
      div: ['aiki-alert', 'aiki-alert-note', 'aiki-alert-tip', 'aiki-alert-important', 'aiki-alert-warning', 'aiki-alert-caution'],
      li: ['aiki-task'],
      section: ['aiki-footnotes'],
    },
    allowedStyles: {
      td: { 'text-align': [/^\s*(left|center|right)\s*$/] },
      th: { 'text-align': [/^\s*(left|center|right)\s*$/] },
    },
    allowedSchemes: ['http', 'https', 'mailto'],
    allowedSchemesByTag: { a: ['http', 'https', 'mailto'], img: ['http', 'https'] },
    allowProtocolRelative: false,
    transformTags: {
      a: (tagName, attribs) => attribs.href
        ? { tagName: 'a', attribs: { ...attribs, rel: 'nofollow noopener noreferrer' } }
        : { tagName: 'span', attribs: {} },
      input: (tagName, attribs) => attribs.type === 'checkbox'
        ? { tagName: 'input', attribs: { type: 'checkbox', disabled: 'disabled', ...(attribs.checked !== undefined ? { checked: 'checked' } : {}) } }
        : { tagName: 'span', attribs: {} },
    },
  }
}

function headingSlug(value) {
  return String(value).normalize('NFKC').toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '') || 'section'
}

function lineText(state, line) {
  return state.src.slice(state.bMarks[line] + state.tShift[line], state.eMarks[line])
}

function closingFence(state, startLine, endLine) {
  let fence = null
  for (let line = startLine + 1; line < endLine; line += 1) {
    const text = lineText(state, line)
    const marker = /^(`{3,}|~{3,})/.exec(text.trim())
    if (marker) {
      const kind = marker[1][0]
      fence = fence === kind ? null : fence || kind
      continue
    }
    if (!fence && /^:::[ \t]*$/.test(text)) return line
  }
  return -1
}

function spoilerRule(state, startLine, endLine, silent) {
  const match = /^:::spoiler(?:[ \t]+(\S.*?))?[ \t]*$/.exec(lineText(state, startLine))
  if (!match) return false
  const close = closingFence(state, startLine, endLine)
  if (close < 0) return false
  if (silent) return true
  const title = (match[1] || 'Details').trim().slice(0, 180)
  const contentStart = state.bMarks[startLine + 1]
  const contentEnd = state.bMarks[close]
  const content = state.src.slice(contentStart, contentEnd).replace(/\n$/, '')
  state.push('details_open', 'details', 1)
  state.push('summary_open', 'summary', 1)
  const summary = state.push('inline', '', 0)
  summary.content = title
  summary.children = []
  state.push('summary_close', 'summary', -1)
  const nestedEnv = { citations: state.env.citations }
  const nested = state.push('aiki_nested', '', 0)
  nested.block = true
  nested.meta = { tokens: state.md.parse(content, nestedEnv), env: nestedEnv }
  state.push('details_close', 'details', -1)
  state.line = close + 1
  return true
}

function buttonBlockRule(state, startLine, endLine, silent) {
  const match = /^:::button[ \t]+(\S+)[ \t]*$/.exec(lineText(state, startLine))
  if (!match) return false
  const href = safeHref(match[1])
  if (!href) return false
  const close = closingFence(state, startLine, endLine)
  if (close < 0) return false
  const label = state.src.slice(state.bMarks[startLine + 1], state.bMarks[close]).replace(/\s+/g, ' ').trim().slice(0, 80)
  if (!label) return false
  if (silent) return true
  const open = state.push('paragraph_open', 'p', 1)
  open.block = true
  const link = state.push('inline', '', 0)
  link.content = ''
  link.children = []
  const linkOpen = new state.Token('link_open', 'a', 1)
  linkOpen.attrSet('href', href)
  linkOpen.attrSet('class', 'aiki-button')
  const text = new state.Token('text', '', 0)
  text.content = label
  const linkClose = new state.Token('link_close', 'a', -1)
  link.children = [linkOpen, text, linkClose]
  state.push('paragraph_close', 'p', -1)
  state.line = close + 1
  return true
}

function buttonInlineRule(state, silent) {
  const match = /^\[([^\]\n]{1,80})\]\(([^)\s]+)\)\{button\}/.exec(state.src.slice(state.pos))
  if (!match) return false
  const href = safeHref(match[2])
  if (!href) return false
  if (silent) return true
  const open = state.push('link_open', 'a', 1)
  open.attrSet('href', href)
  open.attrSet('class', 'aiki-button')
  const text = state.push('text', '', 0)
  text.content = match[1]
  state.push('link_close', 'a', -1)
  state.pos += match[0].length
  return true
}

function safeHref(value) {
  const href = String(value || '').trim()
  if (!href || href.length > 2048 || /[\u0000-\u0020]/.test(href)) return ''
  if (href.startsWith('#') && !href.startsWith('#//')) return href
  if (href.startsWith('/') && !href.startsWith('//')) return href
  if (!SAFE_LINK.test(href)) return ''
  try {
    const url = new URL(href)
    if (!['http:', 'https:', 'mailto:'].includes(url.protocol)) return ''
    return href
  } catch {
    return ''
  }
}

function footnoteDefRule(state, startLine, endLine, silent) {
  const match = /^\[\^([A-Za-z0-9_-]{1,64})\]:[ \t]*(.*)$/.exec(lineText(state, startLine))
  if (!match) return false
  if (silent) return true
  let text = match[2].trim()
  let next = startLine + 1
  while (next < endLine) {
    const raw = state.src.slice(state.bMarks[next], state.eMarks[next])
    if (!/^[ \t]{2,}\S/.test(raw)) break
    text = `${text} ${raw.trim()}`.trim()
    next += 1
  }
  state.env.footnotes = state.env.footnotes || {}
  if (!state.env.footnotes[match[1]]) state.env.footnotes[match[1]] = { text }
  state.line = next
  return true
}

function citationHrefs(citations) {
  if (!Array.isArray(citations)) return []
  return citations.map(item => {
    const href = safeHref(item?.canonical_url || item?.url || '')
    if (!href) return null
    const title = String(item?.title || '').replace(/\s+/g, ' ').trim().slice(0, 240)
    return { href, title }
  })
}

function citationRefRule(state, silent) {
  if (state.linkLevel > 0) return false
  const match = /^\[([1-9]\d{0,2})\](?!\()/.exec(state.src.slice(state.pos))
  if (!match) return false
  const number = Number(match[1])
  const source = state.env.citations?.[number - 1]
  if (!source?.href) return false
  if (silent) return true
  const open = state.push('link_open', 'a', 1)
  open.attrSet('href', source.href)
  open.attrSet('target', '_blank')
  open.attrSet('class', 'aiki-citation')
  if (source.title) open.attrSet('title', source.title)
  const text = state.push('text', '', 0)
  text.content = `[${number}]`
  state.push('link_close', 'a', -1)
  state.pos += match[0].length
  return true
}

function footnoteRefRule(state, silent) {
  if (state.linkLevel > 0) return false
  const match = /^\[\^([A-Za-z0-9_-]{1,64})\]/.exec(state.src.slice(state.pos))
  if (!match) return false
  if (silent) return true
  const token = state.push('aiki_fn_ref', '', 0)
  token.meta = { id: match[1] }
  state.pos += match[0].length
  return true
}

function footnoteTailRule(state) {
  const notes = state.env.footnotes
  if (!notes) return
  let number = 0
  for (const token of state.tokens) {
    const children = token.children || []
    for (const child of children) {
      if (child.type !== 'aiki_fn_ref') continue
      const note = notes[child.meta.id]
      if (!note) continue
      if (!note.number) note.number = ++number
      child.meta.number = note.number
    }
  }
  if (!number) return
  const tail = new state.Token('aiki_fn_tail', '', 0)
  state.tokens.push(tail)
}

function footnoteRefHtml(meta) {
  if (!meta?.number) return `[^${markdown.utils.escapeHtml(meta?.id || '')}]`
  const id = markdown.utils.escapeHtml(meta.id)
  return `<sup id="fnref-${id}"><a href="#fn-${id}">${meta.number}</a></sup>`
}

function footnoteTailHtml(env) {
  const notes = Object.entries(env?.footnotes || {}).filter(([, note]) => note.number)
  notes.sort((a, b) => a[1].number - b[1].number)
  if (!notes.length) return ''
  const items = notes.map(([id, note]) => {
    const safeId = markdown.utils.escapeHtml(id)
    const body = markdown.renderInline(note.text || '', { citations: env?.citations || [] })
    return `<li id="fn-${safeId}">${body} <a href="#fnref-${safeId}">↩</a></li>`
  }).join('')
  return `<section class="aiki-footnotes"><ol>${items}</ol></section>`
}

function alertRule(state) {
  const tokens = state.tokens
  for (let index = 0; index < tokens.length; index += 1) {
    if (tokens[index].type !== 'blockquote_open') continue
    let depth = 0
    let close = -1
    let inlineIndex = -1
    for (let cursor = index; cursor < tokens.length; cursor += 1) {
      if (tokens[cursor].type === 'blockquote_open') depth += 1
      if (inlineIndex < 0 && tokens[cursor].type === 'inline') inlineIndex = cursor
      if (tokens[cursor].type === 'blockquote_close') {
        depth -= 1
        if (depth === 0) {
          close = cursor
          break
        }
      }
    }
    if (close < 0 || inlineIndex < 0) continue
    const text = tokens[inlineIndex].children?.find(child => child.type === 'text' && child.content.trim())
    const match = text && /^\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\][ \t]*\n?/.exec(text.content)
    if (!match || !ALERTS.includes(match[1])) continue
    text.content = text.content.slice(match[0].length)
    tokens[index].type = 'aiki_alert_open'
    tokens[index].tag = 'div'
    tokens[index].attrSet('class', `aiki-alert aiki-alert-${match[1].toLowerCase()}`)
    tokens[close].type = 'aiki_alert_close'
    tokens[close].tag = 'div'
    const label = new state.Token('html_block', '', 0)
    label.content = `<p>${match[1]}</p>\n`
    tokens.splice(index + 1, 0, label)
    index = close + 1
  }
}

function taskListRule(state) {
  const tokens = state.tokens
  for (let index = 2; index < tokens.length; index += 1) {
    if (tokens[index].type !== 'inline' || tokens[index - 1].type !== 'paragraph_open' || tokens[index - 2].type !== 'list_item_open') continue
    const text = tokens[index].children?.[0]
    if (!text || text.type !== 'text') continue
    const match = /^\[([ xX])\][ \t]+/.exec(text.content)
    if (!match) continue
    text.content = text.content.slice(match[0].length)
    const box = new state.Token('html_inline', '', 0)
    const checked = match[1].toLowerCase() === 'x' ? ' checked' : ''
    box.content = `<input type="checkbox" disabled${checked}> `
    tokens[index].children.unshift(box)
    tokens[index - 2].attrJoin('class', 'aiki-task')
  }
}
