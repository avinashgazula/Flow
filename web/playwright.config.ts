import { defineConfig, devices, type Project } from '@playwright/test'

/* Browser tests: the production build (dist/, made by `npm run build`) served by `vite preview`, with the sample data.
   `npm run e2e` runs Chromium, the one browser every machine here has; CI runs each of the three in its own job with
   E2E_BROWSERS=chromium|firefox|webkit. Each browser is tried as a desktop window and as a phone. */

const port = 4783
const browsers = (process.env.E2E_BROWSERS ?? 'chromium').split(',').map((b) => b.trim())

// The preinstalled Chromium here is found by Playwright itself; an odd machine can point at its own build.
const executablePath = process.env.E2E_CHROMIUM_PATH

const engines: Record<string, { desktop: Project['use']; phone: Project['use'] }> = {
  chromium: {
    desktop: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 }, launchOptions: { executablePath } },
    phone: { ...devices['Pixel 7'], viewport: { width: 390, height: 844 }, launchOptions: { executablePath } },
  },
  firefox: {
    desktop: { ...devices['Desktop Firefox'], viewport: { width: 1440, height: 900 } },
    // Firefox has no mobile emulation; a narrow viewport with touch is what the phone layout reads.
    phone: { ...devices['Desktop Firefox'], viewport: { width: 390, height: 844 }, hasTouch: false },
  },
  webkit: {
    desktop: { ...devices['Desktop Safari'], viewport: { width: 1440, height: 900 } },
    phone: { ...devices['iPhone 14'], viewport: { width: 390, height: 844 } },
  },
}

const projects: Project[] = browsers.flatMap((browser) => {
  const use = engines[browser]
  if (!use) throw new Error(`E2E_BROWSERS names an unknown browser: ${browser}`)
  return [
    { name: `${browser}-desktop`, use: use.desktop, metadata: { phone: false } },
    { name: `${browser}-phone`, use: use.phone, metadata: { phone: true } },
  ]
})

export default defineConfig({
  testDir: './e2e',
  testMatch: '**/*.spec.ts',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  // No blanket retries: a test that needs one is a flake, and CI lists it in the job summary.
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 2 : undefined,
  timeout: 45_000,
  expect: { timeout: 10_000 },
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }], ['json', { outputFile: 'test-results/results.json' }]] : [['list']],
  use: {
    baseURL: `http://localhost:${port}`,
    trace: 'on-first-retry',
    locale: 'en-US',
    timezoneId: 'UTC',
    colorScheme: 'light',
  },
  projects,
  webServer: {
    command: `npx vite preview --port ${port} --strictPort --host localhost`,
    url: `http://localhost:${port}/`,
    reuseExistingServer: false,
    timeout: 60_000,
  },
})
