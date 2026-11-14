import { test, expect } from './fixtures'

/* A first visit: no key, no sample data, nothing saved. The welcome page is the whole site until a catalogue is chosen. */

test.describe('first run', () => {
  test('a first visit shows only the welcome page, with Continue waiting for a key', async ({ page }) => {
    await page.goto('/')
    await expect(page.getByRole('heading', { level: 1, name: 'Marquee' })).toBeVisible()
    await expect(page.getByRole('link', { name: 'Explore', exact: true })).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Continue' })).toBeDisabled()
    await page.getByLabel('TMDB API Key').fill('abc')
    await expect(page.getByRole('button', { name: 'Continue' })).toBeEnabled()
  })

  test('Explore with Sample Data opens Home with the sample shelves, and the choice survives a reload', async ({ page }) => {
    await page.goto('/')
    await page.getByRole('button', { name: 'Explore with Sample Data' }).click()
    await expect(page.getByRole('heading', { level: 1, name: 'This Afternoon' })).toBeVisible()
    await expect(page.getByRole('region', { name: 'Continue Watching' })).toBeVisible()
    await expect(page.getByRole('link', { name: /Sample data is on/ })).toBeVisible()
    await page.reload()
    await expect(page.getByRole('heading', { level: 1, name: 'This Afternoon' })).toBeVisible()
  })

  test.describe('a refused key', () => {
    // The browser logs the 401 it was given, which is the point of the test.
    test.use({ expectedConsoleErrors: [/status of 401/] })
    test('stays on the welcome page and says what to do', async ({ page }) => {
      await page.route('https://api.themoviedb.org/3/configuration**', (route) => route.fulfill({ status: 401, json: { status_message: 'Invalid API key' } }))
      await page.goto('/')
      await page.getByLabel('TMDB API Key').fill('not-a-key')
      await page.getByRole('button', { name: 'Continue' }).click()
      await expect(page.getByText('TMDB didn’t accept that key. Check it and try again.')).toBeVisible()
      await expect(page.getByRole('link', { name: 'Explore', exact: true })).toHaveCount(0)
    })
  })

  test('a key TMDB accepts opens the site', async ({ page }) => {
    await page.route('https://api.themoviedb.org/3/configuration**', (route) => route.fulfill({ json: { images: {} } }))
    // Home asks TMDB for its shelves next: an empty answer is enough to show the site opened.
    await page.route('https://api.themoviedb.org/3/**', (route) => (route.request().url().includes('/configuration') ? route.fallback() : route.fulfill({ json: { page: 1, results: [], total_pages: 1, total_results: 0 } })))
    await page.goto('/')
    await page.getByLabel('TMDB API Key').fill('0123456789abcdef0123456789abcdef')
    await page.getByRole('button', { name: 'Continue' }).click()
    await expect(page.getByRole('heading', { level: 1, name: 'This Afternoon' })).toBeVisible()
    await expect(page.getByRole('link', { name: 'Search' }).first()).toBeVisible()
    await expect(page.getByLabel('TMDB API Key')).toHaveCount(0)
  })

  test('the setup, account and sync alternatives open and come back', async ({ page }) => {
    await page.goto('/')
    await page.getByRole('button', { name: /I Have a Setup From Another Device/ }).click()
    await expect(page.getByRole('button', { name: 'Choose File' })).toBeVisible()
    await page.getByRole('button', { name: 'Back' }).click()
    await expect(page.getByLabel('TMDB API Key')).toBeVisible()
    await page.getByRole('button', { name: /Join Marquee Sync/ }).click()
    await expect(page.getByLabel('TMDB API Key')).toHaveCount(0)
  })
})
