import { randomBytes } from 'node:crypto'
import { test, expect } from './fixtures.js'

test('home search shows updating typed results and sends an anonymous page order to sign-in', async ({ page }) => {
  await page.goto('/')
  const search = page.locator('#topic-search')
  const language = await page.locator('html').getAttribute('lang')
  const articleLabel = language === 'ru' ? 'Статьи' : 'Articles'
  const questionLabel = language === 'ru' ? 'Вопросы' : 'Questions'
  const discussionLabel = language === 'ru' ? 'Обсуждения' : 'Discussions'
  const noMatchPattern = language === 'ru' ? /Подходящих страниц и задач на написание пока нет/ : /No pages or writing tasks match this search yet/
  // With no match the search offers to start a discussion (or a question when the query has "?").
  const orderPattern = language === 'ru' ? /Обсудить в AIKI/ : /Discuss in AIKI/
  const dropdown = page.getByTestId('search-dropdown')
  const fixtures = [
    { needle: 'Welcome to AIKI', slug: 'welcome-to-aiki', kind: 'article', title: 'Welcome to AIKI' },
    { needle: 'How should knowledge pages cite sources?', slug: 'how-should-knowledge-pages-cite-sources', kind: 'question', title: 'How should knowledge pages cite sources?' },
    { needle: 'Transparent revision history', slug: 'transparent-revisions', kind: 'discussion', title: 'Transparent revision history' },
  ]
  await page.route('**/api/topics**', async route => {
    const url = new URL(route.request().url())
    const q = url.searchParams.get('q') || ''
    const match = fixtures.find(item => item.needle === q)
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ query: q, items: match ? [{ id: match.slug, slug: match.slug, kind: match.kind, title: match.title, body_markdown: 'A fixture search result with enough text to preview.', author: 'community', reply_count: 2, upvotes: 1 }] : [], total: match ? 1 : 0 }) })
  })

  await search.fill('Welcome to AIKI')
  await expect(dropdown).toBeVisible()
  await expect(dropdown.getByRole('link', { name: /Welcome to AIKI/ })).toBeVisible()
  await expect(dropdown.getByTestId('result-kind')).toContainText(articleLabel)

  await search.fill('How should knowledge pages cite sources?')
  await expect(dropdown.getByRole('link', { name: /How should knowledge pages cite sources/ })).toBeVisible()
  await expect(dropdown.getByTestId('result-kind')).toContainText(questionLabel)

  await search.fill('Transparent revision history')
  await expect(dropdown.getByRole('link', { name: /Transparent revision history/ })).toBeVisible()
  await expect(dropdown.getByTestId('result-kind')).toContainText(discussionLabel)

  await search.fill('A unique phrase with no existing result')
  await expect(dropdown.getByText(noMatchPattern)).toBeVisible()
  const create = dropdown.getByTestId('search-create-article')
  await expect(create).toHaveAttribute('role', 'button')
  await expect(create).toContainText(orderPattern)
  await expect(create).toHaveAttribute('aria-disabled', 'false')

  // Creating a page needs an account: an anonymous reader is sent to sign-in with the query kept.
  // The signed-in order is covered by the login test below.
  await search.fill('New article order e2e')
  let ordered = false
  await page.route('**/api/article-drafts', async route => {
    ordered = true
    await route.abort()
  })
  await expect(create).toHaveAttribute('aria-disabled', 'false')
  await create.click()
  await expect(page).toHaveURL(/\/login\?redirect=/)
  expect(new URL(page.url()).searchParams.get('redirect')).toBe(`/?q=${encodeURIComponent('New article order e2e')}`)
  expect(ordered).toBe(false)
})

test('login API failure stays on login page and shows a safe error', async ({ page }) => {
  await page.route('**/api/auth/login', async route => {
    await route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ statusCode: 500, statusMessage: 'The request could not be completed. Please try again.' }) })
  })
  await page.goto('/login')
  await page.getByLabel(/username or email/i).fill('login-fixture')
  await page.getByLabel(/password/i).fill('Fixture-password-123!')
  // The password form's own submit button; the page also offers "Sign in with an agent key".
  await page.locator('form').getByRole('button', { name: /^sign in$/i }).click()
  await expect(page).toHaveURL(/\/login$/)
  await expect(page.getByRole('alert')).toContainText('The request could not be completed. Please try again.')
})

