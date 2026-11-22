import { readFile, stat } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, test, type Page } from '../fixtures'
import { expectPlaying, videoState, wake } from '../helpers'
import { probeText } from './probe'

/* What the playback matrix needs on top of the site's browser tests: a pretend add-on that offers one file under a given
   release name, a pretend file host that serves the generated clips (e2e/media/generated, made by
   `npm run e2e-media-fixtures`) the way a real one does (byte ranges, CORS), and ways to ask the real player what it is
   doing: which engine opened the file, whether time moves, whether it can be heard. */

const here = dirname(fileURLToPath(import.meta.url))
export const generated = join(here, 'generated')
/** Clips kept in git because ffmpeg's versions disagree on how to make them (HDR tags in the Matroska file: 6.1 writes them, 8 doesn't). */
const committed = join(here, 'committed')
const hlsFolder =join(here, '..', 'fixtures', 'hls')

export const fileHost = 'https://files.example.test'
const addonHost = 'https://addon.example.test'

/** The film the sample data knows by this id: its IMDb id is what an add-on is asked for. */
const film = { path: '/watch/movie/157336', title: 'Interstellar' }

const exposed = 'Content-Range, Content-Length, Accept-Ranges, Content-Type, ETag, Last-Modified'
const cors = { 'access-control-allow-origin': '*', 'access-control-expose-headers': exposed, 'access-control-allow-headers': 'range, content-type', 'access-control-allow-methods': 'GET, HEAD, OPTIONS' }

const types: Record<string, string> = {
  '.mp4': 'video/mp4', '.m4s': 'video/iso.segment', '.mov': 'video/quicktime', '.webm': 'video/webm', '.mkv': 'video/x-matroska', '.avi': 'video/x-msvideo',
  '.ts': 'video/mp2t', '.m2ts': 'video/mp2t', '.flv': 'video/x-flv', '.wmv': 'video/x-ms-wmv', '.vob': 'video/mpeg', '.mpg': 'video/mpeg', '.3gp': 'video/3gpp',
  '.ogv': 'video/ogg', '.m3u8': 'application/vnd.apple.mpegurl', '.vtt': 'text/vtt',
}

/** One file the pretend add-on offers. */
export interface Offer {
  /** The release name, which is what the picker shows and what routing reads the container from. */
  release: string
  /** The file: one in the generated folder, or `hls/master.m3u8` for the stand-in HLS stream. */
  file: string
  /** The address the host serves it at, when that should say nothing about what it is (a debrid link); else the file's name. */
  path?: string
  /** What the add-on says the file is, as a Stremio add-on's first lines do. */
  detail?: string
  /** Bytes the host reports; omitted, the real size is used. */
  size?: number
}

async function bytesOf(name: string): Promise<Buffer | null> {
  const file = name.startsWith('hls/') ? join(hlsFolder, name.slice(4)) : name.startsWith('committed/') ? join(committed, name.slice(10)) : join(generated, name)
  if (!file.startsWith(generated) && !file.startsWith(hlsFolder) && !file.startsWith(committed)) return null
  try {
    await stat(file)
    return await readFile(file)
  } catch {
    return null
  }
}

/** Serves the clips with the answers a real file host gives: Accept-Ranges, 206 for a range, CORS for the page. */
async function hostFiles(page: Page, offers: Offer[], hits: string[]) {
  const files = new Map(offers.filter((o) => o.path).map((o) => [o.path!, o.file]))
  await page.route(`${fileHost}/**`, async (route) => {
    const request = route.request()
    const url = new URL(request.url())
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors })
    const path = decodeURIComponent(url.pathname.slice(1))
    const name = files.get(path) ?? path
    const body = await bytesOf(name)
    if (!body) return route.fulfill({ status: 404, headers: cors })
    hits.push(`${request.method()} ${url.pathname} ${request.headers().range ?? ''}`.trim())
    const ext = name.slice(name.lastIndexOf('.'))
    const headers = { ...cors, 'content-type': types[ext] ?? 'application/octet-stream', 'accept-ranges': 'bytes', 'cache-control': 'no-store' }
    const range = /^bytes=(\d*)-(\d*)$/.exec(request.headers().range ?? '')
    if (!range || request.method() === 'HEAD') return route.fulfill({ status: 200, body, headers: { ...headers, 'content-length': String(body.length) } })
    let start = range[1] === '' ? Math.max(0, body.length - Number(range[2])) : Number(range[1])
    let end = range[1] === '' || range[2] === '' ? body.length - 1 : Math.min(Number(range[2]), body.length - 1)
    if (start >= body.length) return route.fulfill({ status: 416, headers: { ...headers, 'content-range': `bytes */${body.length}` } })
    start = Math.max(0, start)
    end = Math.max(start, end)
    return route.fulfill({ status: 206, body: body.subarray(start, end + 1), headers: { ...headers, 'content-range': `bytes ${start}-${end}/${body.length}` } })
  })
}

