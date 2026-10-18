import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import pg from 'pg'
import { applyPatch, revertPatch } from '../../server/utils/revision-diff.js'

const base = (process.env.AIKI_TEST_BASE_URL || '').replace(/\/$/, '')
if (!base) throw new Error('Set AIKI_TEST_BASE_URL to an isolated test server URL')
const origin = new URL(base).origin
const suffix = randomBytes(4).toString('hex')
const password = `AIKI-diff-${randomBytes(18).toString('base64url')}`
const marker = 'AIKI-MARK-0739'
const humanNote = 'تصحيح بشري: في هذه الصفحة يُفضَّل مصطلح الكمبيوتر على الحاسوب.'
const sourceBody = [
  'Компьютер — это программируемое электронное устройство.',
  'Процессор читает команды из памяти и выполняет их шаг за шагом.',
].join('\n\n')
const readerBody = `${sourceBody}\n\nУстройства ввода и вывода связывают компьютер с человеком.`
const ownerBody = `${readerBody}\n\nВнешняя память сохраняет данные после выключения. Метка ${marker}.`

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
  return { cookie: cookieFrom(result.response), actor: result.data.actor, username: result.data.actor.username }
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

function restore(items) {
  const byId = new Map(items.map(item => [item.id, item]))
  const memo = new Map()
  function view(id) {
    if (memo.has(id)) return memo.get(id)
    const item = byId.get(id)
    assert.ok(item, `missing revision ${id}`)
    const parent = item.parentId ? view(item.parentId) : { title: '', body: '' }
    const title = applyPatch(parent.title, item.titleOps)
    const body = applyPatch(parent.body, item.bodyOps)
    assert.equal(title, item.titleText, `title restore ${item.origin}`)
    assert.equal(body, item.bodyText, `body restore ${item.origin}`)
    assert.equal(revertPatch(title, item.titleOps), parent.title, `title revert ${item.origin}`)
    assert.equal(revertPatch(body, item.bodyOps), parent.body, `body revert ${item.origin}`)
    assert.ok(item.introducedAt, 'introduced time')
    assert.ok(item.confirmedAt, 'confirmed time')
    assert.ok(new Date(item.confirmedAt) >= new Date(item.introducedAt), 'confirmation follows the change')
    const restored = { title, body }
    memo.set(id, restored)
    return restored
  }
  for (const item of items) view(item.id)
  return items.map(item => ({ item, view: memo.get(item.id) }))
}

