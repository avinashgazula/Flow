import { expect, type Page } from '@playwright/test'

export interface VideoState {
  time: number
  paused: boolean
  duration: number
  rate: number
  ready: number
}

/** What the page's one <video> is doing, read straight from the element. */
export const videoState = (page: Page) =>
  page.evaluate<VideoState | null>(() => {
    const v = document.querySelector('video')
    return v ? { time: v.currentTime, paused: v.paused, duration: v.duration, rate: v.playbackRate, ready: v.readyState } : null
  })

/** Waits until the picture has begun and its clock is running forward: two readings, a moment apart, that differ. */
export async function expectPlaying(page: Page) {
  await expect.poll(async () => (await videoState(page))?.ready ?? 0, { message: 'the video has data to show', timeout: 20_000 }).toBeGreaterThanOrEqual(3)
  const before = (await videoState(page))!.time
  await expect.poll(async () => (await videoState(page))!.time, { message: 'the video’s clock advances', timeout: 15_000 }).toBeGreaterThan(before + 0.3)
  expect((await videoState(page))!.paused).toBe(false)
}

/** The player's controls fade after a moment. A mouse brings them back by moving; a finger by tapping the picture. */
export async function wake(page: Page) {
  const idle = page.locator('[data-idle]')
  if ((await idle.count()) === 0) return
  const { width, height } = page.viewportSize()!
  if (await page.evaluate(() => matchMedia('(pointer: coarse)').matches)) await page.touchscreen.tap(width / 2, height / 2)
  else {
    await page.mouse.move(width / 2, height / 2)
    await page.mouse.move(width / 2 + 12, height / 2 + 12)
  }
  await expect(idle).toHaveCount(0)
}

/** Opens a path in the player and plays the first source in the picker, which the sample data puts at the top. */
export async function playFirstSource(page: Page) {
  await page.getByRole('option', { name: /1080p.*WEB-DL/ }).click()
  await expectPlaying(page)
}

/** The player's panel buttons are in the controls bar. A phone shows them behind the same names. */
export const control = (page: Page, name: string | RegExp) => page.getByRole('button', { name, exact: typeof name === 'string' })