test('registered user can log in, view account ID and WPG balance, then open the created writing page', async ({ page }) => {
  const suffix = Math.random().toString(16).slice(2, 10)
  const actorId = '123e4567-e89b-42d3-a456-426614174003'
  const query = `Login order e2e ${suffix}`
  // TEMP diagnostics
  page.on('console', m => console.log('[browser]', m.type(), m.text()))
  page.on('pageerror', e => console.log('[pageerror]', e.message, e.stack))
  page.on('request', r => { if (r.url().includes('/api/')) console.log('[req]', r.method(), r.url()) })
  page.on('requestfailed', r => console.log('[reqfail]', r.url(), r.failure()?.errorText))

  // Pages read the session during server rendering, which page.route cannot mock, so the
  // sign-in uses a real disposable account; the account details below stay a client-side fixture.
  const username = `login${suffix}`
  const password = `AIKI-login-${randomBytes(18).toString('base64url')}`
  await page.goto('/login')
  const registered = await page.evaluate(async account => {
    const response = await fetch('/api/auth/register', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(account) })
    await fetch('/api/auth/logout', { method: 'POST' })
    return response.status
  }, { username, email: `${username}@example.org`, password })
  expect(registered).toBe(201)
  await page.route('**/api/account', async route => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ account: {
      id: actorId, username: 'login-fixture', role: 'member',
      publicId: '52816547950546',
      tokenAccount: { ticker: 'WPG', balance: 1, redemptionEnabled: false, history: [{ amount: 1, reason: 'article_accepted', sourceType: 'writing_task', sourceId: '123e4567-e89b-42d3-a456-426614174004', description: '+1 WPG for an accepted article', createdAt: '2026-10-02T09:00:00.000Z' }] },
    } }) })
  })

  await page.goto('/login')
  await page.getByLabel(/username or email/i).fill(username)
  await page.getByLabel(/password/i).fill(password)
  const loginResponse = page.waitForResponse(response => response.url().endsWith('/api/auth/login') && response.status() === 200)
  // The password form's own submit button; the page also offers "Sign in with an agent key".
  await page.locator('form').getByRole('button', { name: /^sign in$/i }).click()
  await loginResponse
  await expect(page).toHaveURL(/\/$/)
  await expect(page.getByRole('link', { name: /account/i })).toBeVisible()
  await page.getByRole('link', { name: /account/i }).click()
  await expect(page).toHaveURL(/\/account$/)
  await expect(page.getByTestId('account-user-id')).toHaveText('#52816547950546')
  await expect(page.getByTestId('wpg-balance')).toContainText('1 WPG')
  await expect(page.getByText(/cannot be redeemed or spent/i)).toBeVisible()
  await expect(page.getByText('+1 WPG for an accepted article')).toBeVisible()

  await page.goto('/')
  await page.route('**/api/topics**', async route => {
    const url = new URL(route.request().url())
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ query: url.searchParams.get('q') || '', items: [], total: 0 }) })
  })
  await page.route('**/api/article-drafts', async route => {
    const body = route.request().postDataJSON()
    expect(body.query).toBe(query)
    expect(body.locale).toBe('en')
    // A search with no match starts a discussion (a question when the query has "?").
    expect(body.requestedKind).toBe('discussion')
    await route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ topic: { page_number: 79, short_path: '/79', slug: query.toLowerCase().replaceAll(' ', '-'), kind: 'page', status: 'published', access: 'public', classification: { status: 'queued', progressPercent: 0 } } }) })
  })

  await page.locator('#topic-search').fill(query)
  await page.getByTestId('search-create-article').click()
  await expect(page.getByTestId('search-create-loader')).toBeVisible()
  await expect(page).toHaveURL(/\/79$/)
})
