import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { writeFile as writeText } from 'node:fs/promises'
import pg from 'pg'

const base = (process.env.AIKI_TEST_BASE_URL || '').replace(/\/$/, '')
if (!base) throw new Error('Set AIKI_TEST_BASE_URL to an isolated test server URL')
const origin = new URL(base).origin
const suffix = randomBytes(4).toString('hex')
const password = `AIKI-cycle-${randomBytes(18).toString('base64url')}`
const humanNote = 'تصحيح بشري: في هذه الصفحة يُفضَّل مصطلح الكمبيوتر على الحاسوب.'
const marker = 'AIKI-MARK-0739'
const sourceBody = [
  'Компьютер — это программируемое электронное устройство.',
  'Процессор читает команды из памяти и выполняет их шаг за шагом.',
  'Память хранит программы и данные, пока они нужны устройству.',
].join('\n\n')
const readerBody = `${sourceBody}\n\nУстройства ввода и вывода связывают компьютер с человеком.`
const ownerBody = `${readerBody}\n\nВнешняя память, например диск, сохраняет данные после выключения. Метка ${marker}.`

async function request(path, { method = 'GET', body, cookie, bearer } = {}) {
  const headers = { accept: 'application/json' }
  if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(method.toUpperCase())) headers.origin = origin
  if (body !== undefined) headers['content-type'] = 'application/json'
  if (cookie) headers.cookie = cookie
  if (bearer) headers.authorization = `Bearer ${bearer}`
  const response = await fetch(`${base}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    redirect: 'manual',
  })
  const text = await response.text()
  let data = null
  try { data = text ? JSON.parse(text) : null } catch { data = text }
  return { response, data }
}

function cookieFrom(response) {
  const token = (response.headers.get('set-cookie') || '').match(/(?:^|,\s*)aiki_session=([^;,]+)/)?.[1]
  assert.ok(token, 'session cookie')
  return `aiki_session=${token}`
}

async function register(username) {
  const result = await request('/api/auth/register', {
    method: 'POST',
    body: { username, email: `${username}@example.org`, password },
  })
  assert.equal(result.response.status, 201, JSON.stringify(result.data))
  return { cookie: cookieFrom(result.response), actor: result.data.actor }
}

async function mcp(key, id, name, args) {
  const result = await request('/mcp', {
    method: 'POST',
    bearer: key,
    body: { jsonrpc: '2.0', id, method: 'tools/call', params: { name, arguments: args } },
  })
  assert.equal(result.response.status, 200, JSON.stringify(result.data))
  assert.equal(result.data.result?.isError, false, JSON.stringify(result.data))
  return result.data.result.structuredContent
}

function hasArabic(text) {
  return /[\u0600-\u06FF]/.test(String(text || ''))
}

const db = new pg.Client({ connectionString: process.env.DATABASE_URL })
await db.connect()
try {
  const owner = await register(`cycle-owner-${suffix}`)
  const readerA = await register(`cycle-reader-a-${suffix}`)
  const readerB = await register(`cycle-reader-b-${suffix}`)
  const enrollment = await request('/api/agents', {
    method: 'POST',
    cookie: owner.cookie,
    body: { username: `grok-writer-${suffix}` },
  })
  assert.equal(enrollment.response.status, 201, JSON.stringify(enrollment.data))
  const agentKey = enrollment.data.api_key

  const created = await mcp(agentKey, 1, 'aiki_create_article', {
    title: 'Компьютер',
    body: sourceBody,
    locale: 'ru',
    authorshipMode: 'ai_generated_unreviewed',
    modelName: 'Grok 4.7',
    rulesConsent: true,
    sources: [{ url: 'https://www.britannica.com/technology/computer', title: 'Computer', publisher: 'Britannica' }],
  })
  const slug = created.slug
  assert.ok(slug)

  const original = await request(`/api/topics/${encodeURIComponent(slug)}?locale=ru`)
  assert.equal(original.response.status, 200)
  assert.equal(original.data.locale, 'ru')
  assert.equal(original.data.model_name, 'Grok 4.7')
  assert.equal(original.data.title, 'Компьютер')
  const baseRevisionId = original.data.revision_id

  const proposalA = await request(`/api/topics/${encodeURIComponent(slug)}/proposals`, {
    method: 'POST',
    cookie: readerA.cookie,
    body: {
      locale: 'ru',
      baseRevisionId,
      proposedBody: readerBody,
      rationale: 'Добавить устройства ввода и вывода и отдельный источник.',
      sources: [{ url: 'https://www.wikidata.org/wiki/Q68', title: 'computer', publisher: 'Wikidata' }],
    },
  })
  assert.equal(proposalA.response.status, 201, JSON.stringify(proposalA.data))
  assert.equal(proposalA.data.sources, 1)

  const proposalB = await request(`/api/topics/${encodeURIComponent(slug)}/proposals`, {
    method: 'POST',
    cookie: readerB.cookie,
    body: {
      locale: 'ru',
      baseRevisionId,
      proposedBody: `${sourceBody}\n\nОперационная система распределяет время процессора между программами.`,
      rationale: 'Добавить роль операционной системы и источник энциклопедии.',
      sources: [{ url: 'https://en.wikipedia.org/wiki/Computer', title: 'Computer', publisher: 'Wikipedia' }],
    },
  })
  assert.equal(proposalB.response.status, 201, JSON.stringify(proposalB.data))

  const rootA = await request(`/api/topics/${encodeURIComponent(slug)}/replies`, {
    method: 'POST',
    cookie: readerA.cookie,
    body: { body: 'Где здесь место операционной системы?', locale: 'ru' },
  })
  assert.equal(rootA.response.status, 201, JSON.stringify(rootA.data))
  const replyA = await request(`/api/topics/${encodeURIComponent(slug)}/replies`, {
    method: 'POST',
    cookie: readerB.cookie,
    body: { body: 'Она тоже лежит в памяти, пока выполняется.', locale: 'ru', parentReplyId: rootA.data.reply.id },
  })
  assert.equal(replyA.response.status, 201, JSON.stringify(replyA.data))
  const rootB = await request(`/api/topics/${encodeURIComponent(slug)}/replies`, {
    method: 'POST',
    cookie: readerB.cookie,
    body: { body: 'Интересно, как это связано с сетью.', locale: 'ru' },
  })
  assert.equal(rootB.response.status, 201, JSON.stringify(rootB.data))
  const replyB = await request(`/api/topics/${encodeURIComponent(slug)}/replies`, {
    method: 'POST',
    cookie: readerA.cookie,
    body: { body: 'Сеть можно описать отдельной страницей.', locale: 'ru', parentReplyId: rootB.data.reply.id },
  })
  assert.equal(replyB.response.status, 201, JSON.stringify(replyB.data))

  const acceptedA = await request(`/api/topics/${encodeURIComponent(slug)}/proposals/${proposalA.data.proposal.id}`, {
    method: 'PATCH',
    cookie: owner.cookie,
    body: { action: 'accept', comment: 'Устройства ввода и вывода относятся к описанию компьютера.' },
  })
  assert.equal(acceptedA.response.status, 200, JSON.stringify(acceptedA.data))

  const published = await request(`/api/topics/${encodeURIComponent(slug)}?locale=ru`)
  assert.match(published.data.body_markdown, /Устройства ввода и вывода/)
  assert.equal(published.data.model_name, 'Grok 4.7')
  assert.ok(published.data.citations.some(item => item.canonical_url.includes('wikidata.org/wiki/Q68')))
  assert.equal(published.data.replies.length, 4)
  const roots = published.data.replies.filter(item => !item.parent_reply_id)
  assert.equal(roots.length, 2)
  assert.equal(published.data.replies.filter(item => item.parent_reply_id).length, 2)

  const storedB = await db.query('SELECT url FROM edit_proposal_sources WHERE proposal_id = $1', [proposalB.data.proposal.id])
  assert.equal(storedB.rows[0]?.url, 'https://en.wikipedia.org/wiki/Computer')

  const arabic = await request(`/api/topics/${encodeURIComponent(slug)}?locale=ar`)
  assert.equal(arabic.response.status, 200, JSON.stringify(arabic.data))
  assert.equal(arabic.data.locale, 'ar')
  assert.equal(arabic.data.translation?.status, 'ready')
  assert.equal(arabic.data.translation?.sourceLocale, 'ru')
  assert.equal(arabic.data.translation?.humanAdjusted, false)
  assert.ok(hasArabic(arabic.data.title), arabic.data.title)
  assert.ok(hasArabic(arabic.data.body_markdown))
  assert.notEqual(arabic.data.body_markdown, published.data.body_markdown)
  const arabicBefore = arabic.data.body_markdown

  const arabicProposal = await request(`/api/topics/${encodeURIComponent(slug)}/proposals`, {
    method: 'POST',
    cookie: readerB.cookie,
    body: {
      locale: 'ar',
      baseRevisionId: arabic.data.revision_id,
      proposedBody: `${arabic.data.body_markdown}\n\n${humanNote}`,
      rationale: 'Prefer the word كمبيوتر in the Arabic text.',
    },
  })
  assert.equal(arabicProposal.response.status, 201, JSON.stringify(arabicProposal.data))
  const arabicAccepted = await request(`/api/topics/${encodeURIComponent(slug)}/proposals/${arabicProposal.data.proposal.id}`, {
    method: 'PATCH',
    cookie: owner.cookie,
    body: { action: 'accept', comment: 'The Arabic wording is accepted for this language only.' },
  })
  assert.equal(arabicAccepted.response.status, 200, JSON.stringify(arabicAccepted.data))
  const arabicEdited = await request(`/api/topics/${encodeURIComponent(slug)}?locale=ar`)
  assert.match(arabicEdited.data.body_markdown, /تصحيح بشري/)
  assert.equal(arabicEdited.data.translation?.humanAdjusted, true)
  assert.equal(arabicEdited.data.locale, 'ar')

  const russianNow = await request(`/api/topics/${encodeURIComponent(slug)}?locale=ru`)
  const ownerProposal = await mcp(agentKey, 2, 'aiki_propose_article_edit', {
    slug,
    locale: 'ru',
    baseRevisionId: russianNow.data.revision_id,
    proposedBody: ownerBody,
    rationale: 'Добавить внешнюю память и метку цикла.',
  })
  const ownerProposalId = ownerProposal.proposal?.id || ownerProposal.id
  assert.ok(ownerProposalId, JSON.stringify(ownerProposal))
  const ownerAccepted = await request(`/api/topics/${encodeURIComponent(slug)}/proposals/${ownerProposalId}`, {
    method: 'PATCH',
    cookie: owner.cookie,
    body: { action: 'accept', comment: 'Внешняя память дополняет описание компьютера.' },
  })
  assert.equal(ownerAccepted.response.status, 200, JSON.stringify(ownerAccepted.data))

  const russianFinal = await request(`/api/topics/${encodeURIComponent(slug)}?locale=ru`)
  assert.match(russianFinal.data.body_markdown, new RegExp(marker))
  assert.match(russianFinal.data.body_markdown, /Устройства ввода и вывода/)
  assert.equal(russianFinal.data.model_name, 'Grok 4.7')

  const arabicFinal = await request(`/api/topics/${encodeURIComponent(slug)}?locale=ar`)
  assert.equal(arabicFinal.data.locale, 'ar')
  assert.match(arabicFinal.data.body_markdown, /تصحيح بشري/)
  assert.match(arabicFinal.data.body_markdown, new RegExp(marker))
  assert.ok(hasArabic(arabicFinal.data.body_markdown))
  assert.notEqual(arabicFinal.data.body_markdown, arabicBefore)
  assert.notEqual(arabicFinal.data.body_markdown, arabicEdited.data.body_markdown)
  assert.equal(arabicFinal.data.translation?.humanAdjusted, true)
  assert.equal(arabicFinal.data.translation?.sourceLocale, 'ru')

  await writeText('/tmp/aiki-cycle.json', JSON.stringify({ base, slug, marker, humanNote }, null, 2))
  console.log(JSON.stringify({
    slug,
    russianTitle: russianFinal.data.title,
    arabicTitle: arabicFinal.data.title,
    model: russianFinal.data.model_name,
    humanAdjusted: arabicFinal.data.translation.humanAdjusted,
    marker: arabicFinal.data.body_markdown.includes(marker),
  }, null, 2))
} finally {
  await db.end()
}
