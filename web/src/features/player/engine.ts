/* Opens a source in a <video>: the browser's own player, hls.js, or the Matroska remuxer. Each
   engine answers the same small interface, so the controls never ask which one is running.
   hls.js and the remuxer are dynamic imports: a film that plays natively never downloads them. */

import type { HlsConfig } from 'hls.js'
import type { Source } from '../../lib/sources'
import { hlsErrorMessage, PlaybackError } from './errors'
import { trackLabel } from './format'
import { prefs } from './session'

export interface Track {
  id: string
  label: string
  language?: string
  /** Why it can't be chosen (a DTS track in a browser that can't decode it). */
  unavailable?: string
}

export interface Engine {
  readonly kind: 'native' | 'hls' | 'remux'
  audio(): { tracks: Track[]; selected?: string }
  selectAudio(id: string): void | Promise<void>
  /** Subtitles inside the stream. External files are the controller's job. */
  subtitles(): Track[]
  /** Turns a stream subtitle on (cues arrive on the returned track, kept hidden: the player draws
   *  them) or all of them off with null. */
  selectSubtitle(id: string | null): Promise<TextTrack | null>
  seek(time: number): void
  /** The remuxer knows the length before the browser does; the others defer to the element. */
  duration(): number
  /** One more go after a decode error. False once that has been tried. */
  recover(): boolean
  destroy(): void
}

export interface AttachOptions {
  startAt?: number
  signal: AbortSignal
  /** The track lists changed (a manifest parsed, an audio group switched). */
  onTracks: () => void
  onFatal: (error: PlaybackError) => void
}

/** Text tracks the player added itself (external files, remuxed cues), so engines don't list them. */
export const ownTracks = new WeakSet<TextTrack>()

const hlsMime = 'application/vnd.apple.mpegurl'

/** Safari plays HLS itself, with AirPlay, Picture in Picture and less battery than MSE. Chrome's
 *  newer builds also answer "maybe" for HLS but lack the track APIs, so only Apple's engine counts. */
const nativeHls = (video: HTMLVideoElement) => video.canPlayType(hlsMime) !== '' && /Apple/.test(navigator.vendor)

export async function attachSource(video: HTMLVideoElement, source: Source, options: AttachOptions): Promise<Engine> {
  const looksHls = /\.m3u8($|\?)/i.test(source.url)
  if (source.engine === 'remux') return attachRemux(video, source, options)
  if ((source.engine === 'hls' || looksHls) && !nativeHls(video)) return attachHls(video, source, options)
  return attachNative(video, source, options)
}

// MARK: Native

interface MediaTrackLike {
  label: string
  language: string
  enabled: boolean
}
interface MediaTrackList extends EventTarget {
  readonly length: number
  [index: number]: MediaTrackLike
}

function subtitleTracksOf(video: HTMLVideoElement): TextTrack[] {
  return Array.from(video.textTracks).filter((t) => (t.kind === 'subtitles' || t.kind === 'captions') && !ownTracks.has(t))
}

function attachNative(video: HTMLVideoElement, source: Source, { startAt, onTracks }: AttachOptions): Engine {
  const audioList = (video as HTMLVideoElement & { audioTracks?: MediaTrackList }).audioTracks
  audioList?.addEventListener('addtrack', onTracks)
  audioList?.addEventListener('change', onTracks)
  video.textTracks.addEventListener('addtrack', onTracks)
  if (startAt) video.addEventListener('loadedmetadata', () => (video.currentTime = startAt), { once: true })
  video.src = source.url

  return {
    kind: 'native',
    audio() {
      if (!audioList || audioList.length < 1) return { tracks: [] }
      const tracks: Track[] = []
      let selected: string | undefined
      for (let i = 0; i < audioList.length; i++) {
        const t = audioList[i]!
        tracks.push({ id: String(i), label: trackLabel({ name: t.label, language: t.language }), language: t.language || undefined })
        if (t.enabled) selected = String(i)
      }
      return { tracks, selected }
    },
    selectAudio(id) {
      if (!audioList) return
      for (let i = 0; i < audioList.length; i++) audioList[i]!.enabled = String(i) === id
    },
    subtitles: () => subtitleTracksOf(video).map((t, i) => ({ id: String(i), label: trackLabel({ name: t.label, language: t.language }), language: t.language || undefined })),
    async selectSubtitle(id) {
      let chosen: TextTrack | null = null
      subtitleTracksOf(video).forEach((t, i) => {
        const on = String(i) === id
        t.mode = on ? 'hidden' : 'disabled'
        if (on) chosen = t
      })
      return chosen
    },
    seek: (time) => (video.currentTime = time),
    duration: () => video.duration,
    recover: () => false,
    destroy() {
      audioList?.removeEventListener('addtrack', onTracks)
      audioList?.removeEventListener('change', onTracks)
      video.textTracks.removeEventListener('addtrack', onTracks)
      video.removeAttribute('src')
      video.load()
    },
  }
}