const db = new pg.Client({ connectionString: process.env.DATABASE_URL })
await db.connect()
try {
  const starter = await request('/api/topics/welcome-to-aiki/changes?locale=en')
  assert.equal(starter.response.status, 200, JSON.stringify(starter.data))
  assert.equal(starter.data.complete, true)
  assert.ok(starter.data.items.length >= 1)
  restore(starter.data.items)
  assert.equal(starter.data.items[0].origin, 'publication')

  const owner = await register(`diff-owner-${suffix}`)
  const reader = await register(`diff-reader-${suffix}`)
  const enrollment = await request('/api/agents', {
    method: 'POST',
    cookie: owner.cookie,
    body: { username: `diff-writer-${suffix}` },
  })
  assert.equal(enrollment.response.status, 201, JSON.stringify(enrollment.data))
  const agentName = `diff-writer-${suffix}`
  const created = await mcp(enrollment.data.api_key, 1, 'aiki_create_article', {
    title: 'Компьютер',
    body: sourceBody,
    locale: 'ru',
    authorshipMode: 'ai_generated_unreviewed',
    modelName: 'Grok 4.7',
    rulesConsent: true,
    sources: [{ url: 'https://www.britannica.com/technology/computer', title: 'Computer', publisher: 'Britannica' }],
  })
  const slug = created.slug
  const encoded = encodeURIComponent(slug)

  const original = await request(`/api/topics/${encoded}?locale=ru`)
  assert.equal(original.response.status, 200)
  const proposal = await request(`/api/topics/${encoded}/proposals`, {
    method: 'POST',
    cookie: reader.cookie,
    body: {
      locale: 'ru',
      baseRevisionId: original.data.revision_id,
      proposedBody: readerBody,
      rationale: 'Добавить устройства ввода и вывода.',
      sources: [{ url: 'https://www.wikidata.org/wiki/Q68', title: 'computer', publisher: 'Wikidata' }],
    },
  })
  assert.equal(proposal.response.status, 201, JSON.stringify(proposal.data))
  const rejected = await request(`/api/topics/${encoded}/proposals`, {
    method: 'POST',
    cookie: reader.cookie,
    body: {
      locale: 'ru',
      baseRevisionId: original.data.revision_id,
      proposedBody: `${sourceBody}\n\nЭта правка не должна попасть на страницу.`,
      rationale: 'Проверка, что отклонённая правка не создаёт редакцию.',
    },
  })
  assert.equal(rejected.response.status, 201, JSON.stringify(rejected.data))
  const accepted = await request(`/api/topics/${encoded}/proposals/${proposal.data.proposal.id}`, {
    method: 'PATCH',
    cookie: owner.cookie,
    body: { action: 'accept', comment: 'Устройства ввода относятся к описанию компьютера.' },
  })
  assert.equal(accepted.response.status, 200, JSON.stringify(accepted.data))
  const declined = await request(`/api/topics/${encoded}/proposals/${rejected.data.proposal.id}`, {
    method: 'PATCH',
    cookie: owner.cookie,
    body: { action: 'reject', comment: 'Эта правка не меняет опубликованный текст.' },
  })
  assert.equal(declined.response.status, 200, JSON.stringify(declined.data))

  const russian = await request(`/api/topics/${encoded}/changes?locale=ru`)
  assert.equal(russian.response.status, 200, JSON.stringify(russian.data))
  assert.equal(russian.data.complete, true)
  const russianViews = restore(russian.data.items)
  assert.equal(russian.data.items.length, 2)
  assert.equal(russian.data.items[0].origin, 'publication')
  assert.equal(russian.data.items[0].introducedBy.username, agentName)
  assert.equal(russian.data.items[0].confirmedBy.username, agentName)
  assert.equal(russian.data.items[1].origin, 'accepted_edit')
  assert.equal(russian.data.items[1].introducedBy.username, reader.username)
  assert.equal(russian.data.items[1].confirmedBy.username, owner.username)
  assert.match(russianViews[1].view.body, /Устройства ввода и вывода/)
  assert.equal(revertPatch(russianViews[1].view.body, russian.data.items[1].bodyOps), russianViews[0].view.body)

  const history = await request(`/api/topics/${encoded}/revisions?locale=ru`)
  assert.equal(history.response.status, 200)
  assert.ok(history.data.items.every(item => item.change?.body && item.change.introducedAt && item.change.confirmedAt))

  const arabicPage = await request(`/api/topics/${encoded}?locale=ar`)
  assert.equal(arabicPage.response.status, 200, JSON.stringify(arabicPage.data))
  assert.equal(arabicPage.data.locale, 'ar')
  assert.equal(arabicPage.data.translation?.status, 'ready')
  const arabicProposal = await request(`/api/topics/${encoded}/proposals`, {
    method: 'POST',
    cookie: reader.cookie,
    body: {
      locale: 'ar',
      baseRevisionId: arabicPage.data.revision_id,
      proposedBody: `${arabicPage.data.body_markdown}\n\n${humanNote}`,
      rationale: 'Уточнение арабского термина для этой страницы.',
    },
  })
  assert.equal(arabicProposal.response.status, 201, JSON.stringify(arabicProposal.data))
  const arabicAccepted = await request(`/api/topics/${encoded}/proposals/${arabicProposal.data.proposal.id}`, {
    method: 'PATCH',
    cookie: owner.cookie,
    body: { action: 'accept', comment: 'Арабская правка остаётся в переводе этой страницы.' },
  })
  assert.equal(arabicAccepted.response.status, 200, JSON.stringify(arabicAccepted.data))

  const current = await request(`/api/topics/${encoded}?locale=ru`)
  const agentEdit = await mcp(enrollment.data.api_key, 2, 'aiki_propose_article_edit', {
    slug,
    locale: 'ru',
    baseRevisionId: current.data.revision_id,
    proposedBody: ownerBody,
    rationale: 'Добавить внешнюю память и метку для проверки перевода.',
  })
  const agentAccepted = await request(`/api/topics/${encoded}/proposals/${agentEdit.proposal.id}`, {
    method: 'PATCH',
    cookie: owner.cookie,
    body: { action: 'accept', comment: 'Внешняя память относится к описанию компьютера.' },
  })
  assert.equal(agentAccepted.response.status, 200, JSON.stringify(agentAccepted.data))
  const refreshed = await request(`/api/topics/${encoded}?locale=ar`)
  assert.equal(refreshed.data.translation?.humanAdjusted, true)
  assert.match(refreshed.data.body_markdown, new RegExp(marker))
  assert.match(refreshed.data.body_markdown, /تصحيح بشري/)

  const arabic = await request(`/api/topics/${encoded}/changes?locale=ar`)
  assert.equal(arabic.response.status, 200, JSON.stringify(arabic.data))
  const arabicViews = restore(arabic.data.items)
  assert.ok(arabic.data.items.length >= 3)
  assert.equal(arabic.data.items[0].origin, 'translation')
  assert.equal(arabic.data.items[0].introducedBy, null)
  assert.equal(arabic.data.items[0].introducedLabel, 'MyMemory')
  assert.equal(arabic.data.items[0].confirmedBy, null)
  const humanEdit = arabic.data.items.find(item => item.origin === 'accepted_edit')
  assert.equal(humanEdit.introducedBy.username, reader.username)
  assert.equal(humanEdit.confirmedBy.username, owner.username)
  const latest = arabicViews.at(-1)
  assert.match(latest.view.body, /تصحيح بشري/)
  assert.match(latest.view.body, new RegExp(marker))
  const beforeLatest = revertPatch(latest.view.body, latest.item.bodyOps)
  assert.match(beforeLatest, /تصحيح بشري/)
  assert.doesNotMatch(beforeLatest, new RegExp(marker))

  const finalRussian = await request(`/api/topics/${encoded}/changes?locale=ru`)
  const finalRussianViews = restore(finalRussian.data.items)
  assert.equal(finalRussian.data.items.at(-1).origin, 'accepted_edit')
  assert.equal(finalRussian.data.items.at(-1).introducedBy.username, agentName)
  assert.equal(finalRussian.data.items.at(-1).confirmedBy.username, owner.username)
  assert.match(finalRussianViews.at(-1).view.body, new RegExp(marker))

  const counts = await db.query(
    `SELECT
       (SELECT count(*)::int FROM revisions revision JOIN topics topic ON topic.id = revision.topic_id WHERE topic.slug = $1) AS revisions,
       (SELECT count(*)::int FROM revision_diffs diff JOIN revisions revision ON revision.id = diff.revision_id JOIN topics topic ON topic.id = revision.topic_id WHERE topic.slug = $1) AS diffs`,
    [slug],
  )
  assert.equal(counts.rows[0].revisions, counts.rows[0].diffs)
  assert.equal(counts.rows[0].revisions >= 5, true)
  const revisionId = finalRussian.data.items[0].id
  await assert.rejects(
    db.query('UPDATE revision_diffs SET introduced_label = $2 WHERE revision_id = $1', [revisionId, 'changed']),
    /immutable/,
  )

  console.log('PASS revision diffs', {
    slug,
    russian: finalRussian.data.items.map(item => item.origin),
    arabic: arabic.data.items.map(item => item.origin),
    marker: true,
    humanNote: true,
  })
} finally {
  await db.end()
}
