/* Turning parsed traits into a Source the player can open, and ranking sources for *this* browser.

   FlowKit orders sources by the user's category and provider order and then demotes what the device
   can't decode. A browser can decode far less than an Apple TV, so the web version scores each
   source instead: preferred quality first, then release type, HDR, playability here, size sanity,
   debrid cache state and seeders. Anything this browser can't play at all sinks to the bottom with
   its reason, rather than vanishing. */

import { languageName } from '../language'
import type { Capabilities } from './capabilities'
import { losslessCinemaAudio } from './capabilities'
import { arrangeSources, categoryOf, type Arranged, type ProviderRef } from './order'
import { isCinemaCapture, releaseQualities, type ParsedQuality, type ResolutionClass, type StreamTraits } from './parser'
import { isReadable } from './proxy'
import { isHDR } from './smooth'
import type { SourceOrdering } from './sourceSettings'
import type { PlaybackEngine, ReleaseQuality, Source, SourceOrigin } from './types'

export interface BuildInput {
  id: string
  origin: SourceOrigin
  provider: string
  providerId: string
  title: string
  url: string
  traits: StreamTraits
  headers?: Record<string, string>
  filename?: string
  /** The server's own container name ("mkv", "mp4"), when it reports one. */
  container?: string
  /** A server transcode: the server makes it playable, so codec checks don't apply. */
  transcoded?: boolean
  detail?: string
  bingeGroup?: string
  serverPosition?: number
  subtitles?: Source['subtitles']
  notWebReady?: boolean
}

const resolutionNames: Record<ResolutionClass, Source['resolution']> = { 0: undefined, 480: 'SD', 720: '720p', 1080: '1080p', 1440: '1440p', 2160: '2160p' }
const videoNames: Record<string, Source['videoCodec']> = { H264: 'H.264', HEVC: 'HEVC', AV1: 'AV1', VP9: 'VP9' }
const hdrNames = new Set(['DV', 'HDR10+', 'HDR10', 'HDR', 'HLG'])
const unplayableContainers = new Set(['avi', 'wmv', 'flv', 'ts', 'm2ts', 'mts', 'iso', 'mpg', 'mpeg', 'vob', 'divx', 'rmvb', 'rm', '3gp'])