// MARK: hls.js

/** Bits per second to start from: what the last stream measured, else what the browser reports
 *  for the connection, else a broadband guess. hls.js's own default (500 kb/s) starts every
 *  stream blurry for its first seconds. */
function bandwidthEstimate(): number {
  const saved = prefs.get().bandwidth
  if (saved && saved > 0) return saved
  const downlink = (navigator as Navigator & { connection?: { downlink?: number } }).connection?.downlink
  return downlink ? downlink * 1_000_000 * 0.8 : 5_000_000
}

async function attachHls(video: HTMLVideoElement, source: Source, options: AttachOptions): Promise<Engine> {
  const { default: Hls } = await import('hls.js')
  if (options.signal.aborted) throw new DOMException('Aborted', 'AbortError')
  if (!Hls.isSupported()) {
    if (video.canPlayType(hlsMime)) return attachNative(video, source, options)
    throw new PlaybackError('This browser can’t play streams like this one. Try a current Safari, Chrome, Edge or Firefox.')
  }
  const { headers } = source
  const estimate = bandwidthEstimate()
  const config: Partial<HlsConfig> = {
    // Tuned for a fast first frame on video on demand, not for live latency.
    abrEwmaDefaultEstimate: estimate,
    capLevelToPlayerSize: true,
    maxBufferLength: 30,
    maxMaxBufferLength: 60,
    backBufferLength: 30,
    lowLatencyMode: false,
    startFragPrefetch: true,
    // CEA-608 captions would arrive as extra native tracks the player doesn't list or draw.
    enableCEA708Captions: false,
    startPosition: options.startAt ?? -1,
    xhrSetup: headers ? (xhr) => Object.entries(headers).forEach(([k, v]) => xhr.setRequestHeader(k, v)) : undefined,
  }
  const hls = new Hls(config)
  // Subtitle cues land on hidden tracks; the player draws them in its own overlay.
  hls.subtitleDisplay = false
  let wantedSubtitle = -1
  let recovered = false

  hls.on(Hls.Events.MANIFEST_PARSED, (_, data) => {
    // The best level the estimate can carry with headroom and the screen can show. hls.js caps
    // its own choices to the player size, but not an explicit start level.
    const levels = data.levels
    const screen = (video.clientHeight || window.innerHeight) * (window.devicePixelRatio || 1) * 1.2
    let start = 0
    levels.forEach((level, i) => {
      const fits = level.bitrate <= estimate * 0.7 && (!level.height || level.height <= screen)
      if (fits && level.bitrate >= (levels[start]?.bitrate ?? 0)) start = i
    })
    hls.startLevel = start
    options.onTracks()
  })
  // hls.js turns on the stream's DEFAULT subtitle by itself; the viewer's choice (or off) wins.
  hls.on(Hls.Events.SUBTITLE_TRACKS_UPDATED, () => {
    if (hls.subtitleTrack !== wantedSubtitle) hls.subtitleTrack = wantedSubtitle
    options.onTracks()
  })
  hls.on(Hls.Events.AUDIO_TRACKS_UPDATED, options.onTracks)
  hls.on(Hls.Events.AUDIO_TRACK_SWITCHED, options.onTracks)
  hls.on(Hls.Events.ERROR, (_, data) => {
    if (!data.fatal) return
    if (data.type === Hls.ErrorTypes.MEDIA_ERROR && !recovered) {
      recovered = true
      hls.recoverMediaError()
      return
    }
    options.onFatal(new PlaybackError(hlsErrorMessage(data.type, data.details), `hls.js ${data.type}: ${data.details}`))
  })
  hls.attachMedia(video)
  hls.loadSource(source.url)

  return {
    kind: 'hls',
    audio: () => ({
      tracks: hls.audioTracks.map((t, i) => ({ id: String(i), label: trackLabel({ name: t.name, language: t.lang, channels: t.channels }), language: t.lang })),
      selected: hls.audioTrack >= 0 ? String(hls.audioTrack) : undefined,
    }),
    selectAudio: (id) => void (hls.audioTrack = Number(id)),
    subtitles: () => hls.subtitleTracks.map((t, i) => ({ id: String(i), label: trackLabel({ name: t.name, language: t.lang, forced: t.forced }), language: t.lang })),
    async selectSubtitle(id) {
      wantedSubtitle = id === null ? -1 : Number(id)
      hls.subtitleTrack = wantedSubtitle
      if (wantedSubtitle < 0) return null
      // hls.js adds the track element as it switches; give it a moment on slow devices.
      for (let i = 0; i < 30; i++) {
        const node = hls.subtitleTracks[wantedSubtitle]?.trackNode
        if (node) {
          node.track.mode = 'hidden'
          return node.track
        }
        await new Promise((r) => setTimeout(r, 100))
      }
      return null
    },
    seek: (time) => (video.currentTime = time),
    duration: () => video.duration,
    recover() {
      if (recovered) return false
      recovered = true
      hls.recoverMediaError()
      return true
    },
    destroy() {
      const measured = hls.bandwidthEstimate
      if (Number.isFinite(measured) && measured > 0) prefs.set({ bandwidth: Math.round(measured) })
      hls.destroy()
      video.removeAttribute('src')
      video.load()
    },
  }
}