/** A Stremio add-on that answers every stream request with the offers. */
async function addon(page: Page, offers: Offer[]) {
  await page.route(`${addonHost}/**`, async (route) => {
    const headers = { ...cors, 'content-type': 'application/json' }
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers })
    const streams = await Promise.all(
      offers.map(async (offer) => {
        const size = offer.size ?? (await bytesOf(offer.file))?.length ?? 1_000_000
        return {
          name: 'Matrix',
          description: offer.detail ?? offer.release,
          url: `${fileHost}/${offer.path ?? offer.file}`,
          behaviorHints: { filename: offer.release, videoSize: size },
        }
      }),
    )
    return route.fulfill({ status: 200, headers, body: JSON.stringify({ streams }) })
  })
}

/** Installs the pretend add-on and host before the page loads. `hits` collects what the host was asked for. */
/** What the page said about its media (console warnings the site writes for whoever debugs), for failure messages. */
const notes: string[] = []

export async function offer(page: Page, offers: Offer[]): Promise<{ hits: string[] }> {
  const hits: string[] = []
  // Each test's log starts empty: what an earlier test said is not this one's story, and it used up the room for it.
  notes.length = 0
  // Everything the page and its workers (the engine runs in one) say about their media, for a failure's log.
  const note = (where: string) => (message: { type(): string; text(): string }) => {
    if ((['warning', 'error'].includes(message.type()) || message.text().startsWith('Marquee media')) && notes.length < 60) notes.push(`${where} ${message.type()}: ${message.text().slice(0, 240)}`)
  }
  page.on('console', note('page'))
  // A request that failed on its way (a worker's included, where the browser reports them) says why the file never arrived.
  page.on('requestfailed', (request) => notes.push(`request failed: ${request.method()} ${request.url().slice(0, 120)} ${request.failure()?.errorText ?? ''}`))
  page.on('worker', (worker) => {
    notes.push(`worker started: ${worker.url().split('/').pop()}`)
    worker.on('console', note('worker'))
    worker.on('close', () => notes.push(`worker closed: ${worker.url().split('/').pop()}`))
  })
  await hostFiles(page, offers, hits)
  await addon(page, offers)
  // The <video>'s own events with their times, kept in the page for a failure's log (media events don't bubble, so this listens while they travel down).
  await page.addInitScript(() => {
    const log: string[] = []
    ;(window as unknown as { __mediaEvents: string[] }).__mediaEvents = log
    const names = ['loadstart', 'loadedmetadata', 'loadeddata', 'canplay', 'canplaythrough', 'play', 'playing', 'pause', 'waiting', 'stalled', 'suspend', 'seeking', 'seeked', 'ended', 'error', 'emptied', 'abort']
    for (const name of names) document.addEventListener(name, (event) => {
      if (!(event.target instanceof HTMLVideoElement) || log.length > 80) return
      const v = event.target
      log.push(`${Math.round(performance.now())}ms ${name} (time ${v.currentTime.toFixed(2)}, ready ${v.readyState}, paused ${v.paused})`)
    }, true)
  })
  await page.addInitScript((url) => {
    // The add-on the viewer has "installed": one entry in Settings, with no manifest saved, which is asked for every title.
    const key = 'flow.settings.v1'
    try {
      const saved = JSON.parse(localStorage.getItem(key) ?? '{}')
      // A failing file must show its error, not quietly hand over to the next source in the list (the default).
      localStorage.setItem(key, JSON.stringify({ ...saved, addons: [{ url, name: 'Matrix', enabled: true }], tryNextSourceOnFailure: false }))
    } catch {
      // Storage that won't open leaves the page without the add-on, and the test says so.
    }
  }, `${addonHost}/manifest.json`)
  return { hits }
}

