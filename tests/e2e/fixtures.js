import { test as base, expect } from '@playwright/test'

export { expect }

export async function settle(page) {
  await page.waitForFunction(() => {
    const app = window.useNuxtApp?.()
    return Boolean(app) && app.isHydrating === false
  }, null, { timeout: 20000 })
}

export const test = base.extend({
  page: async ({ page }, use) => {
    const goto = page.goto.bind(page)
    page.goto = async (url, options) => {
      const response = await goto(url, options)
      await settle(page)
      return response
    }
    await use(page)
  },
})
