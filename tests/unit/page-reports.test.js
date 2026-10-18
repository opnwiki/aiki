import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { translate } from '../../app/utils/i18n.js'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')

export async function run({ assert }) {
  const migration = await readFile(path.join(root, 'database/migrations/035_page_reports.sql'), 'utf8')
  assert.match(migration, /CREATE TABLE page_reports/)
  assert.match(migration, /reason TEXT NOT NULL CHECK \(reason IN \('inaccurate', 'illegal', 'rights', 'other'\)\)/)
  assert.doesNotMatch(migration, /\b(?:inet|ip_address|client_ip)\b/i)
  assert.doesNotMatch(migration, /LLMpedia/i)

  const page = await readFile(path.join(root, 'app/pages/[slug]/index.vue'), 'utf8')
  assert.match(page, /data-testid="page-responsibility"/)
  assert.match(page, /topic\.pageResponsibility/)
  assert.match(page, /topic\.lastUpdatedUtc/)
  assert.match(page, /<time[^>]*:datetime="updatedAtIso"/)
  assert.match(page, /topic\.reportPage/)
  assert.match(page, /\/reports/)

  const createReport = await readFile(path.join(root, 'server/api/topics/[slug]/reports.post.js'), 'utf8')
  assert.match(createReport, /enforceSameOrigin/)
  assert.match(createReport, /enforceRateLimit\(event, \{ action: 'page-report', limit: 5 \}\)/)
  assert.match(createReport, /getHumanActor/)
  assert.doesNotMatch(createReport, /requireHumanActor/)
  assert.doesNotMatch(createReport, /getTrustedClientIp|client_ip|remoteAddress/)

  const listReports = await readFile(path.join(root, 'server/api/page-reports.get.js'), 'utf8')
  assert.match(listReports, /requirePageReportReviewer/)
  assert.doesNotMatch(listReports, /reporter\.email|client_ip/)

  const noteReport = await readFile(path.join(root, 'server/api/page-reports/[id].patch.js'), 'utf8')
  assert.match(noteReport, /status !== 'noted'/)
  assert.match(noteReport, /page_report_noted/)

  assert.match(translate('en', 'topic.pageResponsibility'), /page author/)
  assert.doesNotMatch(translate('en', 'topic.pageResponsibility'), /LLMpedia/)
  assert.equal(translate('en', 'topic.reportPage'), 'Report this page')
  assert.equal(translate('ru', 'topic.reportPage'), 'Пожаловаться на страницу')
  assert.match(translate('ru', 'topic.pageResponsibility'), /автор страницы/)
  assert.match(translate('ru', 'topic.pageResponsibility'), /узла AIKI/)
  assert.doesNotMatch(translate('ru', 'topic.pageResponsibility'), /LLMpedia/)
  assert.equal(translate('ru', 'topic.lastUpdatedUtc', { time: '2026-08-07 01:12 UTC' }), 'Последнее обновление: 2026-08-07 01:12 UTC')
}
