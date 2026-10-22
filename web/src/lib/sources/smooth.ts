/* Whether this device decodes a kind of video smoothly, not just at all. `canPlayType` says a
   browser accepts HEVC; it doesn't say that a laptop without a hardware decoder can keep up with 4K
   10-bit HEVC at 24 frames a second. `navigator.mediaCapabilities.decodingInfo` does, as best the
   browser can tell: `supported`, `smooth` and `powerEfficient` (hardware decoding, usually).

   Sources come in a handful of classes (codec, resolution, HDR or not), so each class is asked once
   at startup and remembered. Ranking reads the answers synchronously for every row; a class that
   hasn't been answered yet (or a browser with no such API) is simply unknown and changes nothing. */

import type { Source } from './types'

export type SmoothCodec = 'H264' | 'HEVC' | 'AV1' | 'VP9'
export type SmoothHeight = 2160 | 1440 | 1080

export interface Smoothness {
  supported: boolean
  smooth: boolean
  powerEfficient: boolean
}

export const smoothCodecs: SmoothCodec[] = ['H264', 'HEVC', 'AV1', 'VP9']
export const smoothHeights: SmoothHeight[] = [2160, 1440, 1080]

const widths: Record<SmoothHeight, number> = { 2160: 3840, 1440: 2560, 1080: 1920 }
/** What a film at that size usually weighs, in bits per second: a good web release, short of a
 *  full remux. The browser's answer depends on it a little (software decoders mostly on pixels). */
const bitrates: Record<SmoothHeight, number> = { 2160: 35_000_000, 1440: 20_000_000, 1080: 12_000_000 }
const framerate = 24

/** A representative codec string per class: the profile and level a release at that size and range
 *  most often uses. HDR is always the 10-bit profile; 4K SDR usually is too. */
export function codecString(codec: SmoothCodec, height: SmoothHeight, hdr: boolean): string {
  const tenBit = hdr || height === 2160
  switch (codec) {
    case 'H264':
      // High profile, level 5.1 for 4K and 1440p (its highest common one), 4.0 for 1080p.
      return height === 1080 ? 'avc1.640028' : 'avc1.640033'
    case 'HEVC': {
      const level = height === 2160 ? 'L153' : height === 1440 ? 'L150' : 'L120'
      return tenBit ? `hvc1.2.4.${level}.B0` : `hvc1.1.6.${level}.B0`
    }
    case 'AV1': {
      const level = height === 2160 ? '12' : height === 1440 ? '09' : '08'
      return `av01.0.${level}M.${tenBit ? '10' : '08'}`
    }
    case 'VP9': {
      const level = height === 2160 ? '51' : height === 1440 ? '41' : '40'
      return tenBit ? `vp09.02.${level}.10` : `vp09.00.${level}.08`
    }
  }
}

/** The configuration `decodingInfo` is asked about; `hdr` adds PQ and BT.2020. */
export function decodingConfig(codec: SmoothCodec, height: SmoothHeight, hdr: boolean, withHDR = true) {
  const video: Record<string, unknown> = {
    contentType: `video/mp4; codecs="${codecString(codec, height, hdr)}"`,
    width: widths[height],
    height,
    bitrate: bitrates[height],
    framerate,
  }
  if (hdr && withHDR) {
    video.transferFunction = 'pq'
    video.colorGamut = 'rec2020'
    video.hdrMetadataType = 'smpteSt2086'
  }
  return { type: 'media-source', video }
}

const answers = new Map<string, Smoothness>()
let checking: Promise<void> | undefined

export const smoothKey = (codec: SmoothCodec, height: SmoothHeight, hdr: boolean) => `${codec}@${height}${hdr ? '+hdr' : ''}`

type DecodingInfo = { supported?: boolean; smooth?: boolean; powerEfficient?: boolean }
type Decoder = (config: unknown) => Promise<DecodingInfo>

function decoder(): Decoder | undefined {
  const caps = typeof navigator !== 'undefined' ? (navigator as Navigator & { mediaCapabilities?: { decodingInfo?: Decoder } }).mediaCapabilities : undefined
  return caps?.decodingInfo ? (config) => caps.decodingInfo!(config) : undefined
}

/** One class, asked of the browser. Undefined when it won't say. A browser that rejects the HDR
 *  fields (older Chromium) is asked again without them: the 10-bit profile is what costs the CPU. */
export async function probe(ask: Decoder, codec: SmoothCodec, height: SmoothHeight, hdr: boolean): Promise<Smoothness | undefined> {
  const run = async (withHDR: boolean) => {
    const info = await ask(decodingConfig(codec, height, hdr, withHDR))
    return { supported: info.supported === true, smooth: info.smooth === true, powerEfficient: info.powerEfficient === true }
  }
  try {
    return await run(true)
  } catch {
    if (!hdr) return undefined
  }
  try {
    return await run(false)
  } catch {
    return undefined
  }
}

/** Asks about every class and keeps the answers. Call it once at startup: it never throws, and
 *  nothing waits on it. The answer is the classes' answers as a list, for logging and tests. */
export function checkSmoothVideo(ask: Decoder | undefined = decoder()): Promise<void> {
  checking ??= (async () => {
    if (!ask) return
    const jobs: Promise<void>[] = []
    // 4K first: it's the class the picker most needs, and the others follow right behind.
    for (const height of smoothHeights) {
      for (const hdr of [false, true]) {
        for (const codec of smoothCodecs) {
          jobs.push(
            probe(ask, codec, height, hdr).then((answer) => {
              // A codec the browser can't decode at all is `canPlayType`'s business, not smoothness.
              if (answer?.supported) answers.set(smoothKey(codec, height, hdr), answer)
            }),
          )
        }
      }
    }
    await Promise.all(jobs)
  })()
  return checking
}

/** Test seam: forget the answers, so the next check asks again. */
export function resetSmoothVideo() {
  answers.clear()
  checking = undefined
}

/** Every answer so far, keyed `HEVC@2160+hdr`, for the console and the Playback Info panel. */
export const smoothAnswers = (): Record<string, Smoothness> => Object.fromEntries(answers)

const codecAliases: Record<string, SmoothCodec> = { H264: 'H264', 'H.264': 'H264', AVC: 'H264', HEVC: 'HEVC', H265: 'HEVC', AV1: 'AV1', VP9: 'VP9' }
const heights: Partial<Record<NonNullable<Source['resolution']>, SmoothHeight>> = { '2160p': 2160, '1440p': 1440, '1080p': 1080 }

/** The remembered answer for a kind of source: "HEVC" at "2160p", HDR or not. Synchronous. Undefined
 *  when it hasn't been asked yet, the browser has no such API, or the kind isn't one of the classes
 *  (720p and below decode on anything). */
export function smoothnessOf(codec: string | undefined, resolution: Source['resolution'] | undefined, hdr: boolean): Smoothness | undefined {
  const c = codec && codecAliases[codec]
  const height = resolution && heights[resolution]
  if (!c || !height) return undefined
  return answers.get(smoothKey(c, height, hdr))
}

/** True when a source's video is HDR of any kind (Dolby Vision's base layer is HEVC, HDR10 too). */
export const isHDR = (hdr: Source['hdr']) => !!hdr && hdr.length > 0
