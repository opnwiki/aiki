import { defineConfig } from '@playwright/test'

const baseURL = process.env.AIKI_E2E_BASE_URL
if (!baseURL) throw new Error('Set AIKI_E2E_BASE_URL to an isolated loopback test server, for example http://127.0.0.1:3107')

const url = new URL(baseURL)
if (!['127.0.0.1', 'localhost', '::1'].includes(url.hostname) || !['http:', 'https:'].includes(url.protocol)) {
  throw new Error('Browser E2E is restricted to localhost/loopback hosts; do not run against aiki.wiki or another public host')
}

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: 'list',
  use: {
    baseURL: url.origin,
    browserName: 'chromium',
    headless: true,
    trace: 'retain-on-failure',
  },
})
