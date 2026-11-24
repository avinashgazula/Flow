import { test, expect } from './fixtures'

/* Settings → Account → Use This Account in the App: the link and QR code that log the apps in. The account here is
   made up (a fixed fake number and a Worker that doesn't exist), and the Worker's answers are stubbed. */

const number = '1234567890123456'
const link = 'flow://account?n=1234567890123456&s=https%3A%2F%2Fexample.workers.dev'

// The stubbed Worker answers every request with an error, which the browser logs.
test.use({ expectedConsoleErrors: /Failed to load resource/ })

test.beforeEach(async ({ context, page }) => {
  await context.addInitScript(
    ([n]) => {
      try {
        if (!localStorage.getItem('flow.account.v1')) localStorage.setItem('flow.account.v1', JSON.stringify({ number: n, server: 'https://example.workers.dev', revs: {}, hashes: {}, metas: {} }))
      } catch {
        // The test then fails at the first step, which is the right place to say so.
      }
    },
    [number],
  )
  await page.route('https://example.workers.dev/**', (route) => route.fulfill({ status: 503, headers: { 'access-control-allow-origin': '*' }, body: '' }))
})

test('the link and its code stay hidden until Show, then name the app link and nothing else', async ({ boot, page }) => {
  await boot('/settings#account')
  const group = page.getByText('Use This Account in the App').locator('xpath=ancestor::*[@data-settings-group]')
  await expect(group).toBeVisible()
  await expect(page.locator('[data-account-app-link]')).toHaveCount(0)
  await expect(group.getByRole('img')).toHaveCount(0)
  await expect(page.locator('body')).not.toContainText('example.workers.dev')

  await group.getByRole('button', { name: 'Show' }).click()
  await expect(group.getByText(/Anyone with this link can open your account/)).toBeVisible()
  const open = group.getByRole('link', { name: 'Open in Marquee' })
  await expect(open).toHaveAttribute('href', link)
  await expect(group.getByRole('img', { name: /QR code/ })).toBeVisible()
  // The number is on the page only through the link, never in the address.
  expect(page.url()).not.toContain(number)
  expect(page.url()).not.toContain('example.workers.dev')

  await group.getByRole('button', { name: 'Hide' }).click()
  await expect(page.locator('[data-account-app-link]')).toHaveCount(0)
  await expect(group.getByRole('img')).toHaveCount(0)
})

test('the section is not there without an account', async ({ boot, page }) => {
  await page.context().addInitScript(() => {
    try {
      localStorage.removeItem('flow.account.v1')
    } catch {
      // Nothing was stored.
    }
  })
  await boot('/settings#account')
  await expect(page.getByRole('region', { name: 'Account', exact: true })).toBeVisible()
  await expect(page.getByText('Use This Account in the App')).toHaveCount(0)
})
