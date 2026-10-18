import { test, expect } from './fixtures.js'
import { randomBytes } from 'node:crypto'
import { rememberOwner } from './support.js'
import { promoteDisposableOwnerConnection } from '../support/disposable-owner.mjs'

test('public AIKI agent and API documentation routes are discoverable', async ({ page, request }) => {
  await page.goto('/')
  // The home page links the agent guide next to the per-app MCP buttons; the full list lives in the footer.
  const home = page.getByRole('navigation', { name: 'Developer integrations' })
  await expect(home.getByRole('link', { name: 'Agent guide' })).toHaveAttribute('href', '/agent')
  await page.locator('footer summary').click()
  const links = page.locator('footer').getByRole('navigation', { name: 'Connect an agent' })
  await expect(links.getByRole('link', { name: 'MCP setup' })).toHaveAttribute('href', '/connect')
  await expect(links.getByRole('link', { name: 'Agent guide' })).toHaveAttribute('href', '/agent')
  await expect(links.getByRole('link', { name: 'API reference' })).toHaveAttribute('href', '/api.txt')
  await expect(links.getByRole('link', { name: 'OpenAPI specification' })).toHaveAttribute('href', '/openapi-v1.yaml')
  await expect(links.getByRole('link', { name: 'llms.txt' })).toHaveAttribute('href', '/llms.txt')

  const cases = [
    ['/agent', /text\/markdown/, 'AIKI Agent Guide', 'aiki_create_article'],
    ['/api.txt', /text\/plain/, 'AIKI HTTP API reference', 'POST /mcp'],
    ['/openapi-v1.yaml', /application\/yaml/, 'openapi: 3.1.0', '/api/topics/{slug}/proposals'],
    ['/llms.txt', /text\/plain/, '# AIKI', 'https://aiki.wiki/agent'],
  ]
  for (const [url, type, ...markers] of cases) {
    const response = await request.get(url)
    expect(response.status(), url).toBe(200)
    expect(response.headers()['content-type']).toMatch(type)
    const body = await response.text()
    for (const marker of markers) expect(body, `${url} includes ${marker}`).toContain(marker)
  }
})



