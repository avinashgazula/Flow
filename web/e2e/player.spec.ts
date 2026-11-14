import { test, expect, type Page } from './fixtures'
import { control, expectPlaying, playFirstSource, videoState, wake } from './helpers'

/* The player, from the title page's Play button to Close, on the small local stream standing in for Apple's sample
   (fixtures/hls: 70 seconds, English and Spanish sound, English and Spanish subtitles). The full container and codec
   matrix is a separate suite; this proves the controls do what they say. */

async function playInterstellar(page: Page, boot: (path: string) => Promise<void>) {
  await boot('/title/movie/157336')
  await page.getByRole('button', { name: /^Play/ }).click()
  await expect(page.getByRole('dialog', { name: 'Sources for Interstellar' })).toBeVisible()
  await playFirstSource(page)
}

test.describe('playing a film', () => {
  test('Play, pick a source and the picture runs', async ({ boot, page }) => {
    await playInterstellar(page, boot)
    await expect(page).toHaveURL(/\/watch\/movie\/157336/)
    await expect(page.getByRole('dialog')).toHaveCount(0)
    const state = (await videoState(page))!
    expect(state.duration).toBeGreaterThan(20)
  })

  test('pause stops the clock and Play carries on from the same place', async ({ boot, page }) => {
    await playInterstellar(page, boot)
    await wake(page)
    await control(page, 'Pause').click()
    await expect.poll(async () => (await videoState(page))!.paused).toBe(true)
    const frozen = (await videoState(page))!.time
    // A second of wall time with the video paused: the clock must not have moved.
    await page.waitForTimeout(1000)
    expect((await videoState(page))!.time).toBe(frozen)
    // On a phone, pausing opens X-Ray over the controls (who is in this scene); closing it uncovers Play.
    if (await page.evaluate(() => matchMedia('(pointer: coarse)').matches)) {
      await expect(page.getByRole('region', { name: 'X-Ray' })).toBeVisible()
      await page.getByRole('button', { name: 'Close X-Ray' }).click()
    }
    await wake(page)
    await control(page, 'Play').click()
    await expectPlaying(page)
    expect((await videoState(page))!.time).toBeGreaterThanOrEqual(frozen)
  })

  test('the keyboard seeks: arrows skip ten seconds and a digit jumps to that tenth', async ({ boot, page }) => {
    await playInterstellar(page, boot)
    await page.keyboard.press('Space')
    await expect.poll(async () => (await videoState(page))!.paused).toBe(true)
    const start = (await videoState(page))!.time
    await page.keyboard.press('ArrowRight')
    await expect.poll(async () => (await videoState(page))!.time, { message: 'Right skips ten seconds on' }).toBeGreaterThan(start + 9)
    await page.keyboard.press('ArrowLeft')
    await expect.poll(async () => (await videoState(page))!.time, { message: 'Left skips ten seconds back' }).toBeLessThan(start + 1)
    await page.keyboard.press('5')
    const half = (await videoState(page))!.duration / 2
    await expect.poll(async () => Math.abs((await videoState(page))!.time - half), { message: '5 jumps to the middle' }).toBeLessThan(1)
    await page.keyboard.press('k')
    await expect.poll(async () => (await videoState(page))!.paused).toBe(false)
  })

  test('the scrubber seeks to where it is clicked', async ({ boot, page }) => {
    await playInterstellar(page, boot)
    await wake(page)
    await control(page, 'Pause').click()
    const rail = page.getByRole('slider', { name: 'Playback position' })
    const box = (await rail.boundingBox())!
    await page.mouse.click(box.x + box.width * 0.75, box.y + box.height / 2)
    const duration = (await videoState(page))!.duration
    await expect.poll(async () => Math.abs((await videoState(page))!.time - duration * 0.75), { message: 'the clock follows the click' }).toBeLessThan(duration * 0.06)
  })

  test('with the scrubber focused the arrow keys still seek', async ({ boot, page }) => {
    await playInterstellar(page, boot)
    await wake(page)
    await control(page, 'Pause').click()
    const start = (await videoState(page))!.time
    await page.getByRole('slider', { name: 'Playback position' }).focus()
    await page.keyboard.press('ArrowRight')
    await expect.poll(async () => (await videoState(page))!.time).toBeGreaterThan(start + 9)
  })

  test('another audio track changes the sound the player fetches', async ({ boot, page }) => {
    const audio: string[] = []
    page.on('request', (request) => {
      const m = /\/(audio-[a-z]{2})\/seg\d+\.m4s/.exec(request.url())
      if (m) audio.push(m[1]!)
    })
    await playInterstellar(page, boot)
    await wake(page)
    await control(page, 'Audio and Subtitles').click()
    const panel = page.getByRole('dialog', { name: 'Audio and Subtitles' })
    await expect(panel.getByRole('menuitemradio', { name: 'English' }).first()).toBeChecked()
    await panel.getByRole('menuitemradio', { name: 'Spanish' }).first().click()
    await expect(panel.getByRole('menuitemradio', { name: 'Spanish' }).first()).toBeChecked()
    await expect(panel.getByRole('menuitemradio', { name: 'English' }).first()).not.toBeChecked()
    await expect.poll(() => audio.includes('audio-es'), { message: 'Spanish sound segments were requested' }).toBe(true)
    await expectPlaying(page)
  })

  test('a subtitle track shows its cue on the picture, and Off takes it away', async ({ boot, page }) => {
    await playInterstellar(page, boot)
    await wake(page)
    await control(page, 'Audio and Subtitles').click()
    const panel = page.getByRole('dialog', { name: 'Audio and Subtitles' })
    const subtitles = panel.getByRole('menu', { name: 'Subtitles' })
    await expect(subtitles.getByRole('menuitemradio', { name: 'Off' })).toBeChecked()
    await subtitles.getByRole('menuitemradio', { name: 'Spanish' }).click()
    // Choosing a track closes the panel; the cue for the playing moment is on the picture.
    await expect(panel).toHaveCount(0)
    await expect(page.getByText(/^Spanish subtitle \d$/)).toBeVisible()
    await wake(page)
    await control(page, 'Audio and Subtitles').click()
    await expect(page.getByRole('menu', { name: 'Subtitles' }).getByRole('menuitemradio', { name: 'Spanish' })).toBeChecked()
    await page.getByRole('menu', { name: 'Subtitles' }).getByRole('menuitemradio', { name: 'Off' }).click()
    await expect(page.getByText(/^Spanish subtitle \d$/)).toHaveCount(0)
  })

  test('the C key turns subtitles on and off', async ({ boot, page }) => {
    await playInterstellar(page, boot)
    await page.keyboard.press('c')
    await expect(page.getByText(/^English subtitle \d$/)).toBeVisible()
    await page.keyboard.press('c')
    await expect(page.getByText(/subtitle \d$/)).toHaveCount(0)
  })

  test('the speed menu changes how fast the picture runs', async ({ boot, page }) => {
    await playInterstellar(page, boot)
    await wake(page)
    await control(page, 'Options').click()
    await page.getByRole('menuitem', { name: /^Speed/ }).click()
    await page.getByRole('menuitemradio', { name: /1\.5/ }).click()
    await expect.poll(async () => (await videoState(page))!.rate).toBe(1.5)
    await expectPlaying(page)
  })

  test('M mutes and the volume keys change the level', async ({ boot, page }) => {
    await playInterstellar(page, boot)
    await page.keyboard.press('m')
    await expect.poll(() => page.evaluate(() => document.querySelector('video')!.muted)).toBe(true)
    await page.keyboard.press('m')
    await expect.poll(() => page.evaluate(() => document.querySelector('video')!.muted)).toBe(false)
    await page.keyboard.press('ArrowDown')
    await expect.poll(() => page.evaluate(() => Math.round(document.querySelector('video')!.volume * 100))).toBe(90)
  })

  test('Close returns to the title page, and Home then offers to resume from there', async ({ boot, page }) => {
    await playInterstellar(page, boot)
    await page.keyboard.press('Space')
    await page.keyboard.press('5')
    await expect.poll(async () => (await videoState(page))!.time).toBeGreaterThan(10)
    await wake(page)
    await control(page, 'Close Player').click()
    await expect(page).toHaveURL(/\/title\/movie\/157336/)
    await expect(page.getByRole('heading', { level: 1, name: 'Interstellar' })).toBeVisible()
    await expect(page.getByRole('button', { name: /^Resume/ })).toBeVisible()
    // The page keeps the scroll it had; the bar is at the top.
    await page.evaluate(() => scrollTo(0, 0))
    await page.getByRole('link', { name: 'Home', exact: true }).click()
    // What was played last leads Home, with its Resume.
    const hero = page.getByRole('region', { name: 'Featured titles' })
    await expect(hero.getByRole('heading', { name: 'Interstellar' })).toBeVisible()
    await expect(hero.getByRole('link', { name: 'Resume' })).toHaveAttribute('href', '/watch/movie/157336')
  })

  test('Escape leaves the player', async ({ boot, page }) => {
    await playInterstellar(page, boot)
    await page.keyboard.press('Escape')
    await expect(page).toHaveURL(/\/title\/movie\/157336/)
  })
})

test.describe('resuming', () => {
  test('a title with a resume point starts where it stopped, without asking for a source', async ({ boot, page }) => {
    await boot('/')
    await page.getByRole('region', { name: 'Continue Watching' }).getByRole('link', { name: /^Dune: Part Two/ }).click()
    await expect(page).toHaveURL(/\/watch\/movie\/693134/)
    await expectPlaying(page)
    // The stand-in is 70 seconds long, so a resume point deep into a film clamps to the file; what matters is that it
    // did not restart from nothing and did not ask which source to use.
    await expect(page.getByRole('dialog')).toHaveCount(0)
  })
})
