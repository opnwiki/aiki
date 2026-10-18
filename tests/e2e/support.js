import { expect, settle, test } from './fixtures.js'

export { settle }
import { randomBytes } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'

export const ownerSessionPath = process.env.AIKI_E2E_OWNER_SESSION_PATH || '/tmp/aiki-e2e-owner.json'

export function origin() {
  return new URL(test.info().project.use.baseURL).origin
}

export async function applyLocaleAndTheme(context, { locale = 'en', theme = 'light' } = {}) {
  const url = origin()
  await context.addCookies([
    { name: 'aiki-locale', value: locale, url },
    { name: 'aiki-theme', value: theme, url },
  ])
}

export async function expectNoHorizontalScroll(page) {
  const box = await page.evaluate(() => ({
    scroll: document.documentElement.scrollWidth,
    client: document.documentElement.clientWidth,
  }))
  expect(box.scroll).toBeLessThanOrEqual(box.client + 1)
}

export function watchProductionHosts(page) {
  const leaked = []
  page.on('request', request => {
    const host = new URL(request.url()).hostname
    if (host === 'aiki.wiki' || host.endsWith('.aiki.wiki')) leaked.push(request.url())
  })
  return leaked
}

export async function rememberOwner(account) {
  await writeFile(ownerSessionPath, JSON.stringify({
    username: account.username,
    password: account.password,
  }))
}

export async function readOwner() {
  try {
    const parsed = JSON.parse(await readFile(ownerSessionPath, 'utf8'))
    if (parsed?.username && parsed?.password) return parsed
  } catch {
    // A missing file means this spec is running on its own.
  }
  return null
}

export async function login(page, account) {
  await page.goto('/login')
  await settle(page)
  await page.getByLabel(/Username or email|Имя пользователя или почта/).fill(account.username)
  await page.getByLabel(/Password|Пароль/).fill(account.password)
  const response = page.waitForResponse(result => result.url().endsWith('/api/auth/login') && result.request().method() === 'POST')
  await page.locator('form').getByRole('button', { name: /^(Sign in|Войти)$/ }).click()
  return response
}

async function roleOf(page) {
  return page.evaluate(async () => (await (await fetch('/api/auth/me')).json()).actor?.role || null)
}

export async function ensureOwner(page) {
  await applyLocaleAndTheme(page.context(), { locale: 'ru', theme: 'light' })
  const saved = await readOwner()
  if (saved) {
    const response = await login(page, saved)
    if (response.status() === 200) {
      const role = await roleOf(page)
      if (role === 'owner' || role === 'admin') return { ...saved, role }
    }
  }

  const username = `e2e-owner-${randomBytes(4).toString('hex')}`
  const password = `AIKI-e2e-${randomBytes(18).toString('base64url')}`
  await page.goto('/login')
  await settle(page)
  const create = page.getByTestId('auth-create')
  if (await create.count() === 0) return null
  await create.click()
  await page.getByLabel(/Username|Имя пользователя/).fill(username)
  await page.getByLabel(/email|почта/i).fill(`${username}@example.org`)
  await page.getByLabel(/Password|Пароль/).fill(password)
  const registration = page.waitForResponse(result => result.url().endsWith('/api/auth/register') && result.request().method() === 'POST')
  await page.locator('form').getByRole('button', { name: /^(Create account|Создать аккаунт)$/ }).click()
  const response = await registration
  if (response.status() !== 201) return null
  const role = await roleOf(page)
  const account = { username, password, role }
  if (role === 'owner' || role === 'admin') await rememberOwner(account)
  return account
}

export async function saveNodeSettings(page) {
  const saved = page.waitForResponse(result => result.url().endsWith('/api/admin/settings') && result.request().method() === 'PATCH')
  await page.locator('form').filter({ has: page.getByTestId('registration-open-toggle') }).getByRole('button', { name: /^(Save|Сохранить)$/ }).click()
  const response = await saved
  expect(response.status(), await response.text()).toBe(200)
  await expect(page.getByTestId('admin-saved')).toBeVisible()
}