test('owner enrolls an agent and MCP article publishes provenance and canonical slug', async ({ page, request }) => {
  const suffix = randomBytes(5).toString('hex')
  const username = `agent-owner-${suffix}`
  const password = `AIKI-agent-${randomBytes(18).toString('base64url')}`
  const title = `MCP browser article ${suffix}`
  const articleBody = `A browser E2E article created by an authenticated MCP agent. Fixture ${suffix}.\n\n## Evidence\n\nReaders can follow this section from the page contents.\n\n### Sources\n\nThe source list below records links used to prepare the page.\n\n## Evidence\n\nRepeated headings receive distinct, stable page anchors.`

  await page.goto('/login')
  await page.getByTestId('auth-create').click()
  await expect(page.locator('form input[autocomplete="username"]')).toBeVisible()
  await page.getByLabel(/Username/).fill(username)
  await page.getByLabel('Email').fill(`${username}@example.org`)
  await page.getByLabel('Password').fill(password)
  const registrationResponse = page.waitForResponse(response => response.url().endsWith('/api/auth/register') && response.status() === 201)
  await page.getByRole('button', { name: 'Create account' }).last().click()
  await registrationResponse
  await page.waitForURL('/')
  let actorState = await page.evaluate(async () => (await (await fetch('/api/auth/me')).json()).actor)
  if (actorState?.role !== 'owner') {
    await promoteDisposableOwnerConnection(actorState?.id)
    actorState = await page.evaluate(async () => (await (await fetch('/api/auth/me')).json()).actor)
  }
  expect(actorState?.role, JSON.stringify(actorState)).toBe('owner')
  await rememberOwner({ username, password })

  const enrollment = await page.evaluate(async username => {
    const response = await fetch('/api/agents', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username }),
    })
    return { status: response.status, body: await response.json() }
  }, `agent-${suffix}`)
  expect(enrollment.status, JSON.stringify(enrollment.body)).toBe(201)
  const enrolled = enrollment.body
  const key = enrolled.api_key
  expect(key).toMatch(/^aiki_agent_[A-Za-z0-9_-]{43}$/)

  const response = await request.post('/mcp', {
    headers: { authorization: `Bearer ${key}` },
    data: {
      jsonrpc: '2.0', id: 1, method: 'tools/call',
      params: { name: 'aiki_create_article', arguments: {
        title,
        body: articleBody,
        locale: 'en',
        authorshipMode: 'ai_generated_human_reviewed',
        rulesConsent: true,
        modelName: 'Playwright model 1.0',
        sources: [{ url: `https://example.org/mcp-e2e-${suffix}`, title: `MCP source ${suffix}`, publisher: 'Example' }],
      } },
    },
  })
  expect(response.status()).toBe(200)
  const result = await response.json()
  expect(result.result.isError).toBe(false)
  const article = result.result.structuredContent
  expect(article.canonical_path).toMatch(/^\/\d+$/)
  await page.goto(article.canonical_path)
  await expect(page.getByRole('heading', { name: title })).toBeVisible()
  await expect(page.getByTestId('page-number')).toContainText(/\d+/)
  await expect(page.getByTestId('page-canonical-url')).toHaveAttribute('title', new RegExp(`${article.canonical_path}$`))
  await expect(page.getByTestId('page-short-url')).toHaveText(article.slug)
  const firstEvidence = page.getByRole('heading', { name: 'Evidence' }).first()
  const secondEvidence = page.getByRole('heading', { name: 'Evidence' }).nth(1)
  await expect(firstEvidence).toHaveAttribute('id', 'evidence')
  await expect(secondEvidence).toHaveAttribute('id', 'evidence-2')
  await expect(page.getByRole('link', { name: 'Evidence', exact: true }).first()).toHaveAttribute('href', '#evidence')
  await expect(page.getByRole('link', { name: 'Evidence', exact: true }).nth(1)).toHaveAttribute('href', '#evidence-2')
  await expect(page.getByRole('link', { name: 'Sources', exact: true }).last()).toHaveAttribute('href', '#article-sources')
  await expect(page.getByTestId('authorship-disclosure')).toContainText('AI-generated and reviewed by a human')
  await page.setViewportSize({ width: 390, height: 844 })
  const mobileContents = page.locator('details').filter({ has: page.locator('nav[aria-label="On this page"]') }).first()
  await mobileContents.locator('summary').click()
  await expect(mobileContents).toHaveAttribute('open', '')
  await mobileContents.locator('nav a[href="#article-sources"]').click()
  await expect(page).toHaveURL(/#article-sources$/)
  await expect(page.locator('#article-sources')).toBeInViewport()
  const pageWidth = await page.evaluate(() => document.documentElement.scrollWidth)
  expect(pageWidth).toBeLessThanOrEqual(390)
  await page.setViewportSize({ width: 1280, height: 900 })
  await expect(page.getByTestId('authorship-disclosure')).toContainText('Playwright model 1.0')
  await expect(page.getByRole('link', { name: `MCP source ${suffix}` })).toHaveAttribute('href', `https://example.org/mcp-e2e-${suffix}`)
  // The numbered address is canonical; the address code and the legacy /topics/ path lead to it.
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', new RegExp(`${article.canonical_path}$`))
  const legacyResponse = await request.get(`/topics/${article.slug}`, { maxRedirects: 0 })
  expect(legacyResponse.status()).toBe(301)
  expect(legacyResponse.headers().location).toMatch(new RegExp(`/${article.slug}$`))
  const codeResponse = await request.get(`/${article.slug}`, { maxRedirects: 0 })
  expect(codeResponse.status()).toBe(301)
  expect(codeResponse.headers().location).toBe(article.canonical_path)
  await page.goto(`/topics/${article.slug}`)
  await expect(page).toHaveURL(new RegExp(`${article.canonical_path}$`))

  const revisionList = await request.get(`/api/topics/${article.slug}/revisions?locale=en`)
  expect(revisionList.status()).toBe(200)
  const revisions = await revisionList.json()
  expect(revisions.items.length).toBeGreaterThan(0)
  await page.goto(`/${article.slug}/revisions/${revisions.items[0].id}`)
  await expect(page.getByRole('heading', { name: title })).toBeVisible()
  await expect(page.getByTestId('revision-change')).toBeVisible()
  await expect(page.getByTestId('revision-introduced')).toBeVisible()
  await expect(page.getByTestId('revision-confirmed')).toBeVisible()
  await expect(page.getByTestId('revision-diff')).toContainText(suffix)
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', new RegExp(`/${article.slug}/revisions/${revisions.items[0].id}$`))
  const legacyRevision = await request.get(`/topics/${article.slug}/revisions/${revisions.items[0].id}`, { maxRedirects: 0 })
  expect(legacyRevision.status()).toBe(301)
  expect(legacyRevision.headers().location).toBe(`/${article.slug}/revisions/${revisions.items[0].id}`)

  await page.goto('/topics')
  await page.getByRole('button', { name: 'Start a topic' }).click()
  const composer = page.locator('form').filter({ has: page.getByRole('heading', { name: 'Start a topic' }) })
  const humanTitle = `Human-authored article ${suffix}`
  await composer.getByLabel('Title', { exact: true }).first().fill(humanTitle)
  await composer.getByLabel('Details (Markdown)').fill(`This article is written by a human without AI-generated text. Fixture ${suffix}.`)
  await composer.getByLabel('Type').selectOption('article')
  await composer.getByLabel('Who wrote this article?').selectOption('human_only')
  await composer.getByLabel('Human contribution').fill('Written entirely by the named human author; no AI generated the article text.')
  await composer.getByLabel('Public URL').fill(`https://example.org/human-ui-${suffix}`)
  await composer.getByLabel('Title', { exact: true }).nth(1).fill(`Human source ${suffix}`)
  await composer.getByRole('button', { name: 'Publish topic' }).click()
  await expect(page.getByRole('heading', { name: humanTitle })).toBeVisible()
  await expect(page.getByTestId('authorship-disclosure')).toContainText('Written by a human')
  await expect(page.getByTestId('authorship-disclosure')).not.toContainText('AI model')
  await expect(page.getByRole('link', { name: `Human source ${suffix}` })).toHaveAttribute('href', `https://example.org/human-ui-${suffix}`)
  // A composer page without a chosen address opens at its numbered canonical path.
  await expect(page).toHaveURL(/\/\d+$/)
})


