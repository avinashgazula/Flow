import { test, expect, type Page } from './fixtures'

/* After one visit the site's own files are kept by its service worker, so it opens with the network off, and says so
   instead of showing a blank page when it can't. This is the one spec that lets the worker run. */

test.describe('offline', () => {
  test.use({
    workers: true,
    // A typeface no earlier page used was never saved, so with the network cut the browser can't fetch it and says so:
    // the page falls back to the system face, which is the design (README, "Installing and offline"). Nothing else may fail.
    expectedFailedRequests: /\.woff2 /,
    expectedConsoleErrors: /Failed to load resource|downloadable font: download failed/,
  })

  /** Visits a page, waits for the worker to install, fill its cache and take the page over (it does on the first reload). */
  async function installed(page: Page, boot: (path: string) => Promise<void>, path: string) {
    await boot(path)
    await page.evaluate(() => navigator.serviceWorker.ready)
    await expect.poll(() => page.evaluate(async () => (await caches.keys()).length), { message: 'the worker has made its cache' }).toBeGreaterThan(0)
    await page.reload()
    await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller), { message: 'the worker controls the page' }).toBe(true)
  }

  /* Chromium cuts the network under the worker, so the worker's own answer is what opens the page. Firefox and WebKit fail
     a navigation made while offline before the worker is asked (Playwright's offline switch, not the site), so there the
     test looks at what the worker has saved: the shell, the offline page and the site's own code, which is all it answers with. */
  async function saved(page: Page) {
    return page.evaluate(async () => {
      const scope = new URL('./', location.href).href
      const entry = [...document.scripts].map((s) => s.src).find((src) => /\/assets\/index-/.test(src))
      return { shell: !!(await caches.match(scope)), offline: !!(await caches.match(new URL('offline.html', scope).href)), entry: !!entry && !!(await caches.match(entry)) }
    })
  }

  test('after a first load the app shell opens with the network off', async ({ boot, page, context, browserName }) => {
    await installed(page, boot, '/')
    expect(await saved(page)).toEqual({ shell: true, offline: true, entry: true })
    if (browserName !== 'chromium') return
    await context.setOffline(true)
    await page.reload()
    // The shell is back from the cache, with Home drawn from the sample data saved on this device.
    await expect(page.getByRole('link', { name: 'Marquee home' })).toBeVisible()
    await expect(page.getByRole('heading', { level: 1, name: 'This Afternoon' })).toBeVisible()
    await expect(page.getByRole('region', { name: 'Continue Watching' })).toBeVisible()
    await context.setOffline(false)
  })

  test('another page’s address opens offline too, because the saved shell routes it', async ({ boot, page, context, browserName }) => {
    await installed(page, boot, '/explore')
    expect((await saved(page)).shell).toBe(true)
    if (browserName !== 'chromium') return
    await context.setOffline(true)
    await page.goto('/library?demo')
    await expect(page.getByRole('heading', { level: 1, name: 'Library' })).toBeVisible()
    await context.setOffline(false)
  })

  test('with the shell gone from the cache and no network, the offline page says so instead of a blank page', async ({ boot, page, context, browserName }) => {
    await installed(page, boot, '/')
    // What a cleared or evicted cache leaves: the worker still runs, but the saved shell is missing.
    await page.evaluate(async () => {
      for (const name of await caches.keys()) {
        const cache = await caches.open(name)
        await cache.delete(new URL('./', location.href).href)
        await cache.delete(new URL('./index.html', location.href).href)
      }
    })
    expect(await saved(page)).toMatchObject({ shell: false, offline: true })
    if (browserName !== 'chromium') {
      // The offline page itself is a real page the worker holds: it reads as one.
      await page.goto('/offline.html')
      await expect(page.getByRole('heading', { name: 'You’re offline' })).toBeVisible()
      return
    }
    await context.setOffline(true)
    await page.goto('/explore')
    await expect(page.getByRole('heading', { name: 'You’re offline' })).toBeVisible()
    await expect(page).toHaveTitle('Marquee Is Offline')
    await context.setOffline(false)
  })
})
