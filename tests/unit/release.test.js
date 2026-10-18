import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { translate } from '../../app/utils/i18n.js'
import { publicNodeProfile } from '../../server/utils/node-profile.js'
import {
  PRODUCT_VERSION,
  assessHubRelease,
  compareVersions,
  isNewerVersion,
  shouldAskHubForRelease,
} from '../../server/utils/release.js'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')

function response(status, body, { redirect = false } = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async text() {
      return typeof body === 'string' ? body : JSON.stringify(body)
    },
    redirected: redirect,
  }
}

export async function run({ assert }) {
  assert.equal(PRODUCT_VERSION, '1.2.11')
  assert.equal(compareVersions('1.2.11', '1.2.10'), 1)
  assert.equal(compareVersions('1.2.11', '1.2.2'), 1)
  assert.equal(compareVersions('1.2.11', '1.2.11'), 0)
  assert.equal(compareVersions('1.2.10', '1.2.11'), -1)
  assert.equal(compareVersions('1.10.0', '1.9.0'), 1)
  assert.equal(isNewerVersion('1.3.0', '1.2.11'), true)
  assert.equal(isNewerVersion('1.2.11', '1.2.11'), false)
  assert.equal(isNewerVersion('nope', '1.2.11'), false)
  assert.equal(compareVersions('1.2.11-beta', '1.2.11'), null)

  const pkg = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'))
  const lock = JSON.parse(await readFile(path.join(root, 'package-lock.json'), 'utf8'))
  assert.equal(pkg.version, PRODUCT_VERSION)
  assert.equal(lock.version, PRODUCT_VERSION)
  assert.equal(lock.packages[''].version, PRODUCT_VERSION)
  const openapi = await readFile(path.join(root, 'server/routes/openapi-v1.yaml.get.js'), 'utf8')
  const mcp = await readFile(path.join(root, 'server/routes/mcp.post.js'), 'utf8')
  assert.match(openapi, /version: 1\.2\.11/)
  assert.match(mcp, /PRODUCT_VERSION/)
  assert.equal(publicNodeProfile({ domain: 'aiki.wiki', countsPublic: true, pages: 1, users: 1 }).version, '1.2.11')

  const nodePage = await readFile(path.join(root, 'app/pages/node.vue'), 'utf8')
  const adminPage = await readFile(path.join(root, 'app/pages/admin.vue'), 'utf8')
  assert.match(nodePage, /data-testid="node-version"/)
  assert.match(adminPage, /data-testid="admin-update"/)
  assert.equal(translate('ru', 'node.version', { version: '1.2.11' }), 'Версия 1.2.11')
  assert.match(translate('ru', 'admin.updateAvailable', { latest: '1.3.0', current: '1.2.11' }), /1\.3\.0/)
  assert.match(translate('en', 'admin.updateAvailable', { latest: '1.3.0', current: '1.2.11' }), /1\.3\.0/)

  assert.equal(shouldAskHubForRelease({
    siteUrl: 'http://127.0.0.1:3000',
    hubUrl: 'https://aiki.wiki',
  }), false)
  assert.equal(shouldAskHubForRelease({
    siteUrl: 'http://localhost:3000',
    hubUrl: 'https://aiki.wiki',
  }), false)
  assert.equal(shouldAskHubForRelease({
    siteUrl: 'https://aiki.wiki',
    hubUrl: 'https://aiki.wiki',
  }), false)
  assert.equal(shouldAskHubForRelease({
    siteUrl: 'https://node.example',
    hubUrl: 'https://aiki.wiki',
  }), true)
  assert.equal(shouldAskHubForRelease({
    siteUrl: 'http://127.0.0.1:3038',
    hubUrl: 'http://127.0.0.1:4100',
    allowLoopback: true,
  }), true)

  let calls = 0
  const skipped = await assessHubRelease({
    siteUrl: 'http://127.0.0.1:3038',
    hubUrl: 'https://aiki.wiki',
    fetchImpl: async () => {
      calls += 1
      return response(200, { node: { version: '9.0.0' } })
    },
  })
  assert.equal(calls, 0)
  assert.equal(skipped.updateAvailable, false)
  assert.equal(skipped.version, '1.2.11')

  const newer = await assessHubRelease({
    siteUrl: 'http://127.0.0.1:3038',
    hubUrl: 'http://127.0.0.1:4100',
    allowLoopback: true,
    fetchImpl: async (url, options) => {
      assert.equal(url, 'http://127.0.0.1:4100/api/node')
      assert.equal(options.redirect, 'manual')
      return response(200, { node: { version: '1.3.0' } })
    },
  })
  assert.equal(newer.updateAvailable, true)
  assert.equal(newer.hubVersion, '1.3.0')

  const same = await assessHubRelease({
    siteUrl: 'https://node.example',
    hubUrl: 'https://aiki.wiki',
    fetchImpl: async () => response(200, { node: { version: '1.2.11' } }),
  })
  assert.equal(same.updateAvailable, false)
  assert.equal(same.hubVersion, '1.2.11')

  const older = await assessHubRelease({
    siteUrl: 'https://node.example',
    hubUrl: 'https://aiki.wiki',
    fetchImpl: async () => response(200, { node: { version: '1.1.9' } }),
  })
  assert.equal(older.updateAvailable, false)

  const down = await assessHubRelease({
    siteUrl: 'https://node.example',
    hubUrl: 'https://aiki.wiki',
    fetchImpl: async () => { throw new Error('offline') },
  })
  assert.equal(down.updateAvailable, false)
  assert.equal(down.hubVersion, null)

  const redirected = await assessHubRelease({
    siteUrl: 'https://node.example',
    hubUrl: 'https://aiki.wiki',
    fetchImpl: async () => response(302, ''),
  })
  assert.equal(redirected.updateAvailable, false)

  const garbage = await assessHubRelease({
    siteUrl: 'https://node.example',
    hubUrl: 'https://aiki.wiki',
    fetchImpl: async () => response(200, { node: { version: 'latest' } }),
  })
  assert.equal(garbage.updateAvailable, false)
}