test('anonymous reading, account registration, topic with source, and reply', async ({ page }) => {
  const suffix = randomBytes(5).toString('hex')
  const username = `browser-${suffix}`
  const email = `${username}@example.org`
  const password = `AIKI-browser-${randomBytes(18).toString('base64url')}`
  const title = `Browser E2E topic ${suffix}`
  const body = `This browser-only scenario verifies the user flow ${suffix}.`
  const reply = `A browser-published reply ${suffix}.`

  await page.goto('/topics', { waitUntil: 'domcontentloaded' })
  await expect(page.getByText('Reading is open.')).toBeVisible()
  await expect(page.getByRole('link', { name: 'Sign in or create an account' })).toBeVisible()

  await page.goto('/login')
  await page.getByTestId('auth-create').click()
  await expect(page.locator('form input[autocomplete="username"]')).toBeVisible()
  await page.getByLabel(/Username/).fill(username)
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill(password)
  const registrationResponse = page.waitForResponse(response => response.url().endsWith('/api/auth/register') && response.status() === 201)
  await page.getByRole('button', { name: 'Create account' }).last().click()
  await registrationResponse
  await page.goto('/topics')
  await expect(page.getByText(username, { exact: false })).toBeVisible()
  await page.getByRole('button', { name: 'Start a topic' }).click()

  const composer = page.locator('form').filter({ has: page.getByRole('heading', { name: 'Start a topic' }) })
  await composer.getByLabel('Title', { exact: true }).first().fill(title)
  await composer.getByLabel('Details (Markdown)').fill(body)
  await composer.getByText('Add a source (optional)').click()
  await composer.getByLabel('Public URL').fill(`https://example.org/${suffix}`)
  await composer.getByLabel('Title', { exact: true }).nth(1).fill(`Source ${suffix}`)
  await composer.getByLabel('Publisher').fill('Example publisher')
  await composer.getByLabel('Relevant passage / note').fill('Section 1')
  await composer.getByRole('button', { name: 'Publish topic' }).click()

  await expect(page.getByRole('heading', { name: title })).toBeVisible()
  await expect(page.getByRole('link', { name: `Source ${suffix}` })).toHaveAttribute('href', `https://example.org/${suffix}`)
  await expect(page.getByText('Example publisher')).toBeVisible()
  await expect(page.getByText('Section 1')).toBeVisible()
  await expect(page.getByText(body)).toBeVisible()

  const discussion = page.locator('#article-discussion')
  await discussion.locator('textarea').fill(reply)
  await discussion.getByRole('button', { name: /Post reply|Отправить ответ/ }).click()
  await expect(page.getByText(reply)).toBeVisible()

  await page.goto('/welcome-to-aiki')
  await expect(page.getByRole('heading', { name: 'Welcome to AIKI' })).toBeVisible()
  // Revision history and edit proposals open in a dialog from the revision label under the title.
  await page.getByTestId('revision-history-open').click()
  const history = page.getByRole('dialog', { name: 'Revision history' })
  await expect(history).toBeVisible()
  await history.getByRole('link', { name: 'Welcome to AIKI' }).first().click()
  await expect(page).toHaveURL(/\/welcome-to-aiki\/revisions\/[0-9a-f-]+$/)
  await expect(page.getByRole('heading', { name: 'Welcome to AIKI' })).toBeVisible()
  await expect(page.getByText('Published changes are traceable through revisions.', { exact: true })).toBeVisible()
  await page.goto('/topics/welcome-to-aiki')
  await expect(page.getByRole('heading', { name: 'Welcome to AIKI' })).toBeVisible()
  await page.getByTestId('revision-history-open').click()
  const proposalDialog = page.getByRole('dialog', { name: 'Revision history' })
  await expect(proposalDialog.getByRole('heading', { name: 'Edit proposals' })).toBeVisible()
  await proposalDialog.getByLabel('Proposed text (Markdown)').fill(`A proposed improvement to ${body}`)
  await proposalDialog.getByLabel('Why should this change be made?').fill('Add explicit context and clarify the evidence described here.')
  await proposalDialog.getByRole('button', { name: 'Submit proposal' }).click()
  await expect(proposalDialog.getByText('Proposal submitted for review.')).toBeVisible()
  const proposals = proposalDialog.locator('section').filter({ has: page.getByRole('heading', { name: 'Edit proposals' }) })
  const submitted = proposals.getByRole('listitem').filter({ hasText: `A proposed improvement to ${body}` })
  await expect(submitted).toBeVisible()
  await submitted.getByText('Compare with the exact base revision').click()
  await expect(submitted.getByText(`+ A proposed improvement to ${body}`, { exact: true })).toBeVisible()
})
