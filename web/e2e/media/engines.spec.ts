import { test, expect } from '../fixtures'
import { readFacts } from './facts'
import { expectHeard, expectSeek, offer, pickAndPlay, playbackInfo } from './harness'

/* One file for each way the site plays something, opened through the real player (add-on → picker → player) and checked
   in the page: the engine Playback Info names, a clock that runs, sound that is the clip's tone, and a seek that lands. The
   whole container and codec matrix is matrix.spec.ts; this is the short list that says each path is alive. */

const paths = [
  { path: 'the browser’s own player', release: 'Matrix.480p.WEB-DL.AAC.H264.mp4', file: 'n-mp4-h264-aac.mp4', engine: /^Browser’s own player$/ },
  { path: 'the Matroska remuxer', release: 'Matrix.480p.WEB-DL.AAC.H264.mkv', file: 'r-mkv-h264-aac.mkv', engine: /^Matroska remux$/ },
  { path: 'the FFmpeg engine', release: 'Matrix.480p.WEB-DL.AAC.H264.avi', file: 'u-avi-h264-mp3.avi', engine: /^FFmpeg engine$/ },
  { path: 'video conversion', release: 'Matrix.480p.DVDRip.MP3.XviD.avi', file: 'c-avi-xvid-mp3.avi', engine: /^FFmpeg engine$/, video: /Converted to H\.264$/ },
] as const

for (const p of paths) {
  test(`${p.path} plays ${p.file}`, async ({ boot, page }) => {
    await offer(page, [{ release: p.release, file: p.file }])
    await pickAndPlay(page, boot)
    const info = await playbackInfo(page)
    expect(info.Engine).toMatch(p.engine)
    if ('video' in p) expect(info.Video).toMatch(p.video)
    await expectHeard(page, 440)
    await expectSeek(page)
  })
}

test('an HLS stream plays in hls.js, or in the browser itself where it plays HLS (Safari)', async ({ boot, page }) => {
  await page.goto('/?demo')
  const { nativeHls } = await readFacts(page)
  await page.waitForLoadState('networkidle')
  await offer(page, [{ release: 'Matrix.480p.WEB-DL.AAC.H264.m3u8', file: 'hls/master.m3u8' }])
  await pickAndPlay(page, boot)
  const info = await playbackInfo(page)
  expect(info.Engine).toBe(nativeHls ? 'Browser’s own player' : 'HLS in hls.js')
  await expectHeard(page, 440)
})
