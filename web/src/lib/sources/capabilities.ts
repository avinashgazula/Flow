/* What this browser can decode, asked once per type and remembered: codec support doesn't change
   while the page is open, and the picker asks for every row. */

import { canConvertAudio } from '../audio/support'
import { smoothnessOf, type Smoothness } from './smooth'
import type { Source } from './types'

export type VideoCodecName = 'H264' | 'HEVC' | 'AV1' | 'VP9' | 'XviD'
export type AudioCodecName = 'AAC' | 'DD' | 'DD+' | 'Atmos' | 'FLAC' | 'Opus' | 'MP3' | 'DTS' | 'DTS-HD MA' | 'DTS:X' | 'TrueHD' | 'TrueHD Atmos'

export interface Capabilities {
  /** Media Source Extensions (or Safari's ManagedMediaSource): needed by hls.js and the remuxer. */
  mse: boolean
  /** Safari plays HLS itself. */
  nativeHLS: boolean
  /** An HDR-capable display. */
  hdr: boolean
  /** This browser can turn audio it can't decode into Opus (src/lib/audio). It still needs a file
   *  Flow can read, which is the source's business, not the browser's. */
  convertAudio: boolean
  video(codec: string): boolean
  audio(codec: string): boolean
  /** How well this device decodes that kind of video (see smooth.ts): undefined until the browser has
   *  said, or when it can't. Never a reason to refuse a source, only to rank it lower. */
  smoothVideo(codec: string | undefined, resolution: Source['resolution'] | undefined, hdr: boolean): Smoothness | undefined
}

const videoTypes: Record<string, string[]> = {
  H264: ['video/mp4; codecs="avc1.640028"'],
  HEVC: ['video/mp4; codecs="hvc1.2.4.L153.B0"', 'video/mp4; codecs="hev1.1.6.L120.90"'],
  AV1: ['video/mp4; codecs="av01.0.08M.10"'],
  VP9: ['video/webm; codecs="vp09.00.40.08"', 'video/mp4; codecs="vp09.00.40.08"'],
}

const audioTypes: Record<string, string[]> = {
  AAC: ['audio/mp4; codecs="mp4a.40.2"'],
  DD: ['audio/mp4; codecs="ac-3"'],
  'DD+': ['audio/mp4; codecs="ec-3"'],
  FLAC: ['audio/mp4; codecs="flac"'],
  Opus: ['audio/mp4; codecs="opus"', 'audio/webm; codecs="opus"'],
  MP3: ['audio/mpeg', 'audio/mp4; codecs="mp4a.6B"'],
}

/** No browser decodes these, whatever it says about itself. */
export const losslessCinemaAudio = (codec: string) => /^(dts|truehd)/i.test(codec)

/** Atmos is object metadata carried on TrueHD or E-AC-3, never a codec of its own, so it can't
 *  be played (or refused) by itself: the carrier decides. */
const decodes = (codec: string, listed: (codec: string) => boolean) => !/atmos/i.test(codec) && !losslessCinemaAudio(codec) && listed(codec)

const cache = new Map<string, boolean>()

/** True when MSE or the video element says it can play the type. */
export function canPlayType(mime: string): boolean {
  const known = cache.get(mime)
  if (known !== undefined) return known
  let ok = false
  try {
    const MS = (globalThis as any).ManagedMediaSource ?? (globalThis as any).MediaSource
    if (MS?.isTypeSupported?.(mime)) ok = true
    else if (typeof document !== 'undefined') ok = document.createElement('video').canPlayType(mime) !== ''
  } catch {
    ok = false
  }
  cache.set(mime, ok)
  return ok
}

let detected: Capabilities | undefined

/** This browser's capabilities. Outside a browser (tests, workers without media) everything is false. */
export function browserCapabilities(): Capabilities {
  if (detected) return detected
  const hasDocument = typeof document !== 'undefined'
  const g = globalThis as any
  detected = {
    mse: !!(g.ManagedMediaSource || g.MediaSource),
    nativeHLS: hasDocument && document.createElement('video').canPlayType('application/vnd.apple.mpegurl') !== '',
    hdr: typeof matchMedia === 'function' && matchMedia('(dynamic-range: high)').matches,
    // Asked each time: startup refines the first answer once the encoder has said what it takes.
    get convertAudio() {
      return canConvertAudio()
    },
    video: (codec) => (videoTypes[codec] ?? []).some(canPlayType),
    audio: (codec) => decodes(codec, (c) => (audioTypes[c] ?? []).some(canPlayType)),
    smoothVideo: smoothnessOf,
  }
  return detected
}

/** A fixed set of capabilities, for tests and for reasoning about "a typical browser". */
export function fixedCapabilities(c: {
  mse?: boolean
  nativeHLS?: boolean
  hdr?: boolean
  convertAudio?: boolean
  video?: string[]
  audio?: string[]
  /** What the device says about decoding, by class: `'HEVC@2160'` for any range, `'HEVC@2160+hdr'` for
   *  HDR only. A class not listed is unknown. */
  smooth?: Record<string, Partial<Smoothness>>
}): Capabilities {
  const video = new Set(c.video ?? ['H264', 'VP9', 'AV1'])
  const audio = new Set(c.audio ?? ['AAC', 'FLAC', 'Opus', 'MP3'])
  return {
    mse: c.mse ?? true,
    nativeHLS: c.nativeHLS ?? false,
    hdr: c.hdr ?? false,
    convertAudio: c.convertAudio ?? false,
    video: (codec) => video.has(codec),
    audio: (codec) => decodes(codec, (c) => audio.has(c)),
    smoothVideo(codec, resolution, hdr) {
      const name = codec === 'H.264' ? 'H264' : codec
      const found = c.smooth?.[`${name}@${resolution?.replace('p', '')}${hdr ? '+hdr' : ''}`] ?? c.smooth?.[`${name}@${resolution?.replace('p', '')}`]
      return found && { supported: true, smooth: true, powerEfficient: true, ...found }
    },
  }
}
