import { randomUUID } from 'node:crypto'
import { getNeronTask, startNeronTask } from './article-orders.js'

const PROVIDERS = {
  openrouter: 'https://openrouter.ai/api/v1',
  openai: 'https://api.openai.com/v1',
  neron: 'https://neron.one/api/neron/v1',
}
const NERON_POLL_INTERVAL_MS = 300
const NERON_MODERATION_TIMEOUT_MS = 20_000

export function normalizeModerationMode(value) {
  if (value === 'community' || value === 'manual') return { ok: true, value }
  return { ok: false, message: 'Moderation mode must be community or manual.' }
}

export async function loadModerationMode(client) {
  const result = await client.query(`SELECT moderation_mode FROM nodes WHERE is_home LIMIT 1`)
  return result.rows[0]?.moderation_mode === 'manual' ? 'manual' : 'community'
}

export async function openingTopicStatus(client, fallback) {
  const mode = await loadModerationMode(client)
  return mode === 'manual' ? 'pending' : fallback
}

export function presentAssistantConfig(stored) {
  if (!stored || stored.enabled !== true) return { enabled: false, keySet: false }
  return {
    enabled: true,
    provider: stored.provider,
    model: stored.model,
    baseUrl: stored.baseUrl,
    onFail: stored.onFail,
    trigger: stored.trigger,
    viewThreshold: stored.viewThreshold,
    keySet: Boolean(stored.apiKey),
  }
}

export function normalizeAssistantConfig(input, previous) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return { ok: false, message: 'The model check needs a provider, a model, and a key.' }
  }
  if (input.enabled !== true) return { ok: true, value: null }
  if (!Object.hasOwn(PROVIDERS, input.provider)) {
    return { ok: false, message: 'Choose OpenRouter, OpenAI, or Neron.one.' }
  }
  const model = cleanLine(input.model, 120)
  if (model.length < 2) return { ok: false, message: 'Name the model in 2–120 characters.' }
  if (input.onFail !== 'hidden' && input.onFail !== 'unlisted') {
    return { ok: false, message: 'Choose link-only or author-only when the model holds the page.' }
  }
  if (input.trigger !== 'publish' && input.trigger !== 'views') {
    return { ok: false, message: 'Choose when the model checks the page.' }
  }
  const viewThreshold = Number(input.viewThreshold)
  if (input.trigger === 'views' && (!Number.isInteger(viewThreshold) || viewThreshold < 1 || viewThreshold > 1_000_000)) {
    return { ok: false, message: 'The read threshold is a whole number from 1 to 1000000.' }
  }
  const requested = typeof input.baseUrl === 'string' ? input.baseUrl.trim() : ''
  const baseUrl = (requested || PROVIDERS[input.provider]).replace(/\/$/, '')
  if (!endpointAllowed(baseUrl)) {
    return { ok: false, message: 'The model address must be public HTTPS, or loopback for a local check.' }
  }
  let apiKey = typeof input.apiKey === 'string' ? input.apiKey.trim() : ''
  if (!apiKey) apiKey = typeof previous?.apiKey === 'string' ? previous.apiKey : ''
  if (apiKey.length < 8 || apiKey.length > 400 || /[\u0000-\u001f]/.test(apiKey)) {
    return { ok: false, message: 'The API key needs 8–400 characters.' }
  }
  return {
    ok: true,
    value: {
      enabled: true,
      provider: input.provider,
      model,
      baseUrl,
      onFail: input.onFail,
      trigger: input.trigger,
      viewThreshold: input.trigger === 'views' ? viewThreshold : null,
      apiKey,
    },
  }
}

export function assistantEndpoint(config) {
  const base = String(config?.baseUrl || '').replace(/\/$/, '')
  if (!endpointAllowed(base)) return { ok: false, message: 'The model address is not allowed.' }
  if (config.provider === 'neron') return { ok: true, url: `${base}/tasks` }
  return { ok: true, url: `${base}/chat/completions` }
}

export function endpointAllowed(value) {
  let url
  try { url = new URL(value) } catch { return false }
  if (url.username || url.password || url.search || url.hash) return false
  const host = url.hostname.replace(/^\[|\]$/g, '')
  if (host === 'localhost' || host === '127.0.0.1' || host === '::1') {
    return url.protocol === 'http:' || url.protocol === 'https:'
  }
  if (url.protocol !== 'https:') return false
  return !privateHost(host)
}

