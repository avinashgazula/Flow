import AxeBuilder from '@axe-core/playwright'
import { test, expect, type Page } from './fixtures'
import { routes } from './sitemap'
import { control, playFirstSource, wake } from './helpers'

/* axe against WCAG 2.1 A and AA on every address, the settings pages, and the sheets and panels that open over them.
   A violation is a bug to fix in the page; where one is a design choice, the single rule is switched off for the single
   element, in `allowed` below, with the reason beside it. */

const settingsPages: [string, string][] = [
  ['appearance', 'Appearance'], ['catalogue', 'Catalogue'], ['metadata', 'Metadata'], ['shelves', 'Shelves'], ['addons', 'Stream Add-ons'], ['servers', 'Media Servers'], ['requests', 'Requests'],
  ['sources', 'Sources'], ['livetv', 'Live TV'], ['playback', 'Playback'], ['account', 'Account'], ['data', 'Data'], ['about', 'About'],
]

const tags = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']

/** Rule ids switched off for one selector, each with why. Empty on purpose: nothing is exempt until a reason is written. */
const allowed: { rule: string; selector: string; why: string }[] = []

async function audit(page: Page, scope?: string) {
  // Contrast is read from the colours on screen: let anything fading in or sliding finish first (a loop would never).
  await page.evaluate(() => Promise.all(document.getAnimations().filter((a) => a.effect?.getComputedTiming().iterations !== Infinity).map((a) => a.finished.catch(() => undefined))))
  let builder = new AxeBuilder({ page }).withTags(tags)
  if (scope) builder = builder.include(scope)
  for (const { rule, selector } of allowed) builder = builder.disableRules([rule]).exclude(selector)
  const { violations } = await builder.analyze()
  // One line per problem: the rule, how bad, and where, so a failure says what to fix.
  const lines = violations.flatMap((v) => v.nodes.map((n) => `${v.id} (${v.impact}): ${v.help} — ${n.target.join(' ')} — ${n.failureSummary?.split('\n')[1]?.trim() ?? ''}`))
  expect(lines, 'accessibility violations').toEqual([])
}

test.describe('every address', () => {
  for (const route of routes) {
    test(`${route.name} has no WCAG 2.1 A or AA violations`, async ({ boot, page }) => {
      await boot(route.path)
      await route.ready(page)
      await page.waitForLoadState('networkidle')
      await audit(page)
    })
  }

  test('the welcome page has none', async ({ page }) => {
    await page.goto('/')
    await expect(page.getByLabel('TMDB API Key')).toBeVisible()
    await audit(page)
  })

  test('Home in the dark theme has none', async ({ boot, page }) => {
    await boot('/')
    await page.getByRole('button', { name: 'Dark mode' }).click()
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
    await page.waitForLoadState('networkidle')
    await audit(page)
  })
})

test.describe('settings pages', () => {
  for (const [id, title] of settingsPages) {
    test(`${title} (#${id}) has none`, async ({ boot, page }) => {
      await boot(`/settings#${id}`)
      await expect(page.getByRole('region', { name: title, exact: true })).toBeVisible()
      await page.waitForLoadState('networkidle')
      await audit(page)
    })
  }
})

test.describe('what opens over a page', () => {
  test('the source picker', async ({ boot, page }) => {
    await boot('/title/movie/157336')
    await page.getByRole('button', { name: '5 · AIOStreams' }).click()
    await expect(page.getByRole('dialog', { name: 'Sources for Interstellar' }).getByRole('option').first()).toBeVisible()
    await audit(page)
  })

  test('the Filters sheet', async ({ boot, page }) => {
    await boot('/explore')
    await page.getByRole('button', { name: 'Filters' }).click()
    await expect(page.getByRole('dialog')).toBeVisible()
    await audit(page)
  })

  test('a poster’s menu', async ({ boot, page }) => {
    await boot('/')
    const shelf = page.getByRole('region', { name: 'Watchlist' })
    // A menu closes when the page scrolls under it, so let the page settle where the poster is before opening it.
    await shelf.scrollIntoViewIfNeeded()
    await page.waitForLoadState('networkidle')
    await shelf.getByRole('button', { name: 'More options for Shōgun' }).click()
    await expect(page.getByRole('menu')).toBeVisible()
    await audit(page)
  })

  test('the player with its controls showing', async ({ boot, page }) => {
    await boot('/title/movie/157336')
    await page.getByRole('button', { name: /^Play/ }).click()
    await playFirstSource(page)
    await wake(page)
    await expect(control(page, 'Options')).toBeVisible()
    await audit(page)
  })

  test('the player’s audio and subtitles panel', async ({ boot, page }) => {
    await boot('/title/movie/157336')
    await page.getByRole('button', { name: /^Play/ }).click()
    await playFirstSource(page)
    await wake(page)
    await control(page, 'Audio and Subtitles').click()
    await expect(page.getByRole('dialog', { name: 'Audio and Subtitles' })).toBeVisible()
    await audit(page)
  })

  test('the live player', async ({ boot, page }) => {
    await boot('/live')
    await page.getByRole('button', { name: 'Watch Flow News' }).click()
    await expect(page.getByRole('region', { name: 'Live: Flow News' })).toBeVisible()
    await audit(page)
  })
})