/** Opens the film's player; the picker lists the offers. Chooses the one named `release`. */
export async function startPlaying(page: Page, boot: (path: string) => Promise<void>, count = 1) {
  await boot(film.path)
  const picker = page.getByRole('dialog', { name: `Sources for ${film.title}` })
  await expect(picker).toBeVisible()
  // The picker names a row by what the release says it is, not by its file name; the add-on's own group holds just the offers.
  await picker.getByRole('toolbar', { name: 'Filter sources' }).getByRole('button', { name: 'Matrix' }).click()
  const rows = picker.getByRole('option')
  await expect(rows, 'the picker lists what the add-on offered').toHaveCount(count)
  return rows
}

export async function pickAndPlay(page: Page, boot: (path: string) => Promise<void>) {
  const rows = await startPlaying(page, boot)
  await rows.first().click()
  try {
    await expectPlaying(page)
  } catch (error) {
    throw new Error(`${(error as Error).message}\n${await whatHappened(page)}`)
  }
}

/** For a failure message: the player's error if it shows one, and where the element stands. */
export async function whatHappened(page: Page) {
  const alert = page.getByRole('alertdialog')
  const shown = (await alert.isVisible().catch(() => false)) ? await alert.innerText().catch(() => '') : 'no error shown'
  // A page whose main thread is stuck never answers: say so, rather than waiting for the test to be killed with nothing said.
  const element = await Promise.race([
    page.evaluate(() => {
      const v = document.querySelector('video')
      const buffered = v ? Array.from({ length: v.buffered.length }, (_, i) => `${v.buffered.start(i).toFixed(2)}-${v.buffered.end(i).toFixed(2)}`).join(',') : ''
      const events = (window as unknown as { __mediaEvents?: string[] }).__mediaEvents ?? []
      return v ? `time ${v.currentTime.toFixed(2)}, paused ${v.paused}, seeking ${v.seeking}, ended ${v.ended}, rate ${v.playbackRate}, ready ${v.readyState}, network ${v.networkState}, buffered [${buffered}], frames shown ${v.getVideoPlaybackQuality?.().totalVideoFrames ?? '?'}, error ${v.error?.code ?? 'none'} ${v.error?.message ?? ''}\n  the video's events (page time, ms): ${events.join('; ')} (now ${Math.round(performance.now())}ms)` : 'no video element'
    }),
    new Promise<string>((resolve) => setTimeout(() => resolve('THE PAGE DID NOT ANSWER for 8 s (its main thread is stuck or its process is gone)'), 8000)),
  ])
  return `player: ${shown.replace(/\n+/g, ' | ')}; element: ${element}\n  page and workers said:\n    ${notes.join('\n    ') || 'nothing'}`
}

/** Everything worth reading when a cell fails: the player, the element, what the page and workers logged, and what the browser really does against what it claims. */
export async function diagnostics(page: Page) {
  return `${await whatHappened(page)}\n  the browser, claims against what happened:\n  ${await probeText(page)}`
}

export interface Info {
  [row: string]: string
}

/** Opens Playback Info (the I key) and reads its rows. */
export async function playbackInfo(page: Page): Promise<Info> {
  const card = page.getByRole('complementary', { name: 'Playback info' })
  if (!(await card.isVisible())) await page.keyboard.press('i')
  await expect(card).toBeVisible()
  // The card fills in once a second; the rows follow the engine as it comes up.
  await expect.poll(async () => (await rows(page)).Engine ?? '—', { message: 'Playback Info names the engine' }).not.toBe('—')
  return rows(page)
}

const rows = (page: Page): Promise<Info> =>
  page.evaluate(() => {
    const out: Record<string, string> = {}
    for (const row of document.querySelectorAll('aside[aria-label="Playback info"] dl > div')) out[row.querySelector('dt')!.textContent!.trim()] = row.querySelector('dd')!.textContent!.trim()
    return out
  })

