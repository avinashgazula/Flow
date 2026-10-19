/* One object per player that owns the <video>, the engine and the state the controls show.
   Components subscribe to the slices they draw (usePlayer), so a volume change re-renders the
   volume capsule and nothing else. The playback clock isn't state at all: the scrubber reads the
   element on each animation frame. */

import { useSyncExternalStore } from 'react'
import type { Source } from '../../lib/sources'
import { settingsStore } from '../../lib/store/settings'
import { ownTracks, type Engine, type Track } from './engine'
import { pickAudio, pickSubtitle, releaseLanguage, trackLanguage } from './languages'
import { prefs, titleChoices } from './session'
import { parseSubtitles } from './subtitles'

export type Panel = 'options' | 'tracks' | 'episodes' | null

export type FeedbackIcon = 'play' | 'pause' | 'back10' | 'forward10' | 'volume' | 'mute' | 'subtitles' | 'fullscreen' | 'exitFullscreen'

export interface Feedback {
  id: number
  icon: FeedbackIcon
  text?: string
  /** Double-tap skips flash at the side that was tapped, as in the apps. */
  side?: 'left' | 'right'
}

export interface PlayerState {
  paused: boolean
  waiting: boolean
  muted: boolean
  volume: number
  rate: number
  audio: Track[]
  audioId?: string
  /** The file plays in the browser's own player because its host blocks web pages: Flow can't see
   *  or pick its audio. */
  blocked: boolean
  subtitles: Track[]
  subtitleId: string | null
  /** The track whose cues the overlay draws. */
  subtitleTrack: TextTrack | null
  controls: boolean
  panel: Panel
  fit: 'contain' | 'cover'
  fullscreen: boolean
  pip: boolean
  /** How the picture can go to another screen here: AirPlay in Safari, Remote Playback (Cast) in Chrome. */
  cast: 'airplay' | 'remote' | null
}

const hideAfter = 3000

/** iPhone and iPad ignore `volume` (the hardware buttons own it), so they get mute only. */
export const volumeSettable = (() => {
  try {
    const probe = document.createElement('audio')
    probe.volume = 0.5
    return probe.volume === 0.5
  } catch {
    return true
  }
})()

type WebKitVideo = HTMLVideoElement & {
  webkitShowPlaybackTargetPicker?: () => void
  webkitEnterFullscreen?: () => void
  webkitSupportsPresentationMode?: (mode: string) => boolean
  webkitSetPresentationMode?: (mode: string) => void
  webkitPresentationMode?: string
  remote?: { watchAvailability(cb: (available: boolean) => void): Promise<number>; cancelWatchAvailability(id?: number): Promise<void>; prompt(): Promise<void> }
}
type WebKitElement = HTMLElement & { webkitRequestFullscreen?: () => void }
type WebKitDocument = Document & { webkitFullscreenElement?: Element | null; webkitExitFullscreen?: () => void }

export class PlayerController {
  video: HTMLVideoElement | null = null
  root: HTMLElement | null = null
  engine: Engine | null = null
  source: Source | null = null
  /** True while a finger or pointer holds the scrubber: the controls stay up. */
  scrubbing = false
  /** True while the pointer rests on a control. */
  hovering = false

  private state: PlayerState = {
    paused: true,
    waiting: false,
    muted: false,
    volume: 1,
    rate: 1,
    audio: [],
    blocked: false,
    subtitles: [],
    subtitleId: null,
    subtitleTrack: null,
    controls: true,
    panel: null,
    fit: 'contain',
    fullscreen: false,
    pip: false,
    cast: null,
  }
  private listeners = new Set<() => void>()
  private feedbackListeners = new Set<(f: Feedback) => void>()
  private hideTimer = 0
  private previewTimer = 0
  private previewAt = 0
  private feedbackId = 0
  private subtitleToken = 0
  private lastSubtitle: string | null = null
  private external = new Map<string, TextTrack>()
  /** The audio choice has been made for this stream. Subtitles aren't: they follow the audio, so
   *  they're worked out again whenever the tracks change, until the viewer picks by hand. */
  private applied = { audio: false }
  private manual = { audio: false, subtitles: false }
  /** The title the stream belongs to (a show counts once), for remembering picks, and its original
   *  language, for "Original Language" in Settings. */
  private context: { key?: string; original?: string } = {}

