import { randomBytes } from 'node:crypto'
import { mkdir } from 'node:fs/promises'
import path from 'node:path'
import { expect, settle, test } from './fixtures.js'
import { applyLocaleAndTheme, expectNoHorizontalScroll, watchProductionHosts } from './support.js'
import { markdownGallerySource } from '../../server/utils/markdown-gallery.js'

async function hideDevOverlay(page) {
  await page.evaluate(() => {
    if (document.getElementById('aiki-hide-tracer')) return
    const style = document.createElement('style')
    style.id = 'aiki-hide-tracer'
    style.textContent = '#vue-tracer-overlay, #vue-tracer-overlay * { display: none !important; visibility: hidden !important; }'
    document.documentElement.appendChild(style)
  })
}

async function shot(page, name) {
  const dir = process.env.AIKI_SCREENSHOT_DIR
  if (!dir) return
  await mkdir(dir, { recursive: true })
  await hideDevOverlay(page)
  await page.evaluate(() => {
    const style = document.createElement('style')
    style.id = 'aiki-shot-style'
    style.textContent = 'header.sticky { display: none !important; }'
    document.head.appendChild(style)
  })
  await page.locator('#article-content').screenshot({ path: path.join(dir, name) })
  await page.evaluate(() => document.getElementById('aiki-shot-style')?.remove())
}

async function paint(locator) {
  return locator.evaluate(element => {
    const style = getComputedStyle(element)
    return {
      background: style.backgroundColor,
      color: style.color,
      decoration: style.textDecorationLine,
      borderLeftWidth: style.borderLeftWidth,
      borderLeftColor: style.borderLeftColor,
      borderTopColor: style.borderTopColor,
      textAlign: style.textAlign,
    }
  })
}

