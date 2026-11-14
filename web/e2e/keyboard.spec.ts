import { test, expect, type Page } from './fixtures'

/* Using the site without a pointer: the Tab key reaches every control, the focus is visible, the Go shortcuts and the
   shortcuts sheet work, and Escape closes what opened. (The player's own keys are in player.spec.ts.) */

/** Marks every control a keyboard should reach (visible, enabled, in the Tab order) and returns how many there are. */
async function markControls(page: Page) {
  return page.evaluate(() => {
    const selector = 'a[href], button, input, select, textarea, summary, [tabindex]'
    let n = 0
    for (const el of document.querySelectorAll<HTMLElement>(selector)) {
      const style = getComputedStyle(el)
      const box = el.getBoundingClientRect()
      const disabled = (el as HTMLButtonElement).disabled
      const inert = el.closest('[inert], [aria-hidden="true"], [hidden]')
      if (el.tabIndex < 0 || disabled || inert || style.visibility === 'hidden' || style.display === 'none' || box.width === 0 || box.height === 0) continue
      el.dataset.e2eControl = String(n++)
    }
    return n
  })
}

/** Presses Tab until every marked control has had focus, or gives up; returns the ones never reached. */
async function tabThroughAll(page: Page, count: number, limit: number) {
  const seen = new Set<number>()
  // Start from the top of the page: Firefox carries on from the last focused control (the search field starts focused) otherwise.
  await page.evaluate(() => {
    ;(document.activeElement as HTMLElement | null)?.blur()
    document.body.tabIndex = -1
    document.body.focus()
    document.body.removeAttribute('tabindex')
  })
  for (let presses = 0; presses < limit && seen.size < count; presses++) {
    await page.keyboard.press('Tab')
    const index = await page.evaluate(() => document.activeElement?.getAttribute('data-e2e-control') ?? null)
    if (index !== null) seen.add(Number(index))
  }
  return [...Array(count).keys()].filter((i) => !seen.has(i))
}

const screens: [string, string][] = [
  ['Home', '/'],
  ['Explore', '/explore'],
  ['Search', '/search'],
  ['Library', '/library'],
  ['Live TV', '/live'],
  ['Settings', '/settings#appearance'],
  ['A film’s page', '/title/movie/157336'],
]

test.describe('tab order', () => {
  for (const [name, path] of screens) {
    test(`${name}: Tab reaches every control`, async ({ boot, page }) => {
      await boot(path)
      // Let the page finish drawing and loading what is near the screen, or controls arrive mid-walk.
      await page.waitForLoadState('networkidle')
      const count = await markControls(page)
      expect(count).toBeGreaterThan(8)
      const missed = await tabThroughAll(page, count, count * 2 + 40)
      const names = await page.evaluate((ids) => ids.map((i) => document.querySelector(`[data-e2e-control="${i}"]`)?.outerHTML.slice(0, 120)), missed)
      expect(names, 'controls Tab never reached').toEqual([])
    })
  }

  test('the first Tab stop is a skip link that moves focus to the page', async ({ boot, page }) => {
    await boot('/library')
    await page.keyboard.press('Tab')
    const skip = page.getByRole('link', { name: 'Skip to Content' })
    await expect(skip).toBeFocused()
    await page.keyboard.press('Enter')
    await expect(page.locator('main')).toBeFocused()
  })

  test('the focused control always looks different from the same control unfocused', async ({ boot, page }) => {
    await boot('/')
    await page.waitForLoadState('networkidle')
    await page.mouse.move(0, 0)
    const same: string[] = []
    for (let i = 0; i < 25; i++) {
      await page.keyboard.press('Tab')
      const target = await page.evaluateHandle(() => document.activeElement as HTMLElement)
      const label = await target.evaluate((el) => el.getAttribute('aria-label') ?? el.textContent?.trim().slice(0, 40) ?? el.tagName)
      const box = (await target.asElement()!.boundingBox())!
      // A frame, a ring or a colour change can sit just outside the control's box: look a little wider.
      const clip = { x: Math.max(0, box.x - 8), y: Math.max(0, box.y - 8), width: box.width + 16, height: box.height + 16 }
      const focused = await page.screenshot({ clip })
      await target.evaluate((el) => el.blur())
      const unfocused = await page.screenshot({ clip })
      await target.evaluate((el) => el.focus())
      if (focused.equals(unfocused)) same.push(label)
    }
    expect(same, 'controls whose look does not change when they take focus').toEqual([])
  })

  test('Tab moves on from a poster to its More button, which opens a menu that Escape closes', async ({ boot, page }) => {
    await boot('/')
    const shelf = page.getByRole('region', { name: 'Watchlist' })
    await shelf.getByRole('link', { name: /^Shōgun/ }).focus()
    await page.keyboard.press('Tab')
    const more = shelf.getByRole('button', { name: 'More options for Shōgun' })
    await expect(more).toBeFocused()
    await page.keyboard.press('Enter')
    await expect(page.getByRole('menu')).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(page.getByRole('menu')).toHaveCount(0)
    await expect(more).toBeFocused()
  })
})

test.describe('shortcuts', () => {
  test('? opens the list of shortcuts and Escape closes it', async ({ boot, page }) => {
    await boot('/')
    await expect(async () => {
      await page.keyboard.press('?')
      await expect(page.getByRole('dialog')).toBeVisible({ timeout: 500 })
    }).toPass()
    await expect(page.getByRole('dialog').getByText('Play or pause')).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(page.getByRole('dialog')).toHaveCount(0)
  })

  for (const [keys, path] of [
    ['e', '/explore'],
    ['l', '/library'],
    ['t', '/live'],
    ['s', '/settings'],
    ['h', '/'],
  ] as const) {
    test(`G then ${keys.toUpperCase()} goes to ${path}`, async ({ boot, page }) => {
      await boot(path === '/' ? '/explore' : '/')
      await expect(async () => {
        await page.keyboard.press('g')
        await page.keyboard.press(keys)
        await expect(page).toHaveURL(new RegExp(`${path === '/' ? '/$' : path}`), { timeout: 500 })
      }).toPass()
    })
  }

  test('typing in a field never triggers a shortcut', async ({ boot, page }) => {
    await boot('/search')
    await page.getByRole('searchbox', { name: 'Search' }).click()
    await page.keyboard.type('gl?e')
    await expect(page.getByRole('searchbox', { name: 'Search' })).toHaveValue('gl?e')
    await expect(page).toHaveURL(/\/search/)
    await expect(page.getByRole('dialog')).toHaveCount(0)
  })
})