  get = () => this.state
  subscribe = (listener: () => void) => {
    this.listeners.add(listener)
    return () => void this.listeners.delete(listener)
  }
  private set(patch: Partial<PlayerState>) {
    let changed = false
    for (const key in patch) if (patch[key as keyof PlayerState] !== this.state[key as keyof PlayerState]) changed = true
    if (!changed) return
    this.state = { ...this.state, ...patch }
    this.listeners.forEach((l) => l())
  }

  // MARK: Wiring

  bind(video: HTMLVideoElement, root: HTMLElement): () => void {
    this.video = video
    this.root = root
    const saved = prefs.get()
    if (volumeSettable) video.volume = Math.min(1, Math.max(0, saved.volume))
    video.muted = saved.muted
    const v = video as WebKitVideo
    const sync = () => this.set({ paused: video.paused, muted: video.muted, volume: video.volume, rate: video.playbackRate })
    const onPlay = () => {
      sync()
      this.scheduleHide()
    }
    const onPause = () => {
      sync()
      this.showControls(false)
    }
    const waiting = () => this.set({ waiting: true })
    const going = () => this.set({ waiting: false })
    const pip = () => this.set({ pip: document.pictureInPictureElement === video || v.webkitPresentationMode === 'picture-in-picture' })
    const fullscreen = () => {
      const d = document as WebKitDocument
      this.set({ fullscreen: !!(d.fullscreenElement ?? d.webkitFullscreenElement) })
    }
    const airplay = (e: Event) => this.set({ cast: (e as Event & { availability?: string }).availability === 'available' ? 'airplay' : null })
    const events: [EventTarget, string, EventListener][] = [
      [video, 'play', onPlay],
      [video, 'pause', onPause],
      [video, 'volumechange', sync],
      [video, 'ratechange', sync],
      [video, 'waiting', waiting],
      [video, 'seeking', waiting],
      [video, 'playing', going],
      [video, 'seeked', going],
      [video, 'canplay', going],
      [video, 'enterpictureinpicture', pip],
      [video, 'leavepictureinpicture', pip],
      [video, 'webkitpresentationmodechanged', pip],
      [video, 'webkitplaybacktargetavailabilitychanged', airplay],
      [video, 'webkitbeginfullscreen', () => this.set({ fullscreen: true })],
      [video, 'webkitendfullscreen', () => this.set({ fullscreen: false })],
      [document, 'fullscreenchange', fullscreen],
      [document, 'webkitfullscreenchange', fullscreen],
    ]
    for (const [target, name, fn] of events) target.addEventListener(name, fn)
    let watch: number | undefined
    if (!('WebKitPlaybackTargetAvailabilityEvent' in window) && v.remote) {
      v.remote
        .watchAvailability((available) => this.set({ cast: available ? 'remote' : null }))
        .then((id) => (watch = id))
        .catch(() => {})
    }
    sync()
    return () => {
      for (const [target, name, fn] of events) target.removeEventListener(name, fn)
      if (watch !== undefined) v.remote?.cancelWatchAvailability(watch).catch(() => {})
      clearTimeout(this.hideTimer)
      clearTimeout(this.previewTimer)
    }
  }

  setEngine(engine: Engine | null, source: Source | null) {
    this.engine = engine
    this.source = source
    this.applied = { audio: false }
    this.manual = { audio: false, subtitles: false }
    for (const track of this.external.values()) track.mode = 'disabled'
    this.external.clear()
    this.subtitleToken++
    this.set({ audio: [], audioId: undefined, blocked: engine?.fallback === 'blocked', subtitles: [], subtitleId: null, subtitleTrack: null })
    if (engine) this.refreshTracks()
  }