/** The container from the URL's path, else the file name: "mkv", "mp4", "m3u8"… */
export function containerOf(url: string, filename?: string, container?: string): string | undefined {
  if (container) return container.split(',')[0]!.trim().toLowerCase()
  const fromPath = (path: string) => {
    const last = path.split('/').pop() ?? ''
    const dot = last.lastIndexOf('.')
    const ext = dot > 0 ? last.slice(dot + 1).toLowerCase() : ''
    return /^[a-z0-9]{2,5}$/.test(ext) ? ext : undefined
  }
  let path = url
  try {
    path = decodeURIComponent(new URL(url, 'https://flow.invalid/').pathname)
  } catch {
    path = url.split(/[?#]/)[0]!
  }
  const fromURL = fromPath(path)
  // Debrid links often end in an opaque id; the add-on's file name says what the file is.
  if (fromURL && fromURL !== 'php' && fromURL !== 'aspx') return fromURL === 'mpegurl' ? 'm3u8' : fromURL
  if (/m3u8/i.test(url)) return 'm3u8'
  return filename ? fromPath(filename) : undefined
}

/** How the player opens a URL: hls.js for HLS where the browser has none, the remuxer for Matroska. */
export function engineFor(container: string | undefined, caps: Capabilities, needsHeaders = false): PlaybackEngine {
  if (container === 'm3u8') return caps.nativeHLS && !(needsHeaders && caps.mse) ? 'native' : 'hls'
  if (container === 'mkv' || container === 'x-matroska') return 'remux'
  return 'native'
}

/** The codecs an audio list is really carried by. Atmos is object metadata, not a codec: it rides
 *  on TrueHD or E-AC-3. Beside a named codec it adds nothing; alone it means the streaming
 *  flavour, E-AC-3. */
export function audioCarriers(audio: string[]): string[] {
  const named = audio.filter((a) => a !== 'Atmos').map((a) => (a === 'TrueHD Atmos' ? 'TrueHD' : a))
  return [...new Set(named.length === 0 && audio.includes('Atmos') ? ['DD+'] : named)]
}

/** The audio formats in the list this browser can't decode. Empty when the list is empty too:
 *  a source that doesn't say what its audio is gets the benefit of the doubt. */
export function undecodableAudio(audio: string[], caps: Capabilities): string[] {
  const carriers = audioCarriers(audio)
  if (carriers.some((a) => !losslessCinemaAudio(a) && caps.audio(a))) return []
  return carriers
}

/** True when the list names an audio format and this browser decodes at least one of them. */
export const hasPlayableAudio = (audio: string[] | undefined, caps: Capabilities): boolean => !!audio && audioCarriers(audio).length > 0 && undecodableAudio(audio, caps).length === 0

const audioLabels: Record<string, string> = { DD: 'Dolby Digital', 'DD+': 'Dolby Digital Plus' }
/** "TrueHD", "Dolby Digital Plus": a codec as a viewer would say it. */
export const audioLabel = (codec: string) => audioLabels[codec] ?? codec

/** What the source's audio is called when it's undecodable here: "TrueHD Atmos", "DTS-HD MA and Dolby
 *  Digital Plus". Empty when the audio plays. */
function undecodableNames(audio: string[], caps: Capabilities): string {
  const mute = undecodableAudio(audio, caps)
  // As written in the release ("TrueHD Atmos"), when that's what was undecodable.
  const named = mute.map((c) => audio.find((a) => a === c || (c === 'TrueHD' && a === 'TrueHD Atmos')) ?? c)
  return named.slice(0, 2).map(audioLabel).join(' and ')
}

/** Whether conversion is what makes the file's audio play: the browser can convert, and Flow can
 *  read the file, which conversion needs. Only the remuxer converts, so the container has to be
 *  Matroska, or unknown (an opaque debrid link, which is Matroska whenever it carries TrueHD or DTS). */
export function convertsAudio(input: { url?: string; container?: string; engine: PlaybackEngine; audio: string[]; transcoded?: boolean }, caps: Capabilities): boolean {
  if (input.transcoded || !caps.convertAudio || undecodableAudio(input.audio, caps).length === 0) return false
  if (input.engine !== 'remux' && input.container !== undefined) return false
  return !input.url || isReadable(input.url)
}

/** Why this browser can't play the source, or undefined when it can. */
export function unsupportedReason(input: { url?: string; container?: string; engine: PlaybackEngine; videoCodec?: string; audio: string[]; headers?: Record<string, string>; transcoded?: boolean }, caps: Capabilities): string | undefined {
  const { container, engine } = input
  if (container && unplayableContainers.has(container)) return `${container.toUpperCase()} files can’t play in a browser`
  if (engine === 'remux' && !caps.mse) return 'Matroska needs a newer browser: Safari 17.1 or later, Chrome, Edge or Firefox'
  if (engine === 'hls' && !caps.mse) return 'This browser can’t play HLS streams'
  if (engine === 'native' && container !== 'm3u8' && input.headers && Object.keys(input.headers).length > 0) return 'Needs request headers a browser can’t send'
  if (input.transcoded) return undefined
  // Without sound the film is no use. The remuxer can't play a format the browser can't decode, but
  // it can convert one (see convertsAudio); otherwise a file whose every audio format is
  // undecodable here is unplayable.
  const mute = undecodableAudio(input.audio, caps)
  if (mute.length > 0 && !convertsAudio(input, caps)) {
    // DTS and TrueHD play nowhere; Dolby Digital depends on the browser.
    return `${undecodableNames(input.audio, caps)} audio can’t play in ${mute.every(losslessCinemaAudio) ? 'a' : 'this'} browser`
  }
  const video = input.videoCodec
  if (video === 'XviD') return 'XviD video can’t play in a browser'
  if (video && !caps.video(video)) return `${video === 'H264' ? 'H.264' : video} video can’t play in this browser`
  return undefined
}

/** A short hash, so the same URL gets the same id on every search. */
export function stableHash(text: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return (h >>> 0).toString(36)
}

export function buildSource(input: BuildInput, caps: Capabilities): Source {
  const t = input.traits
  const container = containerOf(input.url, input.filename, input.container)
  const headers = input.headers && Object.keys(input.headers).length > 0 ? input.headers : undefined
  let engine = input.transcoded ? engineFor('m3u8', caps, !!headers) : engineFor(container, caps, !!headers)
  const audio = audioList(t)
  const converts = convertsAudio({ url: input.url, container, engine, audio, transcoded: input.transcoded }, caps)
  // A link that doesn't say what it is can only convert in the remuxer, so it goes there: the audio
  // that needs converting is TrueHD or DTS, which only Matroska files carry in practice.
  if (converts && engine === 'native' && container === undefined && !headers) engine = 'remux'
  const source: Source = {
    id: input.id,
    origin: input.origin,
    provider: input.provider,
    providerId: input.providerId,
    title: input.title,
    url: input.url,
    engine,
    container: input.transcoded ? 'm3u8' : container,
  }
  if (headers) source.headers = headers
  const resolution = resolutionNames[t.resolution]
  if (resolution) source.resolution = resolution
  const hdr = t.hdr.filter((h) => hdrNames.has(h)) as NonNullable<Source['hdr']>
  if (hdr.length) source.hdr = hdr
  const video = t.videoCodec ? videoNames[t.videoCodec] : undefined
  if (video) source.videoCodec = video
  if (audio.length) source.audio = audio
  if (t.audioChannels) source.audioChannels = t.audioChannels
  if (t.sizeBytes) source.sizeBytes = t.sizeBytes
  if (t.quality !== 'Unknown') source.quality = t.quality as ReleaseQuality
  if (t.languages.length) source.languages = t.languages
  if (t.releaseGroup) source.releaseGroup = t.releaseGroup
  if (t.seeders !== undefined) source.seeders = t.seeders
  if (t.isCached !== undefined) source.cached = t.isCached
  if (input.filename) source.filename = input.filename
  if (input.detail) source.detail = input.detail
  if (input.bingeGroup) source.bingeGroup = input.bingeGroup
  if (input.serverPosition && input.serverPosition > 0) source.serverPosition = input.serverPosition
  if (input.subtitles?.length) source.subtitles = input.subtitles
  if (input.notWebReady) source.notWebReady = true
  const reason = unsupportedReason({ url: input.url, container: source.container, engine, videoCodec: t.videoCodec, audio, headers, transcoded: input.transcoded }, caps)
  if (reason) source.unsupported = reason
  else if (converts && engine === 'remux') {
    source.convertsAudio = true
    source.note = `${undecodableNames(audio, caps)} audio converted for this browser`
  }
  return source
}

/** The leading format first, then the rest it names, without saying the same codec twice. */
function audioList(t: StreamTraits): string[] {
  const out: string[] = []
  const add = (a: string) => {
    if (!out.includes(a)) out.push(a)
  }
  if (t.audioCodec) add(t.audioCodec)
  for (const a of t.audioCodecs) {
    if (a === 'TrueHD' && out.includes('TrueHD Atmos')) continue
    add(a)
  }
  return out
}

// MARK: - Ranking

export interface RankPreferences {
  preferredQuality: '2160p' | '1080p' | '720p' | 'any'
  /** Episodes are smaller than films; size sanity scales with it. */
  kind?: 'movie' | 'show'
  /** The viewer's first audio language as a code ("en"), already resolved against the title's
   *  original language. Sources that say they carry it are lifted a little. */
  audioLanguage?: string
}

const resolutionOrder: (Source['resolution'] | undefined)[] = ['SD', '720p', '1080p', '1440p', '2160p']
const resolutionStep = (r: Source['resolution']) => {
  if (r === '480p') return 0
  const i = resolutionOrder.indexOf(r)
  // Unknown resolution sits between SD and 720p: it's usually a stream that just doesn't say.
  return i < 0 ? 0.5 : i
}

/** How well the resolution fits the preference: the preferred one scores highest, lower ones less,
 *  and higher ones just under the preferred one (closer first), so they stay offered but don't lead. */
export function resolutionScore(r: Source['resolution'], preferred: RankPreferences['preferredQuality']): number {
  const step = resolutionStep(r)
  if (preferred === 'any') return step
  const want = resolutionOrder.indexOf(preferred)
  if (step <= want) return step
  return want - 0.4 - 0.1 * (step - want)
}

const minimumBytes: Record<string, number> = { SD: 200, '480p': 200, '720p': 400, '1080p': 700, '1440p': 1000, '2160p': 1500 }

/** A nudge for a release that names the viewer's audio language, well short of a resolution step
 *  (1000). "Multi" releases usually carry it, but say so less surely. Releases that name no language
 *  get nothing: most are in the language of the title and can't be told apart. */
export function audioLanguageScore(languages: string[] | undefined, audioLanguage: string | undefined): number {
  const name = languageName(audioLanguage)?.toLowerCase()
  if (!languages?.length || !name) return 0
  if (languages.some((l) => l.toLowerCase() === name)) return 100
  return languages.includes('Multi') ? 50 : 0
}

/** A file this device is known to decode in software, too slowly: more than a resolution step and
 *  its usual extras (HDR, a remux's quality, the viewer's own server), so a smooth 1080p copy of the
 *  same title beats a 4K one that stutters, whatever the preferred quality is. Still far above
 *  anything unsupported. */
export const stutterPenalty = 3500
/** A file this device decodes smoothly but not on hardware: a nudge that costs battery and heat, not
 *  enough to turn a better picture down. */
export const inefficientPenalty = 300

/** How the device copes with the source's video, when it has said: `rough` for a known stutter,
 *  `warm` for software decoding that keeps up. A server's transcode is decoded as the server made it,
 *  not as the original file was, so it's left alone. */
export function decodeFeel(s: Source, caps: Capabilities): 'rough' | 'warm' | undefined {
  if (s.container === 'm3u8' && (s.origin === 'jellyfin' || s.origin === 'emby' || s.origin === 'plex')) return undefined
  const decode = caps.smoothVideo(s.videoCodec, s.resolution, isHDR(s.hdr))
  if (!decode) return undefined
  if (decode.smooth === false) return 'rough'
  return decode.powerEfficient === false ? 'warm' : undefined
}

export const stutterNote = 'May stutter on this device'

export function scoreSource(s: Source, prefs: RankPreferences, caps: Capabilities): number {
  if (s.unsupported) return -1_000_000 + resolutionScore(s.resolution, prefs.preferredQuality) * 10
  let score = resolutionScore(s.resolution, prefs.preferredQuality) * 1000
  const feel = decodeFeel(s, caps)
  if (feel === 'rough') score -= stutterPenalty
  else if (feel === 'warm') score -= inefficientPenalty
  if (isCinemaCapture(s.quality as ParsedQuality)) score -= 3000
  score += Math.max(0, releaseQualities.indexOf((s.quality ?? 'Unknown') as ParsedQuality)) * 30
  // HDR only helps on a screen that shows it; elsewhere the browser tone-maps it, so SDR goes first.
  const hdrRank = s.hdr?.includes('DV') ? 3 : s.hdr?.includes('HDR10+') ? 2 : s.hdr?.length ? 1 : 0
  score += caps.hdr ? hdrRank * 60 : hdrRank ? -40 : 0
  if (s.sizeBytes) {
    const mb = s.sizeBytes / 1_048_576
    const episode = prefs.kind === 'show'
    const minimum = (minimumBytes[s.resolution ?? ''] ?? 150) / (episode ? 4 : 1)
    if (mb < minimum) score -= 250
    if (mb > (episode ? 25_000 : 100_000)) score -= 150
  }
  // Stremio's own web player would need its streaming server for these; HLS and Matroska are handled here.
  if (s.notWebReady && s.engine === 'native') score -= 120
  // Converting costs the browser some work and the start a moment: the same file with sound that
  // plays as it is comes first, but a better picture is still worth the conversion.
  if (s.convertsAudio) score -= 200
  score += audioLanguageScore(s.languages, prefs.audioLanguage)
  if (s.cached === true) score += 80
  if (s.cached === false) score -= 400
  if (s.seeders !== undefined) score += Math.min(60, Math.log10(s.seeders + 1) * 20)
  // The viewer's own server is the most dependable copy at the same quality.
  if (s.origin === 'jellyfin' || s.origin === 'emby' || s.origin === 'plex' || s.origin === 'webdav') score += 300
  return score
}

/** Best first. Ties keep the providers' own order. */
export function rankSources(list: Source[], prefs: RankPreferences, caps: Capabilities): Source[] {
  return list
    .map((s, i) => ({ s: withDecodeNote({ ...s, score: Math.round(scoreSource(s, prefs, caps)) }, caps), i }))
    .sort((a, b) => b.s.score! - a.s.score! || a.i - b.i)
    .map((x) => x.s)
}

/** How the viewer wants the ranked list arranged (Settings → Sources), and who is being asked. */
export interface Arrangement {
  ordering: SourceOrdering
  providers: { id: string; kind: SourceOrigin }[]
}

/** The ranked list, then arranged by the viewer's category and provider order and, with custom ordering on,
 *  their filters, sort rules and result cap. The score decides ties, so the smooth-decode, HDR and
 *  audio-language ranking above still shapes the order wherever the settings don't say otherwise. */
export function orderedSources(list: Source[], prefs: RankPreferences, caps: Capabilities, arrangement: Arrangement): Arranged {
  const providers: ProviderRef[] = arrangement.providers.map((p) => ({ id: p.id, category: categoryOf(p.kind) }))
  return arrangeSources(rankSources(list, prefs, caps), arrangement.ordering, {
    providers,
    audioLanguage: prefs.audioLanguage,
    hdrScreen: caps.hdr,
    resolutionFit: (s) => resolutionScore(s.resolution, prefs.preferredQuality),
  })
}

/** Says in the picker that a source is known to stutter here, after any note it already has
 *  ("TrueHD audio converted for this browser"). Safe to run on a list that was ranked before. */
function withDecodeNote(s: Source, caps: Capabilities): Source {
  if (s.unsupported || decodeFeel(s, caps) !== 'rough') return s
  s.mayStutter = true
  if (!s.note?.includes(stutterNote)) s.note = s.note ? `${s.note} · ${stutterNote}` : stutterNote
  return s
}

/** The same file offered twice (an aggregator and the add-on it wraps, or one add-on installed
 *  twice) is listed once. */
export function dedupeKey(s: Source): string {
  return s.origin === 'demo' ? s.id : s.url
}

export function dedupe(list: Source[]): Source[] {
  const seen = new Set<string>()
  return list.filter((s) => {
    const key = dedupeKey(s)
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}
