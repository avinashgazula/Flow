import { test, expect } from '../fixtures'
import { readFacts } from './facts'
import { offer, startPlaying } from './harness'

/* What doesn't play, and what the site says about it (README: "Converting a picture the browser can't decode", "Limits of a
   browser"). Each refusal is checked where the viewer meets it: the picker's row for a file that can't play, or the player's
   "Couldn't Play" message, which says what to do next. */

async function message(page: import('../fixtures').Page, boot: (path: string) => Promise<void>) {
  const rows = await startPlaying(page, boot)
  await rows.first().click()
  const alert = page.getByRole('alertdialog')
  await expect(alert).toBeVisible({ timeout: 40_000 })
  await expect(alert.getByRole('heading', { name: 'Couldn’t Play' })).toBeVisible()
  return alert.locator('#player-error-message').innerText()
}

test.describe('what the browser can’t convert', () => {
  test('a picture above 1080p that needs converting is refused at once, with what to do', async ({ boot, page }) => {
    await page.goto('/?demo')
    const facts = await readFacts(page)
    test.skip(facts.mseHevc, 'this browser decodes HEVC itself, so the 4K file plays as it is and is never converted')
    await offer(page, [{ release: 'Matrix.2160p.BluRay.x265.mkv', file: 'x-mkv-hevc-4k.mkv' }])
    const text = await message(page, boot)
    expect(text).toMatch(/1080p|Marquee app/)
  })

  test('HDR that needs converting is refused, because an 8-bit copy would come out washed out', async ({ boot, page }) => {
    await page.goto('/?demo')
    const facts = await readFacts(page)
    test.skip(facts.mseHevc, 'this browser decodes HEVC itself, so the HDR file plays as it is and is never converted')
    await offer(page, [{ release: 'Matrix.480p.BluRay.HDR10.x265.AAC.mkv', file: 'x-mkv-hevc-hdr10-aac.mkv' }])
    const text = await message(page, boot)
    expect(text).toMatch(/SDR|HDR/)
    expect(text).toMatch(/Marquee app|1080p|SDR source/)
  })

  test('with no VideoEncoder a picture the browser can’t play fails with the reason and where to open it instead', async ({ boot, page }) => {
    await page.addInitScript(() => {
      delete (window as unknown as { VideoEncoder?: unknown }).VideoEncoder
    })
    await offer(page, [{ release: 'Matrix.480p.DVDRip.MP3.XviD.avi', file: 'c-avi-xvid-mp3.avi' }])
    const text = await message(page, boot)
    expect(text).toBe('no video encoder to convert it with. Try another source, or open Marquee in Chrome, Edge or Safari.')
  })
})

test.describe('what is not a film file', () => {
  test('a disc image is listed as unplayable and can’t be started', async ({ boot, page }) => {
    await offer(page, [{ release: 'Matrix.1080p.BluRay.iso', file: 'r-mkv-h264-aac.mkv' }])
    await boot('/watch/movie/157336')
    const picker = page.getByRole('dialog', { name: 'Sources for Interstellar' })
    await picker.getByRole('toolbar', { name: 'Filter sources' }).getByRole('button', { name: 'Matrix' }).click()
    const row = picker.getByRole('option')
    await expect(row).toHaveCount(1)
    await expect(row).toBeDisabled()
    await expect(row).toContainText(/disc image/i)
  })
})