  /** Which title is playing. The original language can arrive after the tracks do (the details are
   *  still loading), so the choice is made again then, unless the viewer has already picked. */
  setContext(key: string, original?: string) {
    const late = original !== this.context.original
    this.context = { key, original }
    if (late && this.engine && !this.manual.audio) {
      this.applied = { audio: false }
      this.applyPreferences()
    }
  }

  refreshTracks = () => {
    const engine = this.engine
    if (!engine) return
    const { tracks: audio, selected } = engine.audio()
    const inside = engine.subtitles().map((t) => ({ ...t, id: `in:${t.id}` }))
    const outside = (this.source?.subtitles ?? []).map((s, i): Track => ({ id: `ext:${i}`, label: s.label, language: s.language }))
    this.set({ audio, audioId: selected, subtitles: [...inside, ...outside] })
    this.applyPreferences()
  }

  /** Audio and subtitles for the start: the viewer's pick for this title if there is one, else
   *  Settings → Playback (see languages.ts). Runs as tracks appear, since some engines list them late. */
  private applyPreferences() {
    const { audio, audioId, subtitles } = this.state
    const settings = settingsStore.get()
    const choice = this.context.key ? titleChoices.get(this.context.key) : undefined
    let heard = audio.find((t) => t.id === audioId)
    if (!this.applied.audio && !this.manual.audio && audio.length > 0) {
      this.applied.audio = true
      const wanted = pickAudio(audio, { languages: settings.audioLanguages, original: this.context.original, choice })
      if (wanted && wanted.id !== audioId) {
        void this.selectAudio(wanted.id, false)
        heard = wanted
      }
    }
    if (this.manual.subtitles || subtitles.length === 0) return
    const audioLanguage = (heard && trackLanguage(heard)) ?? releaseLanguage(this.source?.languages)
    const pick = pickSubtitle(subtitles, { audioLanguage, preferences: settings, choice })
    if ((pick?.id ?? null) !== this.state.subtitleId) void this.selectSubtitle(pick?.id ?? null, false)
  }

  // MARK: Transport

  currentTime = () => this.video?.currentTime ?? 0
  duration = () => {
    const d = this.engine?.duration() ?? this.video?.duration ?? Number.NaN
    return Number.isFinite(d) && d > 0 ? d : Number.NaN
  }

  play() {
    const video = this.video
    if (!video) return
    video.play().catch((error: Error) => {
      // Autoplay with sound needs a tap first when the page opened straight on the player.
      if (error.name === 'NotAllowedError') this.set({ paused: true })
    })
  }
  pause = () => this.video?.pause()
  togglePlay = () => (this.video?.paused ? this.play() : this.pause())

  seekTo = (time: number) => {
    const d = this.duration()
    const target = Math.max(0, Number.isNaN(d) ? time : Math.min(d - 0.25, time))
    clearTimeout(this.previewTimer)
    if (this.engine) this.engine.seek(target)
    else if (this.video) this.video.currentTime = target
  }
  seekBy = (delta: number) => this.seekTo(this.currentTime() + delta)

  /** The picture follows a dragged scrubber, at most four times a second so a stream isn't asked
   *  for a segment per pixel. The remuxer seeks through the file's index, so it waits for the release. */
  previewSeek(time: number) {
    const video = this.video
    if (!video || this.engine?.kind === 'remux') return
    const run = () => {
      this.previewAt = performance.now()
      const v = video as HTMLVideoElement & { fastSeek?: (t: number) => void }
      if (v.fastSeek) v.fastSeek(time)
      else video.currentTime = time
    }
    clearTimeout(this.previewTimer)
    const wait = 250 - (performance.now() - this.previewAt)
    if (wait <= 0) run()
    else this.previewTimer = window.setTimeout(run, wait)
  }

