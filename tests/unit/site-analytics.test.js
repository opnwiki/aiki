import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  analyticsPath,
  classifyBrowser,
  classifyDevice,
  classifyOperatingSystem,
  botLabelFromStatica,
  hiddenAnalyticsLabels,
  isProbePath,
  loadSiteAnalytics,
  lookupStaticaCountry,
  normalizeStaticaCountry,
  parseStaticaCountry,
  trustedCountryCode,
} from '../../server/utils/site-analytics.js'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')

export async function run({ assert }) {
  const chromeWindows = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36'
  const iphoneSafari = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Mobile/15E148 Safari/604.1'
  const androidTablet = 'Mozilla/5.0 (Linux; Android 13; Tablet) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36'

  assert.equal(classifyBrowser(chromeWindows), 'Chrome')
  assert.equal(classifyOperatingSystem(chromeWindows), 'Windows')
  assert.equal(classifyDevice(chromeWindows), 'desktop')
  assert.equal(classifyBrowser(iphoneSafari), 'Safari')
  assert.equal(classifyOperatingSystem(iphoneSafari), 'iOS')
  assert.equal(classifyDevice(iphoneSafari), 'mobile')
  assert.equal(classifyDevice(androidTablet), 'tablet')
  assert.equal(classifyBrowser('Mozilla/5.0 SamsungBrowser/25.0 Chrome/120.0 Safari/537.36'), 'Samsung Internet')
  assert.equal(classifyBrowser('Mozilla/5.0 OPR/105.0 Chrome/120.0 Safari/537.36'), 'Opera')

  assert.equal(trustedCountryCode({ 'cf-ipcountry': 'ru' }, '127.0.0.1'), 'RU')
  assert.equal(trustedCountryCode({ 'cf-ipcountry': 'RU' }, '198.51.100.8'), null)
  assert.equal(trustedCountryCode({ 'cf-ipcountry': 'XX' }, '::1'), null)
  assert.equal(normalizeStaticaCountry('ru'), 'RU')
  assert.equal(normalizeStaticaCountry('XX'), null)
  assert.equal(parseStaticaCountry({ country: 'ru' }), 'RU')
  assert.equal(parseStaticaCountry({ country: 'unknown' }), null)

  let staticaCalls = 0
  const staticaCountry = await lookupStaticaCountry('198.51.100.77', async (url, options) => {
    staticaCalls += 1
    assert.equal(url, 'https://statica.me/user/198.51.100.77?full')
    assert.equal(options.headers.accept, 'application/json')
    return {
      ok: true,
      headers: { get: () => null },
      body: null,
      text: async () => JSON.stringify({ country: 'ru' }),
    }
  })
  assert.equal(staticaCountry, 'RU')
  assert.equal(await lookupStaticaCountry('198.51.100.77', async () => { throw new Error('cache miss') }), 'RU')
  assert.equal(staticaCalls, 1)

  assert.equal(analyticsPath({ method: 'GET', path: '/20' }), '/20')
  assert.equal(analyticsPath({ method: 'HEAD', path: '/topics/20?locale=ru' }), '/topics/20')
  assert.equal(analyticsPath({ method: 'POST', path: '/20' }), null)
  assert.equal(analyticsPath({ method: 'GET', path: '/api/node' }), null)
  assert.equal(analyticsPath({ method: 'GET', path: '/icon-192.png' }), null)

  const migration = await readFile(path.join(root, 'database/migrations/067_site_analytics.sql'), 'utf8')
  assert.match(migration, /CREATE TABLE IF NOT EXISTS site_visit_analytics/)
  assert.match(migration, /ip_address INET/)
  assert.doesNotMatch(migration, /\buser_agent\b/i)

  const endpoint = await readFile(path.join(root, 'server/api/admin/analytics.get.js'), 'utf8')
  assert.match(endpoint, /requireNodeAdmin/)
  assert.match(endpoint, /private, no-store/)
  const adminPage = await readFile(path.join(root, 'app/pages/admin.vue'), 'utf8')
  assert.match(adminPage, /data-testid="admin-analytics"/)
  assert.match(adminPage, /data-testid="admin-analytics-toggle"/)
  assert.match(adminPage, /aria-controls="admin-analytics-content"/)
  assert.match(adminPage, /analyticsTopPages/)
  assert.match(adminPage, /analyticsRecent/)

  for (const path of ['/wp-login.php', '/blog/wp-login.php', '/xmlrpc.php', '/.env', '/.git/config', '/.aws/credentials', '/editor.php', '/docker-compose.yml', '/adminer/', '/_profiler/phpinfo']) {
    assert.equal(isProbePath(path), true, path)
  }
  for (const path of ['/', '/27', '/topics', '/login', '/agent', '/openapi-v1.yaml', '/wp-tips', '/branches/ai']) {
    assert.equal(isProbePath(path), false, path)
  }
  assert.equal(botLabelFromStatica({ is_cloud_provider: true }), 'Datacenter')
  assert.equal(botLabelFromStatica({ is_cloud_provider: true, is_vpn: true }), null, 'a person on a cloud VPN stays a person')
  assert.equal(botLabelFromStatica({ is_abuser: true, is_tor: true }), 'Threat')
  assert.equal(botLabelFromStatica({ is_clean: true }), null)
  assert.equal(botLabelFromStatica(null), null)

  assert.deepEqual(hiddenAnalyticsLabels({ threat: true, datacenter: false, scanner: true }), ['Threat', 'Scanner'])
  const analyticsQueries = []
  const analytics = await loadSiteAnalytics({
    query: async (sql, params) => {
      analyticsQueries.push({ sql, params })
      return { rows: [] }
    },
  }, 7, { hiddenLabels: ['Threat'] })
  assert.deepEqual(analytics.summary, { uniqueVisitors: 0, pageViews: 0, humanVisitors: 0, botVisitors: 0, lastSeenAt: null })
  assert.equal(analyticsQueries.length, 4)
  assert.ok(analyticsQueries.every(({ sql }) => sql.includes("coalesce(client_label, '') NOT IN ($2)")))
  assert.ok(analyticsQueries.every(({ params }) => params[0] === 7 && params[1] === 'Threat'))

  const analyticsEndpoint = await readFile(path.join(root, 'server/api/admin/analytics.get.js'), 'utf8')
  assert.match(analyticsEndpoint, /hiddenAnalyticsLabels/)
}
