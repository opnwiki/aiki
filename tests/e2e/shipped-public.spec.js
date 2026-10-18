import { test, expect } from './fixtures.js'
import { applyLocaleAndTheme, expectNoHorizontalScroll, watchProductionHosts } from './support.js'

test.use({ permissions: ['clipboard-read', 'clipboard-write'] })

test.beforeEach(async ({ context }) => {
  await applyLocaleAndTheme(context, { locale: 'ru', theme: 'light' })
})

test('MCP setup defaults to aiki.wiki, accepts another node, and copies that endpoint', async ({ page }) => {
  const leaked = watchProductionHosts(page)
  await page.setViewportSize({ width: 1280, height: 900 })
  await page.goto('/connect')
  await expect(page.getByTestId('mcp-setup')).toBeVisible()
  await expect(page.getByRole('heading', { level: 1, name: 'Подключение агента' })).toBeVisible()
  await expect(page.getByTestId('mcp-instance')).toHaveValue('https://aiki.wiki')
  await expect(page.getByTestId('mcp-endpoint')).toHaveText('https://aiki.wiki/mcp')
  await expect(page.getByTestId('mcp-config')).toContainText('https://aiki.wiki/mcp')
  await expect(page.getByTestId('mcp-config')).toContainText('Bearer <agent-key>')

  await page.getByTestId('mcp-instance').fill('https://node.example')
  await expect(page.getByTestId('mcp-endpoint')).toHaveText('https://node.example/mcp')
  await expect(page.getByTestId('mcp-config')).toContainText('https://node.example/mcp')
  await page.getByTestId('mcp-copy').click()
  await expect(page.getByTestId('mcp-copy')).toHaveText('Настройка скопирована')
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toContain('https://node.example/mcp')

  await page.getByTestId('mcp-instance').fill('not a url')
  await expect(page.getByTestId('mcp-invalid')).toHaveText('Нужен адрес вида https://aiki.wiki.')
  await expect(page.getByTestId('mcp-endpoint')).toHaveCount(0)

  await page.getByTestId('mcp-instance').fill('')
  await expect(page.getByTestId('mcp-endpoint')).toHaveText('https://aiki.wiki/mcp')

  await applyLocaleAndTheme(page.context(), { locale: 'ru', theme: 'dark' })
  await page.goto('/connect')
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
  await expect(page.getByTestId('mcp-endpoint')).toHaveText('https://aiki.wiki/mcp')
  await expectNoHorizontalScroll(page)

  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/connect')
  await expect(page.getByTestId('mcp-endpoint')).toBeVisible()
  await expectNoHorizontalScroll(page)
  expect(leaked).toEqual([])
})

test('header, drawer, tasks, terms, and the home developer link match the shipped navigation', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 })
  await page.goto('/')
  const main = page.getByRole('navigation', { name: 'Main navigation' })
  await expect(main.getByRole('link', { name: 'Задания' })).toHaveAttribute('href', '/tasks')
  await expect(main.getByRole('link', { name: 'Админка' })).toHaveCount(0)
  const developer = page.getByRole('navigation', { name: 'Документация для разработчиков' })
  await expect(developer.getByRole('link', { name: 'Настройка MCP' })).toHaveAttribute('href', '/connect')

  await page.locator('footer summary').click()
  await expect(page.locator('footer').getByRole('link', { name: 'Настройка MCP' })).toHaveAttribute('href', '/connect')
  await expect(page.getByTestId('footer-terms')).toHaveAttribute('href', '/terms')

  await page.goto('/tasks')
  await expect(page.getByRole('heading', { level: 1, name: 'Задачи на написание' })).toBeVisible()

  await page.goto('/terms')
  await expect(page.getByTestId('terms-page')).toBeVisible()
  await expect(page.getByRole('heading', { level: 1, name: 'Условия этого узла' })).toBeVisible()
  await page.locator('a[href="#reuse"]').click()
  await expect(page.locator('#reuse')).toBeInViewport()

  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/')
  await expect(page.getByRole('combobox', { name: 'Язык' })).toBeHidden()
  await page.getByTestId('nav-menu').click()
  const drawer = page.getByTestId('nav-drawer')
  await expect(drawer.getByRole('link', { name: 'Задания' })).toHaveAttribute('href', '/tasks')
  await expect(drawer.getByRole('link', { name: 'Админка' })).toHaveCount(0)
  await expect(drawer.getByRole('button', { name: 'Русский' })).toBeVisible()
  await expectNoHorizontalScroll(page)

  await applyLocaleAndTheme(page.context(), { locale: 'ru', theme: 'dark' })
  await page.goto('/terms')
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
  await expect(page.getByTestId('terms-page')).toBeVisible()
  await expectNoHorizontalScroll(page)
})

