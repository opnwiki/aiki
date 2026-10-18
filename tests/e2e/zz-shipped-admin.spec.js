import { test, expect } from './fixtures.js'
import { randomBytes } from 'node:crypto'
import {
  applyLocaleAndTheme,
  ensureOwner,
  expectNoHorizontalScroll,
  login,
  saveNodeSettings,
  settle,
  watchProductionHosts,
} from './support.js'

test.describe.configure({ mode: 'serial' })
test.use({ permissions: ['clipboard-read', 'clipboard-write'] })

let owner = null

test.beforeAll(async ({ browser }) => {
  test.setTimeout(60_000)
  const context = await browser.newContext(test.info().project.use)
  const page = await context.newPage()
  owner = await ensureOwner(page)
  await context.close()
})

test.beforeEach(async ({ context }) => {
  await applyLocaleAndTheme(context, { locale: 'ru', theme: 'light' })
})

function ownerOnly() {
  test.skip(!owner || (owner.role !== 'owner' && owner.role !== 'admin'), 'Нужен владелец или администратор узла')
}

test('the admin node map is visible and does not call aiki.wiki', async ({ page }) => {
  ownerOnly()
  const leaked = watchProductionHosts(page)
  await login(page, owner)
  await page.setViewportSize({ width: 1280, height: 900 })
  await page.goto('/admin')
  const panel = page.getByTestId('mesh-panel')
  await expect(panel).toBeVisible()
  await expect(page.getByTestId('mesh-role')).toContainText(/центральный инстанс|дополнительный/)
  await expect(page.getByTestId('mesh-total')).toContainText(/\d+/)
  await expect(page.getByTestId('mesh-map')).toBeVisible()
  await expect(page.getByTestId('mesh-node').first()).toBeVisible()
  await expect(page.getByTestId('mesh-hub-url')).toHaveValue(/^https?:\/\//)
  await expect(page.getByTestId('mesh-sync')).toBeVisible()
  await expect(page.getByTestId('admin-update')).toHaveCount(0)
  expect(leaked, 'карта узлов только читает этот процесс').toEqual([])

  await page.getByTestId('mesh-total').evaluate(element => {
    const section = element.closest('section')
    const top = section.getBoundingClientRect().top + window.scrollY - 88
    window.scrollTo(0, Math.max(0, top))
  })
  await applyLocaleAndTheme(page.context(), { locale: 'ru', theme: 'dark' })
  await page.reload()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
  await expect(page.getByTestId('mesh-map')).toBeVisible()
  await expectNoHorizontalScroll(page)

  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/admin')
  await expect(page.getByTestId('mesh-panel')).toBeVisible()
  await expectNoHorizontalScroll(page)
  expect(leaked).toEqual([])
})

test('an owner can set an accent color and return to the calm default', async ({ page }) => {
  ownerOnly()
  await login(page, owner)
  await page.goto('/admin')
  const light = page.locator('#accent-light')
  await light.scrollIntoViewIfNeeded()
  try {
    await light.evaluate(element => {
      element.value = '#2244aa'
      element.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await saveNodeSettings(page)
    await expect(page.locator('html')).toHaveAttribute('style', /#2244aa/i)
    await page.goto('/')
    await expect(page.locator('html')).toHaveAttribute('style', /#2244aa/i)
    await expectNoHorizontalScroll(page)
  } finally {
    await page.goto('/admin')
    await page.getByRole('button', { name: 'Вернуть спокойные цвета' }).click()
    await saveNodeSettings(page)
    await expect(page.locator('html')).toHaveAttribute('style', /#3d5c4e/i)
    await expect(page.locator('html')).not.toHaveAttribute('style', /#2244aa/i)
  }
})

test('notification filters separate comments from edits and page offers', async ({ page, browser }) => {
  ownerOnly()
  const suffix = randomBytes(4).toString('hex')
  await login(page, owner)
  const created = await page.evaluate(async (marker) => {
    const response = await fetch('/api/topics', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        title: `Browser archive ${marker}`,
        body: `A browser archive page ${marker} keeps a revision diff and can receive a comment.`,
        kind: 'article',
        locale: 'en',
        authorshipMode: 'human_only',
        rulesConsent: true,
        humanContribution: 'Written by the browser archive owner.',
        sources: [{ url: `https://example.org/aiki-browser-archive-${marker}`, title: `Archive source ${marker}`, publisher: 'Example' }],
      }),
    })
    return { status: response.status, body: await response.json() }
  }, suffix)
  expect(created.status, JSON.stringify(created.body)).toBe(201)
  const slug = created.body.topic.slug

  await page.goto(`/${slug}`)
  await expect(page.getByTestId('page-number')).toBeVisible()
  await expect(page.getByTestId('page-short-url')).toHaveAttribute('href', /\/n\/\d+$/)
  const canonical = page.getByTestId('page-canonical-url')
  const full = await canonical.getAttribute('title')
  await canonical.click()
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(full)

  const revisions = await page.request.get(`/api/topics/${slug}/revisions?locale=en`)
  expect(revisions.status()).toBe(200)
  const revisionId = (await revisions.json()).items[0].id
  await page.goto(`/${slug}/revisions/${revisionId}`)
  await expect(page.getByTestId('revision-change')).toBeVisible()
  await expect(page.getByTestId('revision-introduced')).toBeVisible()
  await expect(page.getByTestId('revision-confirmed')).toBeVisible()
  await expect(page.getByTestId('revision-diff')).toContainText(`A browser archive page ${suffix}`)
  await page.setViewportSize({ width: 390, height: 844 })
  await expectNoHorizontalScroll(page)
  await page.setViewportSize({ width: 1280, height: 900 })

  const memberContext = await browser.newContext(test.info().project.use)
  await applyLocaleAndTheme(memberContext, { locale: 'ru', theme: 'light' })
  const memberPage = await memberContext.newPage()
  const username = `e2e-reader-${suffix}`
  const password = `AIKI-e2e-${randomBytes(18).toString('base64url')}`
  await memberPage.goto('/login')
  await settle(memberPage)
  await memberPage.getByTestId('auth-create').click()
  await expect(memberPage.locator('form').getByLabel(/Username|Имя пользователя/)).toBeVisible()
  await memberPage.getByLabel(/Username|Имя пользователя/).fill(username)
  await memberPage.getByLabel(/email|почта/i).fill(`${username}@example.org`)
  await memberPage.getByLabel(/Password|Пароль/).fill(password)
  const registration = memberPage.waitForResponse(result => result.url().endsWith('/api/auth/register'))
  await memberPage.locator('form').getByRole('button', { name: /^(Create account|Создать аккаунт)$/ }).click()
  expect((await registration).status()).toBe(201)
  const comment = `Комментарий архива ${suffix}`
  const reply = await memberPage.evaluate(async ({ slug: topicSlug, body }) => {
    const response = await fetch(`/api/topics/${encodeURIComponent(topicSlug)}/replies`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ body, locale: 'ru' }),
    })
    return { status: response.status, body: await response.json() }
  }, { slug, body: comment })
  expect(reply.status, JSON.stringify(reply.body)).toBe(201)
  await memberContext.close()

  await page.goto('/')
  await expect(page.locator('[data-testid="notifications-badge"]:visible')).toHaveCount(1)
  await page.goto('/notifications')
  await expect(page.getByTestId('notification-filters')).toBeVisible()
  for (const id of ['all', 'unread', 'edits', 'comments', 'transfers']) {
    await expect(page.getByTestId(`notification-filter-${id}`)).toBeVisible()
  }
  await page.getByTestId('notification-filter-comments').click()
  await expect(page.getByTestId('notification-page_comment').first()).toBeVisible()
  await expect(page.getByTestId('notification-icon-page_comment').first()).toBeVisible()
  await expect(page.getByTestId('notification-edit_proposal')).toHaveCount(0)
  const commentLink = page.getByTestId('notification-page_comment').first().locator('a')
  await expect(commentLink).toHaveAttribute('href', new RegExp(`/${slug}#comment-`))
  await page.getByTestId('notification-filter-transfers').click()
  await expect(page.getByTestId('notification-filter-empty')).toBeVisible()
  await page.getByTestId('notification-filter-all').click()
  await expect(page.getByTestId('notification-page_comment').first()).toBeVisible()
  await page.reload()
  await expect(page.getByTestId('notifications-badge')).toHaveCount(0)
  await page.setViewportSize({ width: 390, height: 844 })
  await expectNoHorizontalScroll(page)
})

test('an owner can close registration and an existing account can still sign in', async ({ page, browser }) => {
  ownerOnly()
  await login(page, owner)
  await page.goto('/admin')
  const toggle = page.getByTestId('registration-open-toggle')
  await toggle.scrollIntoViewIfNeeded()
  if (await toggle.getAttribute('aria-checked') !== 'true') {
    await toggle.click()
    await saveNodeSettings(page)
  }

  let closed = false
  try {
    await toggle.click()
    await expect(toggle).toHaveAttribute('aria-checked', 'false')
    await saveNodeSettings(page)
    closed = true

    const anon = await browser.newContext(test.info().project.use)
    await applyLocaleAndTheme(anon, { locale: 'ru', theme: 'light' })
    const loginPage = await anon.newPage()
    await loginPage.setViewportSize({ width: 1280, height: 900 })
    await loginPage.goto('/login')
    await expect(loginPage.getByTestId('registration-closed')).toHaveText('Регистрация на этом узле закрыта. Войти можно в уже созданный аккаунт.')
    await expect(loginPage.getByTestId('auth-create')).toHaveCount(0)
    await expectNoHorizontalScroll(loginPage)

    await applyLocaleAndTheme(anon, { locale: 'ru', theme: 'dark' })
    await loginPage.goto('/login')
    await expect(loginPage.locator('html')).toHaveAttribute('data-theme', 'dark')
    await expect(loginPage.getByTestId('registration-closed')).toBeVisible()
    await expectNoHorizontalScroll(loginPage)

    await loginPage.setViewportSize({ width: 390, height: 844 })
    await loginPage.goto('/login')
    await expect(loginPage.getByTestId('auth-create')).toHaveCount(0)
    await expectNoHorizontalScroll(loginPage)
    await anon.close()

    const returning = await browser.newContext(test.info().project.use)
    await applyLocaleAndTheme(returning, { locale: 'ru', theme: 'light' })
    const back = await returning.newPage()
    const signedIn = await login(back, owner)
    expect(signedIn.status()).toBe(200)
    await expect(back).toHaveURL(/\/$/)
    await returning.close()
  } finally {
    if (closed) {
      await page.goto('/admin')
      const restore = page.getByTestId('registration-open-toggle')
      if (await restore.getAttribute('aria-checked') !== 'true') {
        await restore.click()
        await saveNodeSettings(page)
      }
      await expect(page.getByTestId('registration-open-toggle')).toHaveAttribute('aria-checked', 'true')
    }
  }

  const reopened = await browser.newContext(test.info().project.use)
  await applyLocaleAndTheme(reopened, { locale: 'ru', theme: 'light' })
  const openPage = await reopened.newPage()
  await openPage.goto('/login')
  await expect(openPage.getByTestId('auth-create')).toBeVisible()
  await expect(openPage.getByTestId('registration-closed')).toHaveCount(0)
  await reopened.close()
})
