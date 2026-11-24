import AxeBuilder from '@axe-core/playwright'
import { test, expect, type Page } from './fixtures'
import { reload, settle } from './helpers'

/* The colour theme: Appearance's choice repaints the page at once and is kept (and set before first paint on the next
   visit), the keyboard chooses like it does for the typeface, and the two themes the accessibility audit doesn't start
   on (Index and Opening Night) pass it too, on both sides. */

const paper = (page: Page) => page.evaluate(() => getComputedStyle(document.body).backgroundColor)
const choose = (page: Page, name: string) => page.getByRole('radiogroup', { name: 'Theme' }).locator('label').filter({ hasText: new RegExp(`^${name}`) }).click()

test.describe('theme', () => {
  test('starts on Admit One, and a choice repaints at once and is kept on the next visit', async ({ boot, page }) => {
    await boot('/settings#appearance')
    await expect(page.locator('html')).toHaveAttribute('data-palette', 'admitOne')
    await expect(page.getByRole('radio', { name: 'Admit One' })).toBeChecked()
    expect(await paper(page)).toBe('rgb(244, 241, 234)')

    await choose(page, 'Index')
    await expect(page.getByRole('radio', { name: 'Index' })).toBeChecked()
    await expect(page.locator('html')).toHaveAttribute('data-palette', 'index')
    expect(await paper(page)).toBe('rgb(255, 255, 255)')
    // The address bar's colour follows the paper.
    await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute('content', /^#(fff|ffffff)$/)

    await reload(page)
    await expect(page.locator('html')).toHaveAttribute('data-palette', 'index')
    await expect(page.getByRole('radio', { name: 'Index' })).toBeChecked()
    expect(await paper(page)).toBe('rgb(255, 255, 255)')

    // Light or dark is the top bar's, and every theme has both.
    await choose(page, 'Opening Night')
    await page.evaluate(() => scrollTo(0, 0))
    await page.getByRole('button', { name: 'Dark mode' }).click()
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
    expect(await paper(page)).toBe('rgb(10, 10, 10)')
    await choose(page, 'Admit One')
    expect(await paper(page)).toBe('rgb(13, 11, 10)')
  })

  test('the keyboard reaches the group in one Tab and the arrow keys choose', async ({ boot, page }) => {
    await boot('/settings#appearance')
    await page.getByRole('radio', { name: 'Admit One' }).focus()
    await page.keyboard.press('ArrowDown')
    await expect(page.getByRole('radio', { name: 'Index' })).toBeChecked()
    await expect(page.locator('html')).toHaveAttribute('data-palette', 'index')
    await page.keyboard.press('ArrowDown')
    await expect(page.getByRole('radio', { name: 'Opening Night' })).toBeChecked()
    await page.keyboard.press('ArrowUp')
    await expect(page.getByRole('radio', { name: 'Index' })).toBeChecked()
  })

  test('a theme this build does not know reads as Admit One', async ({ boot, page }) => {
    await boot('/')
    await page.evaluate(() => {
      const key = 'flow.settings.v1'
      localStorage.setItem(key, JSON.stringify({ ...JSON.parse(localStorage.getItem(key) ?? '{}'), palette: 'matinee' }))
    })
    await reload(page)
    await expect(page.locator('html')).toHaveAttribute('data-palette', 'admitOne')
  })

  test('Settings search finds a theme by its colour', async ({ boot, page }) => {
    await boot('/settings')
    await page.getByRole('combobox', { name: 'Search Settings' }).fill('gold')
    await expect(page.getByRole('listbox', { name: 'Matching settings' }).getByRole('option', { name: /^Opening Night/ })).toBeVisible()
  })
})

for (const palette of ['index', 'openingNight']) {
  for (const side of ['light', 'dark']) {
    test.describe(`${palette}, ${side}`, () => {
      for (const path of ['/', '/settings#appearance', '/title/movie/693134']) {
        test(`${path} has no WCAG 2.1 A or AA violations`, async ({ boot, page }) => {
          await page.addInitScript(([p, s]) => {
            localStorage.setItem('flow.theme', s!)
            localStorage.setItem('flow.settings.v1', JSON.stringify({ palette: p }))
          }, [palette, side])
          await boot(path)
          await expect(page.locator('html')).toHaveAttribute('data-palette', palette)
          await page.waitForLoadState('networkidle')
          await page.mouse.move(0, 0)
          await settle(page)
          const { violations } = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze()
          const lines = violations.flatMap((v) => v.nodes.map((n) => `${v.id} (${v.impact}): ${v.help} — ${n.target.join(' ')}`))
          expect(lines, 'accessibility violations').toEqual([])
        })
      }
    })
  }
}
