import { test, expect, type Page } from '../fixtures'
import { readFacts } from './facts'
import { offer, startPlaying } from './harness'

/* What doesn't play, and what the site says about it (README: "Converting a picture the browser can't decode", "Limits of a
   browser"). It says it in two places, and both are checked: the picker, which knows from the release name and greys the
   row with its reason, and the player, which looks inside the file when the name said nothing and shows "Couldn't Play"
   with what to do next. */

/** The reason on a greyed row of the picker. */
async function pickerReason(page: Page, boot: (path: string) => Promise<void>) {
  const row = (await startPlaying(page, boot)).first()
  await expect(row).toHaveAttribute('aria-disabled', 'true')
  return row.innerText()
}

/** Plays the first row and returns the player's error. */
async function playerMessage(page: Page, boot: (path: string) => Promise<void>) {
  const row = (await startPlaying(page, boot)).first()
  await expect(row).not.toHaveAttribute('aria-disabled', 'true')
  await row.click()
  const alert = page.getByRole('alertdialog')
  await expect(alert).toBeVisible({ timeout: 40_000 })
  await expect(alert.getByRole('heading', { name: 'Couldn’t Play' })).toBeVisible()
  return alert.locator('#player-error-message').innerText()
}

/** Where a browser decodes HEVC itself the file plays as it is and nothing is converted, so there is nothing to refuse. */
async function needsConversion(page: Page) {
  await page.goto('/?demo')
  const facts = await readFacts(page)
  return !facts.mseHevc
}

test.describe('the picker says it when the release name shows the file can’t play', () => {
  test('a 4K picture that would need converting is too much', async ({ boot, page }) => {
    test.skip(!(await needsConversion(page)), 'this browser decodes HEVC itself, so 4K plays as it is')
    await offer(page, [{ release: 'Matrix.2160p.BluRay.x265.mkv', file: 'x-mkv-hevc-4k.mkv' }])
    expect(await pickerReason(page, boot)).toContain('4K HEVC video is too much to convert in a browser')
  })

  test('HDR that would need converting is refused', async ({ boot, page }) => {
    test.skip(!(await needsConversion(page)), 'this browser decodes HEVC itself, so HDR plays as it is')
    await offer(page, [{ release: 'Matrix.480p.BluRay.HDR10.x265.AAC.mkv', file: 'committed/x-mkv-hevc-hdr10-aac.mkv' }])
    expect(await pickerReason(page, boot)).toContain('HEVC HDR video can’t be converted in a browser')
  })

  test('without a VideoEncoder a picture the browser can’t decode can’t play', async ({ boot, page }) => {
    await page.addInitScript(() => {
      delete (window as unknown as { VideoEncoder?: unknown }).VideoEncoder
    })
    await offer(page, [{ release: 'Matrix.480p.DVDRip.MP3.XviD.avi', file: 'c-avi-xvid-mp3.avi' }])
    expect(await pickerReason(page, boot)).toContain('XviD video can’t play in a browser')
  })

  test('a disc image has nothing to play', async ({ boot, page }) => {
    await offer(page, [{ release: 'Matrix.1080p.BluRay.iso', file: 'r-mkv-h264-aac.mkv', path: 'Matrix.1080p.BluRay.iso' }])
    expect(await pickerReason(page, boot)).toMatch(/disc image/i)
  })
})

test.describe('the player says it when the file is the one that shows it', () => {
  test('a 4K picture is refused, with a smaller source or the app to use instead', async ({ boot, page }) => {
    test.skip(!(await needsConversion(page)), 'this browser decodes HEVC itself, so 4K plays as it is')
    await offer(page, [{ release: 'Matrix.mkv', file: 'x-mkv-hevc-4k.mkv' }])
    expect(await playerMessage(page, boot)).toBe('This browser can’t decode HEVC video at 3840×2160, and that is too much to convert as it plays. Try a 1080p or smaller source, or watch it in the Marquee app.')
  })

  test('HDR is refused, because an 8-bit copy would come out washed out', async ({ boot, page }) => {
    test.skip(!(await needsConversion(page)), 'this browser decodes HEVC itself, so HDR plays as it is')
    await offer(page, [{ release: 'Matrix.mkv', file: 'committed/x-mkv-hevc-hdr10-aac.mkv' }])
    expect(await playerMessage(page, boot)).toBe('This browser can’t decode HEVC HDR video, and converting it would wash out its colours. Try an SDR source, or watch it in the Marquee app.')
  })

  test('with no VideoEncoder the file fails and says where to open it instead', async ({ boot, page }) => {
    await page.addInitScript(() => {
      delete (window as unknown as { VideoEncoder?: unknown }).VideoEncoder
    })
    await offer(page, [{ release: 'Matrix.avi', file: 'c-avi-xvid-mp3.avi' }])
    expect(await playerMessage(page, boot)).toMatch(/no video encoder to convert it with\. Try another source, or open Marquee in Chrome, Edge or Safari\.$/)
  })
})

/* A browser can say it encodes H.264 and then not do it. The engine runs in a worker, which a page script can't reach, so the
   test puts a stand-in VideoEncoder at the top of the worker's own script as it is served. */
type Breakage = 'never answers' | 'throws when configured' | 'reports an error after the first picture'

const standIn = (how: Breakage) => `
globalThis.VideoEncoder = class {
  static async isConfigSupported(config) { return { supported: true, config } }
  constructor(init) { this.init = init; this.encodeQueueSize = 0; this.state = 'unconfigured' }
  configure() { ${how === 'throws when configured' ? "throw new DOMException('This configuration is not supported.', 'NotSupportedError')" : "this.state = 'configured'"} }
  encode() { this.encodeQueueSize++; ${how === 'reports an error after the first picture' ? "setTimeout(() => this.init.error(new DOMException('Encoding failed.', 'EncodingError')), 50)" : ''} }
  flush() { return new Promise(() => {}) }
  addEventListener() {}
  close() {}
}
`

async function breakEncoder(page: Page, how: Breakage) {
  await page.route(/\/assets\/worker-[^/]+\.js$/, async (route) => {
    const response = await route.fetch()
    const body = await response.text()
    await route.fulfill({ response, body: body.includes('Marquee media: picture encoder') ? standIn(how) + body : body })
  })
}

test.describe('an encoder that claims H.264 and then fails ends in the message, not a spinner', () => {
  const promised = /Try another source/
  for (const how of ['never answers', 'throws when configured', 'reports an error after the first picture'] as const) {
    test(`a VideoEncoder that ${how}`, async ({ boot, page }) => {
      test.setTimeout(90_000)
      await breakEncoder(page, how)
      await offer(page, [{ release: 'Matrix.avi', file: 'c-avi-xvid-mp3.avi' }])
      const text = await playerMessage(page, boot)
      console.log('MESSAGE', how, JSON.stringify(text))
      expect(text).toMatch(promised)
    })
  }
})