export function parseAssistantVerdict(content) {
  if (content && typeof content === 'object' && !Array.isArray(content)) {
    if (typeof content.ok === 'boolean') return { ok: content.ok, reason: cleanLine(content.reason, 500) }
    const nested = content.reply ?? content.output ?? content.text ?? content.content
    return nested === undefined ? null : parseAssistantVerdict(nested)
  }
  const text = typeof content === 'string' ? content.trim() : ''
  if (!text) return null
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start < 0 || end <= start) return null
  let parsed
  try { parsed = JSON.parse(text.slice(start, end + 1)) } catch { return null }
  if (!parsed || typeof parsed.ok !== 'boolean') return null
  const reason = cleanLine(parsed.reason, 500)
  return { ok: parsed.ok, reason }
}

export function viewCheckDue({ reads, threshold, statuses }) {
  const count = Number(reads)
  const limit = Number(threshold)
  if (!Number.isFinite(count) || !Number.isFinite(limit) || count < limit) return false
  const done = Array.isArray(statuses) ? statuses : []
  return !done.some(status => status === 'pending' || status === 'clear' || status === 'held')
}

export async function requestAssistantVerdict(config, article, fetchImpl = globalThis.fetch) {
  if (config.provider === 'neron') return requestNeronVerdict(config, article, fetchImpl)
  const endpoint = assistantEndpoint(config)
  if (!endpoint.ok) return { status: 'failed', reason: endpoint.message }
  const title = cleanLine(article?.title, 180)
  const body = String(article?.body || '').slice(0, 12_000)
  let response
  try {
    response = await fetchImpl(endpoint.url, {
      method: 'POST',
      redirect: 'error',
      headers: {
        authorization: `Bearer ${config.apiKey}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: config.model,
        temperature: 0,
        messages: [{ role: 'user', content: moderationPrompt(title, body) }],
      }),
      signal: AbortSignal.timeout(8000),
    })
  } catch {
    return { status: 'failed', reason: 'The model did not answer.' }
  }
  if (!response.ok) return { status: 'failed', reason: 'The model did not answer.' }
  let payload
  try { payload = await response.json() } catch { return { status: 'failed', reason: 'The model did not answer.' } }
  const verdict = parseAssistantVerdict(payload?.choices?.[0]?.message?.content)
  if (!verdict) return { status: 'failed', reason: 'The model reply was not a verdict.' }
  if (verdict.ok) return { status: 'clear', reason: '' }
  return { status: 'held', reason: verdict.reason || 'The model held this page.' }
}

async function requestNeronVerdict(config, article, fetchImpl) {
  const endpoint = assistantEndpoint(config)
  if (!endpoint.ok) return { status: 'failed', reason: endpoint.message }
  const title = cleanLine(article?.title, 180)
  const body = String(article?.body || '').slice(0, 12_000)
  let task
  try {
    task = await startNeronTask({
      prompt: moderationPrompt(title, body),
      requestId: randomUUID(),
      model: config.model,
      apiBase: config.baseUrl,
      apiKey: config.apiKey,
      fetchImpl,
    })
    const deadline = Date.now() + NERON_MODERATION_TIMEOUT_MS
    while (['queued', 'running', 'resuming'].includes(task.status) && Date.now() < deadline) {
      await new Promise(resolve => setTimeout(resolve, NERON_POLL_INTERVAL_MS))
      task = await getNeronTask({ taskId: task.id, apiBase: config.baseUrl, apiKey: config.apiKey, fetchImpl })
    }
  } catch {
    return { status: 'failed', reason: 'The model did not answer.' }
  }
  if (task.status !== 'completed') return { status: 'failed', reason: 'The model did not answer in time.' }
  const verdict = parseAssistantVerdict(task.result)
  if (!verdict) return { status: 'failed', reason: 'The model reply was not a verdict.' }
  if (verdict.ok) return { status: 'clear', reason: '' }
  return { status: 'held', reason: verdict.reason || 'The model held this page.' }
}

function moderationPrompt(title, body) {
  return `You check one knowledge page. Reply with JSON only: {"ok":true} or {"ok":false,"reason":"short reason"}. ok is false when the page contains a secret, personal data, or a clear break of the page rules. ok is true when the page can stay as it is.\n\nTitle: ${title}\n\n${body}`
}

export async function executeAssistantCheck(db, { topicId, trigger, config, article, reads, once, fetchImpl }) {
  const client = await db.connect()
  let checkId = null
  try {
    await client.query('BEGIN')
    const guard = once
      ? `AND NOT EXISTS (
           SELECT 1 FROM moderation_checks
            WHERE topic_id = $1::uuid AND status IN ('pending', 'clear', 'held')
         )`
      : `AND NOT EXISTS (
           SELECT 1 FROM moderation_checks
            WHERE topic_id = $1::uuid AND status = 'pending'
         )`
    const inserted = await client.query(
      `INSERT INTO moderation_checks (topic_id, trigger, status, provider, model, reads_at_check)
       SELECT $1::uuid, $2, 'pending', $3, $4, $5
        WHERE true ${guard}
       RETURNING id`,
      [topicId, trigger, config.provider, config.model, reads ?? null],
    )
    checkId = inserted.rows[0]?.id || null
    await client.query('COMMIT')
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
  if (!checkId) return null
  const verdict = await requestAssistantVerdict(config, article, fetchImpl)
  const finisher = await db.connect()
  try {
    await finisher.query('BEGIN')
    await finisher.query(
      `UPDATE moderation_checks
          SET status = $2, reason = NULLIF($3::text, ''), finished_at = now()
        WHERE id = $1`,
      [checkId, verdict.status, verdict.reason || ''],
    )
    if (verdict.status === 'held') {
      const next = config.onFail === 'hidden' ? 'hidden' : 'unlisted'
      await finisher.query(
        `UPDATE topics
            SET status = $2, updated_at = now()
          WHERE id = $1 AND status IN ('published', 'unlisted')`,
        [topicId, next],
      )
    }
    await finisher.query('COMMIT')
  } catch (error) {
    await finisher.query('ROLLBACK')
    throw error
  } finally {
    finisher.release()
  }
  return { id: checkId, status: verdict.status, reason: verdict.reason || '' }
}

export function pageModelCheckApplies(nodeConfig, page) {
  if (!nodeConfig?.enabled) return false
  if (!page || page.assistant_check === false || page.assistantCheck === false) return false
  return page.status === 'published' || page.status === 'unlisted'
}

export async function loadNodeAssistantConfig(db) {
  const result = await db.query(`SELECT assistant_moderation FROM nodes WHERE is_home LIMIT 1`)
  const stored = result.rows[0]?.assistant_moderation
  return stored?.enabled === true ? stored : null
}

export async function checkPageContent(db, { topicId, trigger, article, fetchImpl }) {
  const config = await loadNodeAssistantConfig(db)
  if (!config) return null
  const selected = await db.query(
    `SELECT assistant_check, status FROM topics WHERE id = $1`,
    [topicId],
  )
  const page = selected.rows[0]
  if (!pageModelCheckApplies(config, page)) return null
  return executeAssistantCheck(db, {
    topicId,
    trigger,
    config,
    article,
    reads: null,
    once: false,
    fetchImpl,
  })
}

export async function maybeCheckAssistantOnView() {
  return null
}

export async function reviewerCanDecide(client, actor, topic) {
  if (!actor || !topic || actor.id === topic.author_id) return false
  if (['owner', 'admin', 'moderator'].includes(actor.role)) return true
  if (!topic.branch_id) return false
  const duty = await client.query(
    `SELECT role FROM branch_roles
      WHERE branch_id = $1 AND actor_id = $2 AND role IN ('leader', 'moderator')
      LIMIT 1`,
    [topic.branch_id, actor.id],
  )
  return Boolean(duty.rows[0])
}

function cleanLine(value, max) {
  return String(value || '').replace(/[\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max)
}

function privateHost(host) {
  if (host.endsWith('.local') || host === 'metadata.google.internal') return true
  const match = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/)
  if (!match) return false
  const parts = match.slice(1).map(Number)
  if (parts.some(part => part > 255)) return true
  const [first, second] = parts
  if (first === 0 || first === 10 || first === 127) return true
  if (first === 169 && second === 254) return true
  if (first === 172 && second >= 16 && second <= 31) return true
  if (first === 192 && second === 168) return true
  if (first === 100 && second >= 64 && second <= 127) return true
  return false
}
