import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { translate } from '../../app/utils/i18n.js'
import { classifyPageClient, presentBotLabels, summarizePageVisitors } from '../../server/utils/page-visitors.js'
import { siteActivityIdentity } from '../../server/utils/site-activity.js'
import { getReadHmacSecret } from '../../server/utils/read-secret.js'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')

export async function run({ assert }) {
  assert.deepEqual(classifyPageClient('Mozilla/5.0 (compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm)'), { kind: 'bot', label: 'Bingbot' })
  assert.deepEqual(classifyPageClient('Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; GPTBot/1.2; +https://openai.com/gptbot)'), { kind: 'bot', label: 'GPTBot' })
  assert.deepEqual(classifyPageClient('curl/8.5.0'), { kind: 'bot', label: 'curl' })
  assert.deepEqual(classifyPageClient('Mozilla/5.0 (compatible; Meta-ExternalAgent/1.0)'), { kind: 'bot', label: 'Meta-ExternalAgent' })
  assert.deepEqual(classifyPageClient('Mozilla/5.0 (compatible; SemrushBot/7~bl; +http://www.semrush.com/bot.html)'), { kind: 'bot', label: 'SemrushBot' })
  assert.deepEqual(classifyPageClient('Mozilla/5.0 (compatible; Amazonbot/0.1)'), { kind: 'bot', label: 'Amazonbot' })
  assert.deepEqual(classifyPageClient('Mozilla/5.0 (compatible; ClaudeBot/1.0)'), { kind: 'bot', label: 'ClaudeBot' })
  assert.deepEqual(classifyPageClient('Mozilla/5.0 (compatible; MJ12bot/v1.4.8)'), { kind: 'bot', label: 'MJ12bot' })
  assert.deepEqual(classifyPageClient('Mozilla/5.0 (compatible; DotBot/1.2)'), { kind: 'bot', label: 'DotBot' })
  assert.deepEqual(classifyPageClient('Mozilla/5.0 (compatible; YandexBot/3.0)'), { kind: 'bot', label: 'YandexBot' })
  assert.deepEqual(classifyPageClient('panscient.com'), { kind: 'bot', label: 'panscient.com' })
  assert.deepEqual(classifyPageClient('Mozilla/5.0 (compatible; Google-Extended)'), { kind: 'bot', label: 'Google-Extended' })
  assert.deepEqual(classifyPageClient('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36'), { kind: 'human', label: 'human' })
  assert.deepEqual(classifyPageClient('SomeUnknownAgent/1.0'), { kind: 'bot', label: 'Other' })
  assert.deepEqual(classifyPageClient(''), { kind: 'bot', label: 'Other' })
  assert.deepEqual(siteActivityIdentity({ headers: { 'user-agent': 'Mozilla/5.0 Chrome/120.0.0.0' }, socketAddress: '' }), null)
  assert.deepEqual(siteActivityIdentity({ headers: { 'user-agent': 'Mozilla/5.0 Chrome/120.0.0.0', 'x-real-ip': '198.51.100.7' }, socketAddress: '127.0.0.1' }), { kind: 'human', identity: ['human', 'human', '198.51.100.7'].join('\u0000') })
  assert.deepEqual(siteActivityIdentity({ headers: { 'user-agent': 'GPTBot/1.0', 'x-real-ip': '198.51.100.8' }, socketAddress: '127.0.0.1' }), { kind: 'bot', identity: ['bot', 'GPTBot', '198.51.100.8'].join('\u0000') })
  assert.deepEqual(siteActivityIdentity({ actorId: 'agent-1' }), { kind: 'agent', identity: ['agent', 'agent-1'].join('\u0000') })
  assert.equal(getReadHmacSecret({ readHmacSecret: 'short', rateLimitSecret: 'a'.repeat(32) }), 'a'.repeat(32))
  assert.equal(getReadHmacSecret({ readHmacSecret: 'r'.repeat(32), rateLimitSecret: 'a'.repeat(32) }), 'r'.repeat(32))
  assert.equal(getReadHmacSecret({ readHmacSecret: 'short', rateLimitSecret: 'short' }), null)

  const shown = presentBotLabels([
    { label: 'Bingbot', hits: 43 },
    { label: 'curl', hits: 27 },
    { label: 'Other', hits: 4 },
    { label: 'RareBot', hits: 1 },
  ], 3)
  assert.deepEqual(shown, [
    { label: 'Bingbot', hits: 43 },
    { label: 'curl', hits: 27 },
    { label: 'Other', hits: 5 },
  ])

  const summary = summarizePageVisitors([
    { client_label: 'GPTBot', client_kind: 'bot', hits: 2, last_seen_at: '2026-08-07T01:12:00.000Z' },
    { client_label: 'human', client_kind: 'human', hits: 74, last_seen_at: '2026-10-02T18:09:00.000Z' },
  ])
  assert.equal(summary.botScans, 2)
  assert.equal(summary.humanViews, 74)
  assert.equal(summary.lastBotScanAt, '2026-08-07T01:12:00.000Z')
  assert.deepEqual(summary.bots, [{ label: 'GPTBot', hits: 2 }])

  const migration = await readFile(path.join(root, 'database/migrations/036_page_visitors.sql'), 'utf8')
  assert.match(migration, /CREATE TABLE page_view_clients/)
  assert.doesNotMatch(migration, /\b(?:inet|ip_address|user_agent|client_ip)\b/i)
  const activityMigration = await readFile(path.join(root, 'database/migrations/060_site_activity.sql'), 'utf8')
  assert.match(activityMigration, /CREATE TABLE IF NOT EXISTS site_activity/)
  assert.match(activityMigration, /visitor_kind TEXT NOT NULL CHECK \(visitor_kind IN \('human', 'agent', 'bot'\)\)/)
  assert.doesNotMatch(activityMigration, /ip_address|user_agent|client_ip/i)

  const page = await readFile(path.join(root, 'app/pages/[slug]/index.vue'), 'utf8')
  const visitorsAt = page.indexOf('data-testid="page-visitors"')
  const responsibilityAt = page.indexOf('data-testid="page-responsibility"')
  const machineEndpointsAt = page.indexOf('id="machine-endpoints"')
  const headerAt = page.indexOf('<header')
  assert.ok(visitorsAt > responsibilityAt && responsibilityAt > headerAt, 'visitor totals stay at the bottom of the article')
  assert.ok(machineEndpointsAt > visitorsAt, 'machine-readable endpoints stay under visitor totals')
  assert.equal(page.slice(headerAt, responsibilityAt).includes('page-visitors'), false)
  const visitorSection = page.slice(visitorsAt, page.indexOf('</section>', visitorsAt))
  assert.match(visitorSection, /topic\.unique_web_readers/)
  assert.doesNotMatch(visitorSection, /visitors\.humanViews/)
  assert.match(visitorSection, /<details v-if="machineEndpoints\.length" id="machine-endpoints"/)

  const uniqueReadersMigration = await readFile(path.join(root, 'database/migrations/043_topic_unique_viewers.sql'), 'utf8')
  assert.match(uniqueReadersMigration, /FROM topic_readers readers/)
  assert.match(uniqueReadersMigration, /readers\.reader_type = 'web'/)
  assert.doesNotMatch(uniqueReadersMigration, /page_view_clients|client_label|masked_address|inet|ip_address/i)

  assert.equal(translate('ru', 'topic.botScans'), 'сканирования ботов и агентов')
  assert.equal(translate('ru', 'topic.humanViews'), 'просмотры людьми')
  assert.equal(translate('en', 'topic.humanViews'), 'human views')
  assert.equal(translate('ru', 'topic.lastBotScan', { time: '2026-10-02 18:53 UTC' }), 'Последнее сканирование: 2026-10-02 18:53 UTC')
}
