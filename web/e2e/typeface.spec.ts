import { test, expect, type Page } from './fixtures'
import { go, reload } from './helpers'
import { routes } from './sitemap'

/* The typeface: Appearance's choice sets the interface and body text at once and is kept, the labels stay Plex Mono
   whatever is chosen, only the chosen web font is downloaded, and every page's title is no bigger than the display scale. */

const family = (page: Page, selector: string) => page.locator(selector).first().evaluate((el) => getComputedStyle(el).fontFamily)
const bodyFace = (page: Page) => page.evaluate(() => getComputedStyle(document.body).fontFamily)

const choose = (page: Page, name: string) =>
  page
    .getByRole('radiogroup', { name: 'Typeface' })
    .locator('label')
    .filter({ hasText: new RegExp(`^${name}`) })
    .click()

test.describe('typeface', () => {
  test('starts on System, and a choice sets the body text at once and is kept on the next visit', async ({ boot, page }) => {
    await boot('/settings#appearance')
    await expect(page.locator('html')).toHaveAttribute('data-font', 'system')
    expect(await bodyFace(page)).not.toContain('Plex')
    await expect(page.getByRole('radio', { name: 'System' })).toBeChecked()

    await choose(page, 'Inter')
    await expect(page.getByRole('radio', { name: 'Inter' })).toBeChecked()
    await expect(page.locator('html')).toHaveAttribute('data-font', 'inter')
    expect(await bodyFace(page)).toContain('Inter Variable')
    // The browser has the face by the time the next frame is drawn: the text on the page really is set in it.
    await expect.poll(() => page.evaluate(() => document.fonts.check('600 15px "Inter Variable"'))).toBe(true)

    await reload(page)
    await expect(page.locator('html')).toHaveAttribute('data-font', 'inter')
    await expect(page.getByRole('radio', { name: 'Inter' })).toBeChecked()
    expect(await bodyFace(page)).toContain('Inter Variable')

    await choose(page, 'Mono')
    expect(await bodyFace(page)).toContain('IBM Plex Mono')
    await reload(page)
    expect(await bodyFace(page)).toContain('IBM Plex Mono')
  })

  test('the keyboard reaches the group in one Tab and the arrow keys choose', async ({ boot, page }) => {
    await boot('/settings#appearance')
    await page.getByRole('radio', { name: 'System' }).focus()
    await page.keyboard.press('ArrowDown')
    await expect(page.getByRole('radio', { name: 'Inter' })).toBeChecked()
    await expect(page.locator('html')).toHaveAttribute('data-font', 'inter')
    await page.keyboard.press('ArrowDown')
    await expect(page.getByRole('radio', { name: 'Geist' })).toBeChecked()
    await page.keyboard.press('ArrowUp')
    await expect(page.getByRole('radio', { name: 'Inter' })).toBeChecked()
  })

  test('a typeface an older build saved as Ioskeley reads as Mono', async ({ boot, page }) => {
    await boot('/')
    await page.evaluate(() => {
      const key = 'flow.settings.v1'
      localStorage.setItem(key, JSON.stringify({ ...JSON.parse(localStorage.getItem(key) ?? '{}'), font: 'ioskeley' }))
    })
    await go(page, '/settings#appearance')
    await expect(page.locator('html')).toHaveAttribute('data-font', 'mono')
    await expect(page.getByRole('radio', { name: 'Mono' })).toBeChecked()
  })

  test('the labels stay Plex Mono and the titles Archivo, whatever is chosen', async ({ boot, page }) => {
    await boot('/settings#appearance')
    await choose(page, 'Geist')
    await go(page, '/')
    await expect(page.getByRole('heading', { name: 'Continue Watching' })).toBeVisible()
    expect(await bodyFace(page)).toContain('Geist Variable')
    // The red section label is mono; the navigation and the buttons follow the choice; the lead is Archivo.
    expect(await family(page, 'h2:has-text("Continue Watching")')).toContain('IBM Plex Mono')
    expect(await page.getByRole('link', { name: 'Explore', exact: true }).first().evaluate((el) => getComputedStyle(el).fontFamily)).toContain('Geist Variable')
    expect(await page.getByRole('link', { name: /^Resume/ }).first().evaluate((el) => getComputedStyle(el).fontFamily)).toContain('Geist Variable')
  })

  test('only the face that is chosen is downloaded, and System downloads none', async ({ boot, page }) => {
    const files: string[] = []
    page.on('request', (r) => {
      if (/(inter|geist|manrope)-[\w-]*wght-normal.*\.woff2/.test(r.url())) files.push(r.url())
    })
    await boot('/library')
    await expect(page.getByRole('heading', { name: 'Library', level: 1 })).toBeVisible()
    await page.evaluate(() => document.fonts.ready)
    expect(files).toEqual([])
    await go(page, '/settings#appearance')
    await choose(page, 'Manrope')
    await expect.poll(() => files.length).toBeGreaterThan(0)
    await go(page, '/library')
    await expect(page.getByRole('heading', { name: 'Library', level: 1 })).toBeVisible()
    expect(await bodyFace(page)).toContain('Manrope Variable')
  })
})

test.describe('page titles', () => {
  test('are no bigger than the display scale, and Home’s lead, set on its plate, is smaller than any of them', async ({ boot, page }) => {
    await boot('/')
    await expect(page.getByRole('heading', { name: 'Continue Watching' })).toBeVisible()
    // The lead's title is the largest Archivo heading on Home. It sits on a paper plate over the picture, so it is set
    // smaller than a page's title, which takes the display scale (--fs-display).
    const lead = await page.evaluate(() => {
      const sizes = [...document.querySelectorAll('h1, h2')].filter((el) => getComputedStyle(el).fontFamily.includes('Archivo')).map((el) => parseFloat(getComputedStyle(el).fontSize))
      return Math.max(0, ...sizes)
    })
    expect(lead).toBeGreaterThan(30)
    expect(lead).toBeLessThan(60)

    const places = [...routes.filter((r) => ['Explore', 'Search', 'Library', 'Live TV', 'Settings', 'A film', 'A person', 'A collection', 'An address the site doesn’t have'].includes(r.name)), { name: 'Upcoming', path: '/library?list=upcoming' }, { name: 'History', path: '/library?list=history' }, { name: 'Stats', path: '/library?list=stats' }, { name: 'Sports', path: '/library?list=sports' }]
    for (const r of places) {
      await go(page, `${r.path}${r.path.includes('?') ? '&' : '?'}demo`)
      const h1 = page.getByRole('heading', { level: 1 }).first()
      await expect(h1, r.name).toBeVisible()
      const px = await h1.evaluate((el) => parseFloat(getComputedStyle(el).fontSize))
      const display = await h1.evaluate((el) => {
        const probe = document.createElement('div')
        probe.style.fontSize = 'var(--fs-display)'
        el.appendChild(probe)
        const size = parseFloat(getComputedStyle(probe).fontSize)
        probe.remove()
        return size
      })
      expect(px, `${r.name}: the page title (${px}px) against the display scale (${display}px)`).toBeLessThanOrEqual(display + 0.5)
      expect(await h1.evaluate((el) => getComputedStyle(el).fontFamily), r.name).toContain('Archivo')
    }
  })
})
