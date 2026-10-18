import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  accessCategoryForStatica,
  accessDeniedData,
  isAccessControlExempt,
  normalizeAccessIp,
  normalizeAccessReason,
  normalizeAccessSettings,
} from '../../server/utils/access-control.js'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')

export async function run({ assert }) {
  assert.equal(normalizeAccessIp(' 203.0.113.10 '), '203.0.113.10')
  assert.equal(normalizeAccessIp('::ffff:203.0.113.10'), '203.0.113.10')
  assert.equal(normalizeAccessIp('203.0.113.42/32'), '203.0.113.42')
  assert.equal(normalizeAccessIp('2001:db8::10/128'), '2001:db8::10')
  assert.equal(normalizeAccessIp('203.0.113.0/24'), null)
  assert.equal(normalizeAccessIp('not-an-ip'), null)
  assert.equal(normalizeAccessReason('  scanner\nprobe  '), 'scanner probe')
  assert.equal(normalizeAccessReason(''), null)
  assert.equal(normalizeAccessReason('x'.repeat(300)).length, 240)

  assert.deepEqual(normalizeAccessSettings({ threat: true, datacenter: false, scanner: true }).value, { threat: true, datacenter: false, scanner: true })
  assert.deepEqual(normalizeAccessSettings({}, { threat: true, scanner: true }).value, { threat: true, datacenter: false, scanner: true })
  assert.equal(normalizeAccessSettings({ threat: 'yes' }).ok, false)
  assert.deepEqual(accessCategoryForStatica({ threat: true, datacenter: true }, { is_threat: true, is_cloud_provider: true }), ['Threat', 'Datacenter'])
  assert.deepEqual(accessCategoryForStatica({ threat: true, datacenter: true }, { is_cloud_provider: true, is_vpn: true }), [])
  assert.equal(isAccessControlExempt({ path: '/access-denied' }), true)
  assert.equal(isAccessControlExempt({ path: '/api/access-denied' }), true)
  assert.equal(isAccessControlExempt({ path: '/topics' }), false)
  assert.deepEqual(accessDeniedData({ category: 'IP', categories: ['IP'], reason: 'test', profile: { country: 'RU', security: { is_threat: true } } }), {
    error: 'access_denied',
    category: 'IP',
    categories: ['IP'],
    reason: 'test',
    statica: { country: 'RU', security: { is_threat: true } },
  })

  const migration = await readFile(path.join(root, 'database/migrations/083_access_control.sql'), 'utf8')
  assert.match(migration, /block_threat BOOLEAN NOT NULL DEFAULT false/)
  assert.match(migration, /CREATE TABLE IF NOT EXISTS node_ip_access_blocks/)
  assert.match(migration, /ip INET NOT NULL/)
  assert.match(migration, /char_length\(reason\) <= 240/)

  const middleware = await readFile(path.join(root, 'server/middleware/access-control.js'), 'utf8')
  const accessControl = await readFile(path.join(root, 'server/utils/access-control.js'), 'utf8')
  assert.match(accessControl, /host\(blocks\.ip\) AS ip/)
  assert.match(middleware, /Access denied/)
  assert.match(middleware, /sendRedirect\(event, `\/access-denied\?from=/)
  const route = await readFile(path.join(root, 'server/routes/access-denied.get.js'), 'utf8')
  assert.match(route, /Statica/)
  const admin = await readFile(path.join(root, 'app/pages/admin.vue'), 'utf8')
  assert.match(admin, /data-testid="admin-access-control"/)
  assert.match(admin, /data-testid="access-block-threat"/)
  assert.match(admin, /data-testid="access-block-ip"/)
}
