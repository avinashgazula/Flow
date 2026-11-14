import { test as base, expect, type Page, type Route } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import { dirname, join, normalize } from 'node:path'
import { fileURLToPath } from 'node:url'

/* The browser tests run against the production build with sample data (?demo) and nothing real behind it. Every
   request that leaves the preview server is answered here from a small local stand-in, and one that has no stand-in
   fails the test, so a change that starts calling out to somewhere new can't slip through. Every test also fails on a
   console error, a page error, an unhandled rejection or a failed request to the site itself, whatever it was checking. */

const here = dirname(fileURLToPath(import.meta.url))
const hls = join(here, 'fixtures', 'hls')

/** A 2x3 grey PNG. The demo data's artwork is a few hundred TMDB image addresses; one picture stands in for all. */
const picture = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAADCAIAAAA2NNKrAAAAEklEQVR4nGNgYPj/n4EBBgAAHQMC/6jX1wAAAABJRU5ErkJggg==', 'base64')

const types: Record<string, string> = { '.m3u8': 'application/vnd.apple.mpegurl', '.mp4': 'video/mp4', '.m4s': 'video/iso.segment', '.vtt': 'text/vtt' }

/** The Apple sample streams the demo data plays (master.m3u8 and bipbop_16x9_variant.m3u8 in two folders) are one local
 *  HLS stream. The playlist asks for its parts next to itself, so whatever follows the sample's folder names the file. */
async function stream(route: Route, path: string) {
  const name = /\/examples\/[^/]+\/(.+)$/.exec(path)?.[1] ?? ''
  const file = /master\.m3u8$|_variant\.m3u8$/.test(name) ? 'master.m3u8' : normalize(name)
  if (file.startsWith('..')) return route.fulfill({ status: 404 })
  try {
    const body = await readFile(join(hls, file))
    const ext = file.slice(file.lastIndexOf('.'))
    return route.fulfill({ status: 200, body, headers: { 'content-type': types[ext] ?? 'application/octet-stream', 'access-control-allow-origin': '*', 'cache-control': 'no-store' } })
  } catch {
    return route.fulfill({ status: 404 })
  }
}

export interface Report {
  console: string[]
  pageErrors: string[]
  failedRequests: string[]
  /** Requests that left the preview server with no stand-in. */
  unstubbed: string[]
}

/** Test-specific things a spec may ask for. */
export interface Options {
  /** Allow console errors whose text matches (an error a test provokes on purpose). */
  expectedConsoleErrors: RegExp[]
  /** Allow failed requests to the site itself whose "METHOD url reason" text matches (a test that cuts the network). */
  expectedFailedRequests: RegExp[]
  /** Let the site's service worker run (only the offline spec wants it). */
  workers: boolean
}

export const test = base.extend<{ report: Report; boot: (path: string) => Promise<void> } & Options>({
  expectedConsoleErrors: [[], { option: true }],
  expectedFailedRequests: [[], { option: true }],
  workers: [false, { option: true }],
  serviceWorkers: async ({ workers }, use) => use(workers ? 'allow' : 'block'),

  report: [
    async ({ page, context, baseURL, expectedConsoleErrors, expectedFailedRequests }, use) => {
      const origin = new URL(baseURL!).origin
      const report: Report = { console: [], pageErrors: [], failedRequests: [], unstubbed: [] }

      // Time is the one thing the sample data reads from the machine (what's on tonight, how long ago). Pinning it keeps
      // every run the same; it still moves forward, so timers and the player's clock behave.
      await page.clock.setFixedTime(new Date('2026-06-15T12:00:00Z'))

      // The stand-ins. A route added later by a spec wins over these, so one test can answer a request its own way.
      await context.route(
        (url) => url.origin !== origin && url.protocol.startsWith('http'),
        (route) => {
          const url = new URL(route.request().url())
          if (url.hostname === 'image.tmdb.org') return route.fulfill({ status: 200, body: picture, headers: { 'content-type': 'image/png', 'access-control-allow-origin': '*' } })
          if (url.hostname === 'devstreaming-cdn.apple.com') return stream(route, url.pathname)
          report.unstubbed.push(`${route.request().method()} ${url.origin}${url.pathname}`)
          return route.abort('blockedbyclient')
        },
      )

      // A page that is left while it is still loading has its requests cut off, and WebKit and Firefox report that as a
      // failure ("internal error", NS_BINDING_ABORTED) where Chromium says it was cancelled. Anything within a moment of
      // a navigation starting is that, not the site failing.
      let navigating = 0
      const leaving = () => Date.now() - navigating < 3000
      const cutOff = /internal error|NS_BINDING_ABORTED|NS_ERROR_ABORT|cancel/i
      page.on('request', (request) => {
        if (request.isNavigationRequest()) navigating = Date.now()
      })
      page.on('framenavigated', () => (navigating = Date.now()))

      // Errors only: browsers add warnings of their own about the page (WebKit on preload hints, for one) that are theirs to judge.
      page.on('console', (message) => {
        if (message.type() !== 'error') return
        const text = message.text()
        if (expectedConsoleErrors.some((pattern) => pattern.test(text))) return
        if (leaving() && /Failed to load resource/.test(text) && cutOff.test(text)) return
        report.console.push(`${message.type()}: ${text}`)
      })
      page.on('pageerror', (error) => report.pageErrors.push(error.message))
      // A promise nobody handled is reported by the page, not thrown into the test: relay it from inside.
      await context.exposeBinding('__e2eRejection', (_source, text: string) => void report.pageErrors.push(`unhandled rejection: ${text}`))
      await context.addInitScript(() => {
        window.addEventListener('unhandledrejection', (event) => {
          const reason = event.reason as { stack?: string; message?: string } | undefined
          void (window as unknown as { __e2eRejection: (t: string) => void }).__e2eRejection(String(reason?.stack ?? reason?.message ?? reason))
        })
      })
      page.on('requestfailed', (request) => {
        if (new URL(request.url()).origin !== origin) return
        const why = request.failure()?.errorText ?? ''
        // A request the page itself gave up on (it left the page, or the player seeked past it) isn't a failure.
        if (/abort|cancel/i.test(why)) return
        if (leaving() && cutOff.test(why)) return
        const line = `${request.method()} ${request.url()} ${why}`
        if (!expectedFailedRequests.some((pattern) => pattern.test(line))) report.failedRequests.push(line)
      })
      page.on('response', (response) => {
        if (new URL(response.url()).origin === origin && response.status() >= 400) report.failedRequests.push(`${response.status()} ${response.request().method()} ${response.url()}`)
      })

      await use(report)

      // After the test body: whatever the page did on its own while the test was looking elsewhere counts too.
      expect.soft(report.unstubbed, 'requests that left the site with no stand-in').toEqual([])
      expect.soft(report.pageErrors, 'page errors and unhandled rejections').toEqual([])
      expect.soft(report.console, 'console errors').toEqual([])
      expect.soft(report.failedRequests, 'failed requests to the site itself').toEqual([])
    },
    { auto: true },
  ],

  /** Opens a path of the site with sample data on and waits until the app has drawn its page. */
  boot: async ({ page }, use) => {
    await use(async (path) => {
      const [rest = '', hash] = path.split('#')
      await page.goto(`${rest}${rest.includes('?') ? '&' : '?'}demo${hash === undefined ? '' : `#${hash}`}`)
      await page.locator('#root > *').first().waitFor({ state: 'attached' })
    })
  },
})

export { expect }
export type { Page }
