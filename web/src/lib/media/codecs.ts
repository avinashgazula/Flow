/* What the engine's streams are, in the terms the player already uses (remux/protocol.ts's HeaderInfo), and the codec
   strings Media Source Extensions are asked about. Pure functions over `MediaStream`s, so routing and codec naming are
   tested without the WebAssembly module.

   This is also where the seam for converting video lives. Today every track of a file is one of two things: copied
   as it is (its codec plays in MP4 here) or refused with a reason (`supported: false`, which `tracks.plan` turns into
   "This browser can’t play X video"). A later step that decodes video in the module and re-encodes it with WebCodecs
   adds a third answer for the refused ones: see `videoDecision`. */

import type { HeaderInfo, HeaderTrack } from '../remux/protocol'
import { av1Codec, esdsCodec, hevcCodec } from './mp4'
import type { MediaStream } from './engine'

const hex = (n: number) => n.toString(16).toUpperCase().padStart(2, '0')
const pad2 = (n: number) => String(n).padStart(2, '0')

/** The first SPS in an Annex B byte stream (transport streams, AVI): its profile, constraint flags and level bytes. */
function annexBSps(data: Uint8Array): [number, number, number] | null {
  for (let i = 0; i + 6 < data.length; i++) {
    if (data[i] === 0 && data[i + 1] === 0 && (data[i + 2] === 1 || (data[i + 2] === 0 && data[i + 3] === 1))) {
      const nal = i + (data[i + 2] === 1 ? 3 : 4)
      if ((data[nal]! & 0x1f) === 7 && nal + 3 < data.length) return [data[nal + 1]!, data[nal + 2]!, data[nal + 3]!]
    }
  }
  return null
}

/** The MIME codec string for a stream's picture if it were copied into MP4, or '' when MP4 (or this engine) can't carry it. */
export function videoCodecString(s: MediaStream): string {
  const e = s.extradata
  switch (s.codec) {
    case 'h264': {
      if (e.length >= 4 && e[0] === 1) return `avc1.${hex(e[1]!)}${hex(e[2]!)}${hex(e[3]!)}`
      const sps = annexBSps(e)
      if (sps) return `avc1.${hex(sps[0])}${hex(sps[1])}${hex(sps[2])}`
      if (s.profile <= 0 || s.level <= 0) return 'avc1.640028'
      // FFmpeg adds 0x200 to the profile for the "constrained" flavours (set 1 for baseline, main and extended).
      return `avc1.${hex(s.profile & 0xff)}${hex(s.profile & 0x200 ? 0x40 : 0)}${hex(s.level & 0xff)}`
    }
    case 'hevc': {
      if (e.length >= 13 && e[0] === 1) return hevcCodec('hvc1', e)
      // No config record (a transport stream): the profile and level the parser read, with the usual flags for them.
      const profile = s.profile > 0 ? s.profile : 1
      return `hvc1.${profile}.${profile === 2 ? '4' : '6'}.L${s.level > 0 ? s.level : 120}.B0`
    }
    case 'av1':
      return e.length >= 4 && (e[0]! & 0x80) !== 0 ? av1Codec(e) : `av01.0.${pad2(s.level > 0 ? s.level : 8)}M.${pad2(s.bitDepth > 8 ? s.bitDepth : 8)}`
    case 'vp9':
      return `vp09.${pad2(Math.max(0, s.profile))}.${pad2(s.level > 0 ? s.level : 10)}.${pad2(s.bitDepth || 8)}`
    default:
      return ''
  }
}

/** The MIME codec string for a sound track that plays in MP4 as it is, or '' when it has to be converted (or isn't carried at all). */
export function audioCodecString(s: MediaStream): string {
  switch (s.codec) {
    case 'aac': {
      // The config record (when the container has one) names the object type; else FFmpeg's profile number does.
      const aot = s.extradata.length >= 2 ? s.extradata[0]! >> 3 : ({ 0: 1, 1: 2, 2: 3, 3: 4, 4: 5, 28: 29, 22: 23, 38: 39 } as Record<number, number>)[s.profile] || 2
      return `mp4a.40.${aot}`
    }
    case 'mp3':
      return 'mp4a.6B'
    case 'ac3':
      return 'ac-3'
    case 'eac3':
      return 'ec-3'
    case 'flac':
      return 'flac'
    case 'opus':
      return 'opus'
    case 'alac':
      return 'alac'
    default:
      return ''
  }
}

/** Dolby Vision, HDR10, HLG or SDR, as far as the container's colour tags say. */
function rangeOf(s: MediaStream): string | undefined {
  if (s.transfer === 16) return 'HDR10'
  if (s.transfer === 18) return 'HLG'
  return s.bitDepth > 8 ? 'SDR' : undefined
}

/** What happens to a picture track. `copy` is the only thing the engine does today; `convert` is for the step that decodes the picture and encodes it again. */
export type VideoDecision = { action: 'copy'; mime: string } | { action: 'convert'; reason: string } | { action: 'unsupported'; reason: string }

/** The one place that decides what to do with a picture track. `isSupported` is MediaSource.isTypeSupported (the worker can't ask). */
export function videoDecision(s: MediaStream, isSupported: (mime: string) => boolean): VideoDecision {
  const codec = videoCodecString(s)
  if (!codec) return { action: 'unsupported', reason: `Marquee can’t carry ${s.codec} video.` }
  const mime = `video/mp4; codecs="${codec}"`
  if (isSupported(mime)) return { action: 'copy', mime }
  return { action: 'unsupported', reason: `This browser can’t decode ${codec}.` }
}

/** Streams that are neither a picture nor a sound the player lists: cover art, data, subtitles (not read yet). */
const listed = (s: MediaStream) => (s.type === 'video' && !s.attachedPicture) || s.type === 'audio'

/** The file's tracks as the player's header: ids are the engine's stream indexes. */
export function headerFor(streams: MediaStream[], durationMs: number, title: string | null = null): HeaderInfo {
  const tracks: HeaderTrack[] = streams.filter(listed).map((s) => {
    const base = {
      id: s.index,
      codecId: s.codec,
      language: s.language && s.language !== 'und' ? s.language : '',
      name: s.title || null,
      default: s.default,
      forced: s.forced,
      commentary: s.commentary,
      hearingImpaired: s.hearingImpaired,
    }
    if (s.type === 'video') {
      const codec = videoCodecString(s)
      const sarOk = s.sarNumerator > 0 && s.sarDenominator > 0 && s.sarNumerator !== s.sarDenominator
      return {
        ...base,
        type: 'video' as const,
        codec,
        supported: codec !== '',
        reason: codec ? '' : `${s.codec} video isn’t carried`,
        width: s.width,
        height: s.height,
        frameRate: s.frameRate || undefined,
        range: rangeOf(s),
        displayWidth: sarOk ? Math.round((s.width * s.sarNumerator) / s.sarDenominator) : undefined,
        displayHeight: sarOk ? s.height : undefined,
      }
    }
    const codec = audioCodecString(s)
    return {
      ...base,
      type: 'audio' as const,
      codec,
      supported: codec !== '',
      reason: codec ? '' : `${s.codec} is converted`,
      // Anything the module has a decoder for can be converted; `plan` only does so for what the browser can't play itself.
      decode: s.decodable ? ('ffmpeg' as const) : ('' as const),
      channels: s.channels || undefined,
      sampleRate: s.sampleRate || undefined,
    }
  })
  return { duration: durationMs > 0 ? durationMs / 1000 : null, title, tracks }
}

/** Codec strings in an init segment that this browser may spell another way (MP3 in MP4): see tracks.mimeCandidates. */
export { esdsCodec }
