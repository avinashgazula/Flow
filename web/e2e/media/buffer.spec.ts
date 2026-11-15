import { test, expect } from '../fixtures'
import { offer, startPlaying } from './harness'

/* A browser can say it plays a format in MediaSource and then refuse the data (Firefox with FLAC or MP3 in MP4: "Media resource
   could not be decoded"). Whatever the engine wrote, the viewer must end on the player's message with a way out. */

test('a browser that refuses the sound the engine converted ends in the message, with Try Another Source', async ({ boot, page }) => {
  await page.addInitScript(() => {
    const add = MediaSource.prototype.addSourceBuffer
    MediaSource.prototype.addSourceBuffer = function (mime: string) {
      const buffer = add.call(this, mime)
      // Converted sound is FLAC where the browser lists it, so the stand-in refuses what is appended to that buffer.
      if (/flac/.test(mime)) {
        buffer.appendBuffer = () => {
          throw new DOMException('The buffer refused the data.', 'EncodingError')
        }
      }
      return buffer
    }
  })
  await offer(page, [{ release: 'Matrix.avi', file: 'u-avi-h264-mp3-ac3.avi' }])
  const row = (await startPlaying(page, boot)).first()
  await row.click()
  const alert = page.getByRole('alertdialog')
  await expect(alert).toBeVisible({ timeout: 40_000 })
  await expect(alert.locator('#player-error-message')).toContainText(/Try another source/)
  await expect(alert.getByRole('button', { name: 'Try Another Source' })).toBeVisible()
})