/* Listening. The test puts its own Web Audio graph on the <video> (a meter after the element, before the speakers) and
   measures what comes out: the loudest frequency and the level. The clips are plain tones, so a track that plays is at its
   frequency, and a silent or wrong one isn't. The element must be CORS-clean (the host sends the headers) or the browser
   would zero what it hands over. */
export interface Heard {
  /** The loudest frequency, in Hz, over the last half second. */
  hz: number
  /** Peak sample, 0 to 1. */
  peak: number
  state: string
}

export async function listen(page: Page): Promise<Heard> {
  return page.evaluate(async () => {
    const w = window as unknown as { __meter?: { context: AudioContext; analyser: AnalyserNode; element: HTMLVideoElement } }
    const video = document.querySelector('video')!
    if (!w.__meter || w.__meter.element !== video) {
      const context = new AudioContext()
      await Promise.race([context.resume().catch(() => undefined), new Promise((r) => setTimeout(r, 2000))])
      const analyser = context.createAnalyser()
      analyser.fftSize = 16384
      analyser.smoothingTimeConstant = 0
      context.createMediaElementSource(video).connect(analyser)
      analyser.connect(context.destination)
      w.__meter = { context, analyser, element: video }
    }
    const { context, analyser } = w.__meter
    await Promise.race([context.resume().catch(() => undefined), new Promise((r) => setTimeout(r, 2000))])
    // Let half a second of what is playing go through.
    await new Promise((resolve) => setTimeout(resolve, 600))
    const wave = new Float32Array(analyser.fftSize)
    analyser.getFloatTimeDomainData(wave)
    let peak = 0
    for (const x of wave) peak = Math.max(peak, Math.abs(x))
    const spectrum = new Float32Array(analyser.frequencyBinCount)
    analyser.getFloatFrequencyData(spectrum)
    let loudest = 0
    for (let i = 1; i < spectrum.length; i++) if (spectrum[i]! > spectrum[loudest]!) loudest = i
    return { hz: Math.round((loudest * context.sampleRate) / analyser.fftSize), peak, state: context.state }
  })
}

/** Waits until the sound out is the tone `hz` (within one bin plus a little: the clip's tone, whatever it was resampled to). */
export async function expectHeard(page: Page, hz: number, message = `${hz} Hz can be heard`) {
  const deadline = Date.now() + 25_000
  let last = ''
  let suspended = (await page.evaluate(() => !!(window as unknown as { __noSoundDevice?: boolean }).__noSoundDevice)) ? 3 : 0
  while (Date.now() < deadline) {
    const h = await listen(page)
    if (h.peak > 0.02 && Math.abs(h.hz - hz) <= 12) return
    last = `${h.hz} Hz, peak ${h.peak.toFixed(3)}, audio context ${h.state}`
    // A machine with no sound device (Firefox on a CI runner) keeps Web Audio suspended for good: the tone can't be measured
    // there, so the track must at least be decoded and the clock running (Firefox says whether a file has sound: mozHasAudio).
    if (h.state !== 'running' && ++suspended >= 3) {
      await page.evaluate(() => void ((window as unknown as { __noSoundDevice?: boolean }).__noSoundDevice = true))
      const element = await page.evaluate(() => {
        const v = document.querySelector('video') as HTMLVideoElement & { mozHasAudio?: boolean; webkitAudioDecodedByteCount?: number }
        return { has: v.mozHasAudio, decoded: v.webkitAudioDecodedByteCount, muted: v.muted, volume: v.volume }
      })
      expect(element.muted || element.volume === 0, 'the sound is not muted').toBe(false)
      if (element.has !== undefined) expect(element.has, 'the browser found sound in the file').toBe(true)
      test.info().annotations.push({ type: 'tone not measured', description: 'the browser has no sound device here, so Web Audio stays suspended' })
      return
    }
  }
  // What the element itself says, so a silent clip can be told from a clip that never started.
  const element = await page.evaluate(() => {
    const v = document.querySelector('video')!
    return `time ${v.currentTime.toFixed(2)}, paused ${v.paused}, muted ${v.muted}, volume ${v.volume}, ready ${v.readyState}, error ${v.error?.code ?? 'none'}`
  })
  const info = JSON.stringify(await rows(page).catch(() => ({})))
  throw new Error(`${message}: last heard ${last} (${element}) Playback Info ${info}`)
}