  /** One frame at a time while paused (`,` and `.`). Browsers don't expose the frame rate, so a
   *  thirtieth of a second stands in: close enough to step through a shot. */
  step(frames: number) {
    const video = this.video
    if (!video || !video.paused) return
    this.seekTo(video.currentTime + frames / 30)
  }

  setVolume(volume: number) {
    const video = this.video
    if (!video) return
    const v = Math.min(1, Math.max(0, volume))
    if (volumeSettable) video.volume = v
    video.muted = v === 0
    prefs.set({ volume: v || prefs.get().volume, muted: video.muted })
  }
  toggleMute = () => {
    const video = this.video
    if (!video) return
    video.muted = !video.muted
    if (!video.muted && video.volume === 0) video.volume = 0.5
    prefs.set({ muted: video.muted })
  }
  setRate(rate: number) {
    if (!this.video) return
    this.video.playbackRate = rate
    this.video.defaultPlaybackRate = rate
  }
  setFit = (fit: PlayerState['fit']) => this.set({ fit })

  // MARK: Tracks

  async selectAudio(id: string, remember = true) {
    await this.engine?.selectAudio(id)
    const track = this.state.audio.find((t) => t.id === id)
    this.set({ audioId: id })
    if (remember) {
      this.manual.audio = true
      const language = track && trackLanguage(track)
      if (this.context.key && language) titleChoices.set(this.context.key, { audio: language })
    }
    // Subtitles follow what's heard (Foreign Audio Only), unless they were chosen by hand too.
    this.applyPreferences()
  }

  async selectSubtitle(id: string | null, remember = true) {
    const token = ++this.subtitleToken
    const previous = this.state.subtitleTrack
    if (previous && ownTracks.has(previous)) previous.mode = 'disabled'
    const info = id ? this.state.subtitles.find((t) => t.id === id) : undefined
    this.set({ subtitleId: id, subtitleTrack: null })
    if (remember) {
      this.manual.subtitles = true
      if (this.context.key) titleChoices.set(this.context.key, { subtitle: id ? info && trackLanguage(info) : null })
    }
    if (!id) {
      await this.engine?.selectSubtitle(null)
      return
    }
    this.lastSubtitle = id
    let track: TextTrack | null = null
    try {
      if (id.startsWith('ext:')) {
        await this.engine?.selectSubtitle(null)
        track = await this.loadExternal(id)
      } else {
        track = (await this.engine?.selectSubtitle(id.slice(3))) ?? null
      }
    } catch {
      if (token === this.subtitleToken) {
        this.set({ subtitleId: null })
        this.flash('subtitles', 'Couldn’t load those subtitles')
      }
      return
    }
    if (token !== this.subtitleToken) return
    if (track) track.mode = 'hidden'
    this.set({ subtitleTrack: track })
  }

  /** C: subtitles off, or back on with the last ones chosen (else ones in the viewer's languages). */
  toggleSubtitles() {
    const { subtitleId, subtitles } = this.state
    if (subtitleId) {
      void this.selectSubtitle(null)
      this.flash('subtitles', 'Subtitles Off')
      return
    }
    const { subtitleLanguages } = settingsStore.get()
    const mine = pickSubtitle(subtitles, { preferences: { subtitleLanguages: subtitleLanguages.length ? subtitleLanguages : [navigator.language], subtitleMode: 'always' } })
    const pick = subtitles.find((t) => t.id === this.lastSubtitle) ?? mine ?? subtitles.find((t) => !t.unavailable)
    if (!pick) {
      this.flash('subtitles', 'No Subtitles')
      return
    }
    void this.selectSubtitle(pick.id)
    this.flash('subtitles', pick.label)
  }