// MARK: Matroska

async function attachRemux(video: HTMLVideoElement, source: Source, { startAt, signal }: AttachOptions): Promise<Engine> {
  const { attachMatroska, remuxSupported } = await import('../../lib/remux')
  if (!remuxSupported()) throw new PlaybackError('This browser can’t play MKV files. On iPhone, update to iOS 17.1 or later, or pick another source.')
  let session
  try {
    session = await attachMatroska(video, source.url, { headers: source.headers, startAt, signal })
  } catch (error) {
    if ((error as Error).name === 'AbortError') throw error
    const message = (error as Error).message || 'This file couldn’t be opened.'
    throw new PlaybackError(/source/i.test(message) ? message : `${message.replace(/\.?$/, '.')} Pick another source.`, 'remux')
  }
  const remux = session
  let unsubscribe: (() => void) | undefined
  let current: TextTrack | null = null

  return {
    kind: 'remux',
    audio: () => ({
      tracks: remux.audioTracks.map((t) => ({
        id: String(t.id),
        label: trackLabel({ name: t.label, language: t.language, channels: t.channels }),
        language: t.language,
        unavailable: t.playable ? undefined : `${t.codec} can’t play in this browser`,
      })),
      selected: String(remux.audioTracks.find((t) => t.default && t.playable)?.id ?? remux.audioTracks.find((t) => t.playable)?.id ?? ''),
    }),
    selectAudio: (id) => remux.selectAudio(Number(id)),
    subtitles: () =>
      remux.subtitleTracks.map((t) => ({
        id: String(t.id),
        label: trackLabel({ name: t.label, language: t.language, forced: t.forced }),
        language: t.language,
        unavailable: t.kind === 'image' ? 'Picture subtitles aren’t supported yet' : undefined,
      })),
    async selectSubtitle(id) {
      unsubscribe?.()
      unsubscribe = undefined
      if (current) current.mode = 'disabled'
      current = null
      if (id === null) return null
      const info = remux.subtitleTracks.find((t) => String(t.id) === id)
      const track = video.addTextTrack('subtitles', info?.label ?? 'Subtitles', info?.language ?? '')
      ownTracks.add(track)
      track.mode = 'hidden'
      const seen = new Set<string>()
      unsubscribe = remux.onSubtitleCues(Number(id), (cues) => {
        for (const cue of cues) {
          // The same cues come again after a seek; keep one of each.
          const key = `${cue.start}|${cue.text}`
          if (seen.has(key)) continue
          seen.add(key)
          track.addCue(new VTTCue(cue.start, cue.end, cue.text))
        }
      })
      current = track
      return track
    },
    seek: (time) => void remux.seek(time),
    duration: () => remux.duration || video.duration,
    recover: () => false,
    destroy() {
      unsubscribe?.()
      if (current) current.mode = 'disabled'
      remux.destroy()
    },
  }
}