test('a public page shows its number, a sharp short link, and copies the full address', async ({ page }) => {
  await applyLocaleAndTheme(page.context(), { locale: 'en', theme: 'light' })
  await page.setViewportSize({ width: 1280, height: 900 })
  await page.goto('/welcome-to-aiki')
  await expect(page.getByRole('heading', { level: 1, name: 'Welcome to AIKI' })).toBeVisible()
  await expect(page.getByTestId('page-number')).toContainText(/\d+/)
  const short = page.getByTestId('page-short-url')
  await expect(short).toHaveAttribute('href', /\/n\/\d+$/)
  await expect(short).not.toHaveClass(/truncate/)

  const canonical = page.getByTestId('page-canonical-url')
  await expect(canonical).toHaveClass(/truncate/)
  const full = await canonical.getAttribute('title')
  expect(full).toMatch(/\/welcome-to-aiki$/)
  await canonical.click()
  await expect(page.getByTestId('page-link-copied')).toHaveText('Link copied')
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(full)

  const asideHeadings = page.locator('aside h2')
  await expect(asideHeadings.first()).toHaveText('Contents')
  const headings = await asideHeadings.allTextContents()
  expect(headings.indexOf('Contents')).toBeLessThan(headings.indexOf('Page details'))

  await page.getByTestId('page-short-url').click()
  await expect(page).toHaveURL(/\/welcome-to-aiki$/)

  await page.setViewportSize({ width: 390, height: 844 })
  await expectNoHorizontalScroll(page)
  await applyLocaleAndTheme(page.context(), { locale: 'ru', theme: 'dark' })
  await page.goto('/welcome-to-aiki')
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
  await expect(page.getByTestId('page-short-url')).toBeVisible()
  await expectNoHorizontalScroll(page)
})

test('the node page and a seeded revision stay readable', async ({ page }) => {
  await applyLocaleAndTheme(page.context(), { locale: 'en', theme: 'light' })
  await page.goto('/node')
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
  await expect(page.getByTestId('node-version')).toHaveText('Version 1.2.11')
  await expectNoHorizontalScroll(page)

  await applyLocaleAndTheme(page.context(), { locale: 'ru', theme: 'dark' })
  await page.goto('/node')
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
  await expect(page.getByTestId('node-version')).toHaveText('Версия 1.2.11')
  await page.setViewportSize({ width: 390, height: 844 })
  await expect(page.getByTestId('node-version')).toBeVisible()
  await expectNoHorizontalScroll(page)

  await applyLocaleAndTheme(page.context(), { locale: 'en', theme: 'light' })
  await page.setViewportSize({ width: 1280, height: 900 })
  await page.goto('/welcome-to-aiki')
  const history = page.locator('section').filter({ has: page.getByRole('heading', { name: 'Revision history' }) })
  await expect(history).toBeVisible()
  await history.locator('a[href*="/revisions/"]').first().click()
  await expect(page).toHaveURL(/\/welcome-to-aiki\/revisions\/[0-9a-f-]+$/)
  await expect(page.getByRole('heading', { level: 1, name: 'Welcome to AIKI' })).toBeVisible()
})