  /** An external SRT, WebVTT or ASS file, read into cues on a hidden text track of our own. */
  private async loadExternal(id: string): Promise<TextTrack | null> {
    const cached = this.external.get(id)
    if (cached) return cached
    const sub = this.source?.subtitles?.[Number(id.slice(4))]
    const video = this.video
    if (!sub || !video) return null
    const response = await fetch(sub.url)
    if (!response.ok) throw new Error(`Subtitles answered ${response.status}`)
    const cues = parseSubtitles(await response.text(), sub.format)
    const track = video.addTextTrack('subtitles', sub.label, sub.language ?? '')
    ownTracks.add(track)
    track.mode = 'hidden'
    for (const cue of cues) track.addCue(new VTTCue(cue.start, cue.end, cue.text))
    this.external.set(id, track)
    return track
  }

  // MARK: Controls

  showControls(autoHide = true) {
    clearTimeout(this.hideTimer)
    this.set({ controls: true })
    this.root?.removeAttribute('data-idle')
    if (autoHide) this.scheduleHide()
  }
  /** Pointer movement: show, and start the hide timer again. Cheap when they're already showing. */
  poke = () => this.showControls()
  scheduleHide() {
    clearTimeout(this.hideTimer)
    this.hideTimer = window.setTimeout(() => {
      if (this.video?.paused || this.scrubbing || this.hovering || this.state.panel) return
      this.hideControls()
    }, hideAfter)
  }
  hideControls() {
    if (this.state.panel || this.video?.paused) return
    clearTimeout(this.hideTimer)
    this.set({ controls: false })
    // The cursor goes with the controls. Written to the element so the screen doesn't re-render.
    this.root?.setAttribute('data-idle', '')
  }
  toggleControls = () => (this.state.controls ? this.hideControls() : this.showControls())

  setPanel = (panel: Panel) => {
    this.set({ panel })
    if (panel) this.showControls(false)
    else this.scheduleHide()
  }

  // MARK: Feedback

  onFeedback(listener: (f: Feedback) => void) {
    this.feedbackListeners.add(listener)
    return () => void this.feedbackListeners.delete(listener)
  }
  flash(icon: FeedbackIcon, text?: string, side?: Feedback['side']) {
    const f = { id: ++this.feedbackId, icon, text, side }
    this.feedbackListeners.forEach((l) => l(f))
  }

  // MARK: Screens

  toggleFullscreen = () => {
    const d = document as WebKitDocument
    if (d.fullscreenElement ?? d.webkitFullscreenElement) {
      if (d.exitFullscreen) void d.exitFullscreen().catch(() => {})
      else d.webkitExitFullscreen?.()
      return
    }
    const root = this.root as WebKitElement | null
    const video = this.video as WebKitVideo | null
    if (root?.requestFullscreen && document.fullscreenEnabled) void root.requestFullscreen({ navigationUI: 'hide' }).catch(() => {})
    else if (root?.webkitRequestFullscreen) root.webkitRequestFullscreen()
    // iPhone lets only the video itself go full screen, with Apple's own controls.
    else video?.webkitEnterFullscreen?.()
  }

  get canPip() {
    const v = this.video as WebKitVideo | null
    return !!v && ((document.pictureInPictureEnabled && !v.disablePictureInPicture) || !!v.webkitSupportsPresentationMode?.('picture-in-picture'))
  }
  togglePip = () => {
    const v = this.video as WebKitVideo | null
    if (!v) return
    if (document.pictureInPictureEnabled) {
      if (document.pictureInPictureElement) void document.exitPictureInPicture().catch(() => {})
      else void v.requestPictureInPicture().catch(() => {})
    } else if (v.webkitSetPresentationMode) {
      v.webkitSetPresentationMode(v.webkitPresentationMode === 'picture-in-picture' ? 'inline' : 'picture-in-picture')
    }
  }
  showCastPicker = () => {
    const v = this.video as WebKitVideo | null
    if (!v) return
    if (this.state.cast === 'airplay') v.webkitShowPlaybackTargetPicker?.()
    else void v.remote?.prompt().catch(() => {})
  }
}

export function usePlayer<S>(controller: PlayerController, select: (state: PlayerState) => S): S {
  return useSyncExternalStore(
    controller.subscribe,
    () => select(controller.get()),
    () => select(controller.get()),
  )
}