/** Opens Audio and Subtitles and returns the audio choices, by their visible text ("English · AAC Stereo", with "Converted" under it when it is). */
export async function audioChoices(page: Page) {
  const panel = page.getByRole('dialog', { name: 'Audio and Subtitles' })
  if (!(await panel.isVisible())) {
    await wake(page)
    await page.getByRole('button', { name: 'Audio and Subtitles', exact: true }).click()
  }
  const items = panel.getByRole('menu', { name: 'Audio' }).getByRole('menuitemradio')
  await expect(items.first()).toBeVisible()
  return items
}

/** The picture is the clip's: the test pattern's colour bars are where they should be. A file can play with its clock running
 *  and its sound on while the picture is black or missing (a codec the browser skips), so the clock alone proves nothing. */
export async function expectPicture(page: Page, how: 'pixels' | 'frames' = 'pixels') {
  if (how === 'frames') {
    // Where a browser's canvas won't hand over a frame of a video that has just seeked (Playwright's WebKit build), count what
    // it says it showed: the video has a size and the frames shown keep growing.
    const shown = () => page.evaluate(() => ({ w: document.querySelector('video')!.videoWidth, n: document.querySelector('video')!.getVideoPlaybackQuality?.().totalVideoFrames ?? 0 }))
    const first = await shown()
    expect(first.w, 'the video has a picture size').toBeGreaterThan(0)
    await expect.poll(async () => (await shown()).n, { message: 'the browser keeps showing frames', timeout: 10_000 }).toBeGreaterThan(first.n)
    return
  }
  await expect
    .poll(
      () =>
        page.evaluate(() => {
          const video = document.querySelector('video')!
          if (!video.videoWidth) return 'no picture (the video has no size)'
          const canvas = document.createElement('canvas')
          canvas.width = 100
          canvas.height = 100
          const draw = canvas.getContext('2d')!
          draw.drawImage(video, 0, 0, 100, 100)
          let data: Uint8ClampedArray
          try {
            data = draw.getImageData(0, 0, 100, 100).data
          } catch {
            // A picture the page may not read (a host without CORS): count the frames the browser says it showed.
            return (video.getVideoPlaybackQuality?.().totalVideoFrames ?? 1) > 0 ? 'ok' : 'no frames shown'
          }
          const at = (x: number, y: number) => [0, 1, 2].map((i) => data[(y * 100 + x) * 4 + i]!)
          // Red, green, yellow, blue, magenta, cyan, left to right, as [red, green, blue] high (1) or low (0).
          const bars: [number, number, number[]][] = [[8, 40, [1, 0, 0]], [25, 40, [0, 1, 0]], [42, 35, [1, 1, 0]], [58, 35, [0, 0, 1]], [75, 35, [1, 0, 1]], [92, 35, [0, 1, 1]]]
          const wrong = bars.filter(([x, y, want]) => at(x, y).some((value, i) => (want[i] ? value < 110 : value > 140)))
          return wrong.length === 0 ? 'ok' : `colour bars not as drawn at ${wrong.map(([x, y]) => `${x},${y}=${at(x, y)}`).join(' ')}`
        }),
      { message: 'the picture shows the clip’s colour bars', timeout: 15_000 },
    )
    .toBe('ok')
}

/** The player's clock after a seek to a tenth of the way through: lands near it, and keeps running from there. */
export async function expectSeek(page: Page) {
  const duration = (await videoState(page))!.duration
  await page.keyboard.press('7')
  await expect.poll(async () => Math.abs((await videoState(page))!.time - duration * 0.7), { message: 'the seek lands near seven tenths through', timeout: 20_000 }).toBeLessThan(1.5)
  const landed = (await videoState(page))!.time
  await expect.poll(async () => (await videoState(page))!.time, { message: 'playback carries on after the seek', timeout: 20_000 }).toBeGreaterThan(landed + 0.4)
  expect((await videoState(page))!.paused).toBe(false)
}