test('published markdown gallery renders every construct', async ({ page }) => {
  const leaked = watchProductionHosts(page)
  await applyLocaleAndTheme(page.context(), { locale: 'en', theme: 'light' })
  await page.setViewportSize({ width: 1280, height: 900 })
  await page.goto('/login')

  const suffix = randomBytes(4).toString('hex')
  const username = `mdgallery${suffix}`
  const password = `AIKI-md-${randomBytes(18).toString('base64url')}`
  const registered = await page.evaluate(async account => {
    const response = await fetch('/api/auth/register', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(account),
    })
    return { status: response.status, body: await response.json() }
  }, { username, email: `${username}@example.org`, password })
  expect(registered.status, JSON.stringify(registered.body)).toBe(201)

  const title = `Markdown gallery ${suffix}`
  const created = await page.evaluate(async article => {
    const response = await fetch('/api/topics', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(article),
    })
    return { status: response.status, body: await response.json() }
  }, {
    title,
    body: markdownGallerySource,
    kind: 'article',
    locale: 'en',
    authorshipMode: 'human_only',
    humanContribution: 'Written for the markdown render check.',
    rulesConsent: true,
    sources: [{ url: `https://example.org/markdown-gallery-${suffix}`, title: `Gallery source ${suffix}`, publisher: 'Example' }],
  })
  expect(created.status, JSON.stringify(created.body)).toBe(201)
  expect(created.body.topic.access).toBe('public')
  expect(created.body.topic.slug).toMatch(/^[a-z0-9-]+$/)

  await page.goto(`/${created.body.topic.slug}`)
  await hideDevOverlay(page)
  await expect(page.getByRole('heading', { name: title })).toBeVisible()
  const article = page.locator('#article-content')
  await expect(article).toBeVisible()

  await expect(article.locator('#second-heading')).toBeVisible()
  await expect(article.locator('#third-heading')).toBeVisible()
  await expect(article.locator('#fourth-heading')).toBeVisible()
  await expect(article.locator('#fifth-heading')).toBeVisible()
  await expect(article.locator('#sixth-heading')).toBeVisible()
  await expect(article.locator('strong', { hasText: 'gallery-bold' })).toBeVisible()
  await expect(article.locator('em', { hasText: 'gallery-italic' })).toBeVisible()
  await expect(article.locator('s', { hasText: 'gallery-strike' })).toBeVisible()
  await expect(article.locator('code', { hasText: 'gallery-code' })).toBeVisible()
  await expect(article.locator('pre code.language-js')).toContainText('const n = 1')
  await expect(article.locator('pre code.language-mermaid')).toContainText('graph TD')
  await expect(article.locator('blockquote')).toContainText('quoted sentence')
  for (const kind of ['note', 'tip', 'important', 'warning', 'caution']) {
    await expect(article.locator(`.aiki-alert-${kind}`)).toBeVisible()
  }
  await expect(article.locator('ul').first()).toContainText('nested item')
  await expect(article.locator('ol').first()).toContainText('first ordered')

  const boxes = article.locator('input[type="checkbox"]')
  await expect(boxes).toHaveCount(2)
  await expect(boxes.first()).toBeDisabled()
  await expect(boxes.first()).toBeChecked()
  await expect(boxes.nth(1)).toBeDisabled()
  await expect(boxes.nth(1)).not.toBeChecked()

  const source = article.getByRole('link', { name: 'the source', exact: true })
  await expect(source).toHaveAttribute('href', 'https://example.org/markdown-gallery')
  const sourcePaint = await paint(source)
  expect(sourcePaint.decoration).toContain('underline')
  expect(sourcePaint.color).toBe('rgb(23, 99, 68)')
  await expect(article.getByRole('link', { name: 'https://example.org/visible-source' })).toBeVisible()
  await expect(article.getByRole('link', { name: 'the second heading' })).toHaveAttribute('href', '#second-heading')
  await expect(article.getByRole('link', { name: 'the node page' })).toHaveAttribute('href', '/node')

  const buttons = article.locator('a.aiki-button')
  await expect(buttons).toHaveCount(2)
  const buttonPaint = await paint(buttons.first())
  expect(buttonPaint.background).toBe('rgb(61, 92, 78)')
  expect(buttonPaint.decoration).toBe('none')
  expect(buttonPaint.color).toBe('rgb(244, 247, 245)')
  await expect(buttons.nth(1)).toHaveText('Open the block')

  const warning = article.locator('.aiki-alert-warning')
  const warningPaint = await paint(warning)
  expect(warningPaint.borderLeftWidth).toBe('4px')
  expect(warningPaint.borderLeftColor).toBe('rgb(154, 107, 32)')

  const right = article.locator('td', { hasText: 'right-cell' })
  expect((await paint(right)).textAlign).toBe('right')
  expect((await paint(article.locator('td', { hasText: 'center-cell' }))).textAlign).toBe('center')
  await expect(article.locator('hr')).toBeVisible()
  await expect(article.locator('kbd')).toHaveText('Ctrl')
  await expect(article.locator('sub')).toHaveText('2')
  await expect(article.locator('#fnref-note')).toHaveText('1')
  await expect(article.locator('sup').filter({ hasText: /^2$/ })).toHaveText('2')
  await expect(article.locator('mark')).toHaveText('gallery-mark')
  await expect(article).toContainText('The next line follows.')
  await expect(article).toContainText('[[wikilink]]')
  await expect(article.locator('a[href*="wikilink"]')).toHaveCount(0)
    await expect(article.locator('img')).toHaveCount(1)
  await expect(article).toContainText('pixel')
    const pixelImg = article.locator('img[src*="track.png"]')
    await expect(pixelImg).toHaveCount(1)
    await expect(pixelImg).toHaveAttribute('alt', /pixel/)
  await expect(article.locator('script, iframe')).toHaveCount(0)
  await expect(article).toContainText('[unsafe](javascript:alert(1))')
  await expect(article.locator('a[href^="javascript:"]')).toHaveCount(0)

  const codePaint = await paint(article.locator('pre').first())
  expect(codePaint.background).toBe('rgb(24, 28, 26)')
  expect((await paint(article.locator('#second-heading'))).color).toBe('rgb(23, 77, 59)')

  const details = article.locator('details')
  await expect(details).toHaveCount(1)
  await expect(details).not.toHaveAttribute('open', '')
  await details.locator('summary').click()
  await expect(details.locator('strong')).toHaveText('gallery-hidden')
  await expect(details.locator('strong')).toBeVisible()

  await article.locator('a[href="#fn-note"]').click()
  await expect(page.locator('#fn-note')).toBeInViewport()
  await expect(page.locator('#fn-note')).toContainText('gallery note')

  await shot(page, 'markdown-gallery-light.png')

  await applyLocaleAndTheme(page.context(), { locale: 'en', theme: 'dark' })
  await page.reload()
  await settle(page)
  await hideDevOverlay(page)
  await expect(page.locator('html')).toHaveClass(/dark/)
  await details.locator('summary').click()
  const darkButton = await paint(article.locator('a.aiki-button').first())
  expect(darkButton.background).toBe('rgb(138, 168, 153)')
  expect(darkButton.decoration).toBe('none')
  expect(darkButton.color).toBe('rgb(20, 32, 26)')
  const darkWarning = await paint(article.locator('.aiki-alert-warning'))
  expect(darkWarning.borderLeftWidth).toBe('4px')
  expect(darkWarning.borderLeftColor).toBe('rgb(224, 184, 106)')
  expect(darkWarning.borderTopColor).toBe('rgb(52, 65, 57)')
  expect((await paint(article.locator('#second-heading'))).color).toBe('rgb(192, 224, 202)')
  expect((await paint(article.locator('td', { hasText: 'right-cell' }))).textAlign).toBe('right')
  await shot(page, 'markdown-gallery-dark.png')

  await page.setViewportSize({ width: 390, height: 844 })
  const wide = article.locator('table').last()
  const tableBox = await wide.evaluate(element => ({
    scroll: element.scrollWidth,
    client: element.clientWidth,
  }))
  expect(tableBox.scroll).toBeGreaterThan(tableBox.client)
  await expectNoHorizontalScroll(page)
  await shot(page, 'markdown-gallery-mobile.png')
  expect(leaked, leaked.join('\n')).toEqual([])
})
