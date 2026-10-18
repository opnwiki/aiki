const BOT_PATTERNS = [
  ['Google-Extended', /Google-Extended/i],
  ['Googlebot', /Googlebot|Storebot-Google|AdsBot-Google|Mediapartners-Google|Google-InspectionTool|GoogleOther/i],
  ['Bingbot', /bingbot/i],
  ['GPTBot', /GPTBot/i],
  ['ChatGPT-User', /ChatGPT-User/i],
  ['OAI-SearchBot', /OAI-SearchBot/i],
  ['ClaudeBot', /ClaudeBot|Claude-SearchBot|anthropic-ai/i],
  ['Claude-User', /Claude-User/i],
  ['PerplexityBot', /PerplexityBot/i],
  ['Perplexity-User', /Perplexity-User/i],
  ['Meta-ExternalAgent', /meta-externalagent/i],
  ['FacebookBot', /facebookexternalhit|Facebot/i],
  ['Amazonbot', /Amazonbot/i],
  ['Applebot', /Applebot/i],
  ['YandexBot', /YandexBot|YandexRenderResourcesBot|YandexImages/i],
  ['Baiduspider', /Baiduspider/i],
  ['DuckDuckBot', /DuckDuckBot/i],
  ['Bytespider', /Bytespider/i],
  ['CCBot', /CCBot/i],
  ['SemrushBot', /SemrushBot/i],
  ['AhrefsBot', /AhrefsBot/i],
  ['MJ12bot', /MJ12bot/i],
  ['DotBot', /DotBot/i],
  ['PetalBot', /PetalBot/i],
  ['panscient.com', /panscient\.com/i],
  ['curl', /\bcurl\//i],
  ['wget', /\bwget\//i],
  ['python-requests', /python-requests/i],
  ['Go-http-client', /Go-http-client/i],
  ['Scrapy', /Scrapy/i],
  ['libwww-perl', /libwww-perl/i],
  ['HeadlessChrome', /HeadlessChrome/i],
]

const GENERIC_BOT = /bot|crawler|spider|slurp|archiver|fetcher|scraper/i
const BROWSER = /Mozilla\/5\.0|AppleWebKit\/|Chrome\/|Firefox\/|Safari\/|Edg\//i

export function classifyPageClient(userAgent) {
  const agent = String(userAgent || '').slice(0, 512)
  for (const [label, pattern] of BOT_PATTERNS) {
    if (pattern.test(agent)) return { kind: 'bot', label }
  }
  if (BROWSER.test(agent)) return { kind: 'human', label: 'human' }
  return { kind: 'bot', label: 'Other' }
}

export function presentBotLabels(bots, limit = 16) {
  const sorted = [...bots].sort((left, right) => right.hits - left.hits || left.label.localeCompare(right.label))
  const named = sorted.filter(bot => bot.label !== 'Other')
  const otherHits = sorted.filter(bot => bot.label === 'Other').reduce((sum, bot) => sum + bot.hits, 0)
  const visibleNamed = named.slice(0, Math.max(0, limit - 1))
  const folded = named.slice(visibleNamed.length).reduce((sum, bot) => sum + bot.hits, 0) + otherHits
  const labels = visibleNamed.map(bot => ({ label: bot.label, hits: bot.hits }))
  if (folded > 0) labels.push({ label: 'Other', hits: folded })
  return labels.sort((left, right) => right.hits - left.hits || left.label.localeCompare(right.label))
}

export function summarizePageVisitors(rows, limit = 16) {
  const bots = []
  let humanViews = 0
  let lastBotScanAt = null
  for (const row of rows) {
    const hits = Number(row.hits) || 0
    if (row.client_kind === 'human') {
      humanViews += hits
      continue
    }
    bots.push({ label: row.client_label, hits })
    const seen = row.last_seen_at ? new Date(row.last_seen_at) : null
    if (seen && !Number.isNaN(seen.getTime()) && (!lastBotScanAt || seen > lastBotScanAt)) lastBotScanAt = seen
  }
  const shown = presentBotLabels(bots, limit)
  return {
    botScans: bots.reduce((sum, bot) => sum + bot.hits, 0),
    humanViews,
    lastBotScanAt: lastBotScanAt ? lastBotScanAt.toISOString() : null,
    bots: shown,
  }
}

export async function recordPageView(db, topicId, userAgent) {
  const classified = classifyPageClient(userAgent)
  await db.query(
    `INSERT INTO page_view_clients (topic_id, client_label, client_kind, hits, last_seen_at)
     VALUES ($1, $2, $3, 1, now())
     ON CONFLICT (topic_id, client_label) DO UPDATE SET
       hits = page_view_clients.hits + 1,
       last_seen_at = now(),
       client_kind = EXCLUDED.client_kind`,
    [topicId, classified.label, classified.kind],
  )
  return classified
}

export async function loadPageVisitors(db, topicId) {
  const result = await db.query(
    `SELECT client_label, client_kind, hits, last_seen_at
       FROM page_view_clients
      WHERE topic_id = $1`,
    [topicId],
  )
  return summarizePageVisitors(result.rows)
}
