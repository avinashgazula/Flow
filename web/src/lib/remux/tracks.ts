/* Turns the remuxer's track list into what the player shows, and picks what to play. Pure
   functions, so they're tested without a browser. */

import type { HeaderInfo, HeaderTrack } from './protocol'
import type { RemuxAudioTrack, RemuxSubtitleTrack } from './index'

export function parseHeader(json: string): HeaderInfo {
  return JSON.parse(json) as HeaderInfo
}

/** The MIME types a browser might know a codec by; the first it supports wins. MP3 in MP4 has two common spellings. */
export function mimeCandidates(kind: 'video' | 'audio', codec: string): string[] {
  const type = kind === 'video' ? 'video/mp4' : 'audio/mp4'
  const names = codec === 'mp4a.6B' ? ['mp4a.6B', 'mp4a.69', 'mp3'] : [codec]
  return names.map((name) => `${type}; codecs="${name}"`)
}

export function supportedMime(kind: 'video' | 'audio', codec: string, isSupported: (mime: string) => boolean): string | null {
  if (!codec) return null
  return mimeCandidates(kind, codec).find(isSupported) ?? null
}

const CODEC_NAMES: Record<string, string> = {
  'V_MPEG4/ISO/AVC': 'H.264',
  'V_MPEGH/ISO/HEVC': 'HEVC',
  V_AV1: 'AV1',
  V_VP9: 'VP9',
  A_AAC: 'AAC',
  A_AC3: 'Dolby Digital',
  A_EAC3: 'Dolby Digital Plus',
  A_OPUS: 'Opus',
  A_FLAC: 'FLAC',
  'A_MPEG/L3': 'MP3',
  A_TRUEHD: 'Dolby TrueHD',
  A_DTS: 'DTS',
  'A_DTS/EXPRESS': 'DTS Express',
  'A_DTS/LOSSLESS': 'DTS-HD',
  A_VORBIS: 'Vorbis',
}

export function codecName(codecId: string): string {
  return CODEC_NAMES[codecId] ?? codecId.replace(/^[AV]_/, '')
}

function languageName(code: string): string | undefined {
  if (!code || code === 'und' || code === 'mis' || code === 'mul' || code === 'zxx') return undefined
  try {
    const name = new Intl.DisplayNames(['en'], { type: 'language' }).of(code)
    return name && name !== code ? name : code.toUpperCase()
  } catch {
    return code.toUpperCase()
  }
}

function layout(channels: number | undefined): string {
  switch (channels) {
    case undefined:
    case 0:
      return ''
    case 1:
      return 'Mono'
    case 2:
      return 'Stereo'
    case 6:
      return '5.1'
    case 8:
      return '7.1'
    default:
      return `${channels} Channels`
  }
}

function audioLabel(t: HeaderTrack): string {
  const language = languageName(t.language)
  let label: string
  if (t.name) {
    // Muxers often write the language into the name already ("English 5.1"): don't say it twice.
    label = language && !t.name.toLowerCase().includes(language.toLowerCase()) ? `${language} · ${t.name}` : t.name
  } else {
    const detail = [codecName(t.codecId), layout(t.channels)].filter(Boolean).join(' ')
    label = [language, detail].filter(Boolean).join(' · ')
  }
  return t.commentary && !/commentary/i.test(label) ? `${label} (Commentary)` : label
}

function subtitleLabel(t: HeaderTrack): string {
  const base = t.name ?? languageName(t.language) ?? 'Subtitles'
  const flags = [t.forced && !/forced/i.test(base) ? 'Forced' : '', t.hearingImpaired && !/sdh|hearing/i.test(base) ? 'SDH' : ''].filter(Boolean)
  return flags.length ? `${base} (${flags.join(', ')})` : base
}

/** What a converted track becomes: Opus in MP4, which `convert.ts` builds in the worker. */
export const CONVERTED_MIME = 'audio/mp4; codecs="opus"'

export interface Plan {
  /** Null when the file has no video (audio only). */
  video: { track: HeaderTrack; mime: string } | null
  /** `converted` tracks play through the worker's decoder and Opus encoder instead of straight from the file. */
  audio: (RemuxAudioTrack & { mime: string | null })[]
  /** The audio track to start with, or null when the file has none. */
  defaultAudio: number | null
  subtitles: RemuxSubtitleTrack[]
}

export class UnplayableError extends Error {
  readonly code: 'video' | 'audio'
  constructor(code: 'video' | 'audio', message: string) {
    super(message)
    this.name = 'UnplayableError'
    this.code = code
  }
}

/** Decides what this browser can play from the file's tracks. A track it can't decode but the
 *  worker can (`decode` is set) still plays when `convert` says Opus can be encoded here. Throws
 *  when it can't play the picture or any of the sound. */
export function plan(info: HeaderInfo, isSupported: (mime: string) => boolean, convert = false): Plan {
  const videos = info.tracks.filter((t) => t.type === 'video')
  let video: Plan['video'] = null
  if (videos.length) {
    for (const track of videos.filter((t) => t.supported).sort((a, b) => Number(b.default) - Number(a.default))) {
      const mime = supportedMime('video', track.codec, isSupported)
      if (mime) {
        video = { track, mime }
        break
      }
    }
    if (!video) {
      const first = videos[0]!
      const name = codecName(first.codecId)
      throw new UnplayableError('video', first.supported ? `This browser can’t play ${name} video. Try a different browser, or another source.` : `Flow can’t read ${name} video yet. Try another source.`)
    }
  }

  const audio = info.tracks
    .filter((t) => t.type === 'audio')
    .map((t) => {
      const native = t.supported ? supportedMime('audio', t.codec, isSupported) : null
      // Only a track the browser can't play itself is converted: one it can play never costs the CPU.
      const converted = native === null && convert && !!t.decode
      const mime = converted ? CONVERTED_MIME : native
      return { id: t.id, label: audioLabel(t), language: t.language && t.language !== 'und' ? t.language : undefined, codec: t.codec || codecName(t.codecId), channels: t.channels, playable: mime !== null, converted, default: t.default, commentary: t.commentary, mime }
    })
  const playable = audio.filter((a) => a.playable)
  if (audio.length && !playable.length) {
    const names = [...new Set(info.tracks.filter((t) => t.type === 'audio').map((t) => codecName(t.codecId)))].join(' and ')
    throw new UnplayableError('audio', `This file only has ${names} sound, which browsers can’t play. Try another source.`)
  }
  // What plays as it is comes first; converting is for when nothing else will do.
  const best = (list: typeof audio) => list.find((a) => a.default && !a.commentary) ?? list.find((a) => !a.commentary) ?? list.find((a) => a.default) ?? list[0]
  const chosen = best(playable.filter((a) => !a.converted)) ?? best(playable)

  const subtitles = info.tracks
    .filter((t) => t.type === 'subtitle')
    .map((t): RemuxSubtitleTrack => ({ id: t.id, label: subtitleLabel(t), language: t.language && t.language !== 'und' ? t.language : undefined, kind: t.subtitleKind === 'text' ? 'text' : 'image', default: t.default, forced: t.forced }))

  return {
    video,
    audio: audio.map(({ commentary: _commentary, ...rest }) => rest),
    defaultAudio: chosen?.id ?? null,
    subtitles,
  }
}
