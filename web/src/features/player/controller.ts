/* One object per player that owns the <video>, the engine and the state the controls show.
   Components subscribe to the slices they draw (usePlayer), so a volume change re-renders the
   volume capsule and nothing else. The playback clock isn't state at all: the scrubber reads the
   element on each animation frame. */

import { useSyncExternalStore } from 'react'
import type { Source } from '../../lib/sources'
import { settingsStore } from '../../lib/store/settings'
import { ownTracks, type Engine, type Track } from './engine'
import { pickAudio, pickSubtitle, releaseLanguage, trackLanguage } from './languages'
import { detectPlatform, launchURL, streamLink, externalPlayerTitle, type ExternalPlayerId } from './externalPlayers'
import { planReplay, replayDone, replaySeconds } from './replay'
import { prefs, titleChoices } from './session'
import type { SkipSegment } from './segments'
import { sleepDoneNotice, sleepSetNotice, sleepTimer, type SleepChoice } from './sleepTimer'
import { clampDelay, rememberDelay, rememberedDelay } from './subtitleDelay'
import { parseSubtitles } from './subtitles'
import { canBoost, clampBoost, VolumeBoost } from './volumeBoost'
import { ScreenAwake, wantsWakeLock } from './wakeLock'

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
  /** With `blocked`: why the stream proxy couldn't open the file, when one was tried. */
  proxyError?: string
  subtitles: Track[]
  subtitleId: string | null
  /** The track whose cues the overlay draws. */
  subtitleTrack: TextTrack | null
  controls: boolean
  panel: Panel
  /** The options panel is on a page that changes the subtitles on screen, and clears the way for them: Subtitle Style (the
   *  overlay also shows a sample line) or Subtitle Delay (the real line, moving). */
  styling: 'style' | 'delay' | null
  /** The Playback Info card is up (I, or Options). */
  info: boolean
  fit: 'contain' | 'cover'
  fullscreen: boolean
  pip: boolean
  /** How the picture can go to another screen here: AirPlay in Safari, Remote Playback (Cast) in Chrome. */
  cast: 'airplay' | 'remote' | null
  /** What can be skipped in this stream (an intro, a recap, the credits), in time order; empty until a
   *  server, a service or the file's chapters say. */
  segments: SkipSegment[]
  /** The Up Next card (or Because You Watched) is on screen, so the Skip button leaves that corner to it. */
  upNext: boolean
  /** The sleep timer: minutes, or "end" for the end of this episode or film. */
  sleep: SleepChoice | null
  /** Playing at double speed while a finger or a key is held. */
  fast: boolean
  /** Seconds the subtitles Flow draws are shifted by (positive is later), kept per title for this visit. */
  subtitleDelay: number
  /** Volume Boost can be offered: this stream goes through Web Audio without being silenced (see volumeBoost.ts). */
  boostable: boolean
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
    styling: null,
    info: false,
    fit: 'contain',
    fullscreen: false,
    pip: false,
    cast: null,
    segments: [],
    upNext: false,
    sleep: null,
    fast: false,
    subtitleDelay: 0,
    boostable: false,
  }
  private listeners = new Set<() => void>()
  private feedbackListeners = new Set<(f: Feedback) => void>()
  private peekListeners = new Set<(time: number) => void>()
  private noticeListeners = new Set<(text: string) => void>()
  private sleepEndListeners = new Set<() => void>()
  /** The sleep timer is fading the sound: the volume it fades from. */
  private fade: { base: number } | null = null
  /** The speed to go back to when a hold for double speed lets go. */
  private held: number | null = null
  /** The video ended while the sleep timer was set to end with it, so nothing may carry on to the next episode. */
  private endedBySleep = false
  /** What What Did They Say? turned on, until it turns it off again. */
  private replay: { id: string; until: number; startedAt: number; last: string | null; timer: number } | null = null
  private boost: VolumeBoost | null = null
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
    // The screen stays awake while the picture plays and the page shows.
    const awake = new ScreenAwake()
    const keepAwake = () => void awake.update(wantsWakeLock({ paused: video.paused, ended: video.ended, hidden: document.hidden }))
    const ended = () => {
      if (sleepTimer.choice === 'end') {
        // "End of Episode or Movie": this one finishes, and nothing starts after it.
        this.endedBySleep = true
        sleepTimer.clear()
        this.sleepEndListeners.forEach((l) => l())
      }
    }
    const events: [EventTarget, string, EventListener][] = [
      [video, 'play', onPlay],
      [video, 'play', keepAwake],
      [video, 'pause', keepAwake],
      [video, 'ended', keepAwake],
      [video, 'ended', ended],
      [video, 'play', () => this.boost?.resume()],
      [document, 'visibilitychange', keepAwake],
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

    // The sleep timer is the player's, not this episode's: it is looked at once a second, here.
    this.endedBySleep = false
    if (sleepTimer.choice === 'end') sleepTimer.clear()
    this.set({ sleep: sleepTimer.choice })
    const offSleep = sleepTimer.subscribe(() => this.set({ sleep: sleepTimer.choice }))
    const sleepClock = window.setInterval(() => this.tickSleep(), 1000)
    this.boost = new VolumeBoost(video)
    // Web Audio starts only after a tap or key press, so a boost that couldn't start with the stream does at the next.
    const retryBoost = () => void this.applyBoost(false)
    window.addEventListener('pointerdown', retryBoost, true)
    window.addEventListener('keydown', retryBoost, true)
    keepAwake()
    return () => {
      for (const [target, name, fn] of events) target.removeEventListener(name, fn)
      if (watch !== undefined) v.remote?.cancelWatchAvailability(watch).catch(() => {})
      clearTimeout(this.hideTimer)
      clearTimeout(this.previewTimer)
      clearInterval(sleepClock)
      offSleep()
      window.removeEventListener('pointerdown', retryBoost, true)
      window.removeEventListener('keydown', retryBoost, true)
      this.endReplay()
      this.holdFast(false)
      void awake.release()
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
    this.endReplay()
    this.set({ audio: [], audioId: undefined, blocked: engine?.fallback === 'blocked', proxyError: engine?.proxyError, subtitles: [], subtitleId: null, subtitleTrack: null })
    if (engine) this.refreshTracks()
    this.set({ boostable: !!engine && !!source && !!this.boost?.supported && canBoost({ engine: engine.kind, blocked: engine.fallback === 'blocked', url: source.url, origin: location.origin }) })
    void this.applyBoost(false)
  }

  /** Which title is playing. The original language can arrive after the tracks do (the details are
   *  still loading), so the choice is made again then, unless the viewer has already picked. */
  setContext(key: string, original?: string) {
    const late = original !== this.context.original
    this.context = { key, original }
    this.set({ subtitleDelay: rememberedDelay(key) })
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

  /** Shows the seek preview at `time` for a moment, for seeks that aren't made on the scrubber (the arrow keys). */
  peek(time: number) {
    this.peekListeners.forEach((l) => l(time))
  }
  onPeek(listener: (time: number) => void) {
    this.peekListeners.add(listener)
    return () => void this.peekListeners.delete(listener)
  }

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
    // A volume chosen while the sleep timer fades the sound is what it fades from.
    if (this.fade) this.fade.base = v
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

  // MARK: Hold for double speed

  /** Plays at 2× while held (a finger on the picture, or the X key), then goes back to the speed it was at. Does
   *  nothing while paused, as in the apps. Returns whether it started. */
  holdFast(on: boolean): boolean {
    const video = this.video
    if (!video) return false
    if (on) {
      if (this.held !== null || video.paused) return false
      this.held = video.playbackRate
      video.playbackRate = 2
      this.set({ fast: true })
      return true
    }
    if (this.held === null) return false
    video.playbackRate = this.held
    this.held = null
    this.set({ fast: false })
    return true
  }

  // MARK: Sleep timer

  /** After this long, or at the end of this episode or film. The sound fades over the last 30 seconds, then the
   *  picture pauses. Where the browser won't let a page set the volume (iPhone and iPad) it just pauses. */
  setSleep(choice: SleepChoice | null) {
    this.restoreFade()
    sleepTimer.set(choice)
    this.notify(choice === null ? 'Sleep timer off.' : sleepSetNotice(choice))
  }
  private restoreFade() {
    if (this.fade && this.video && volumeSettable) this.video.volume = this.fade.base
    this.fade = null
  }
  private tickSleep() {
    const video = this.video
    const check = sleepTimer.check()
    if (!video || !check) return
    if (check.fire) {
      this.restoreFade()
      sleepTimer.clear()
      if (!video.paused) {
        video.pause()
        this.notify(sleepDoneNotice)
      }
      return
    }
    if (check.level < 1 && volumeSettable && !video.paused) {
      this.fade ??= { base: video.volume }
      video.volume = this.fade.base * check.level
    }
  }
  /** The sleep timer says this episode is the last (End of Episode or Movie): the next one isn't to start by itself. */
  get sleepHold(): boolean {
    return this.endedBySleep || sleepTimer.choice === 'end'
  }
  /** Called when the video ends with the sleep timer waiting for that: the screen closes the player. */
  onSleepEnd(listener: () => void) {
    this.sleepEndListeners.add(listener)
    return () => void this.sleepEndListeners.delete(listener)
  }

  // MARK: What did they say?

  /** Ten seconds back, with subtitles showing just for that stretch even if they are off, then as they were. */
  replayWithSubtitles() {
    const video = this.video
    if (!video) return
    const until = video.currentTime
    this.seekTo(until - replaySeconds)
    this.flash('back10')
    this.poke()
    const { subtitles, subtitleId } = this.state
    // Asked again while the first replay's subtitles are still up: it is the same replay, from the new moment.
    if (this.replay && subtitleId === this.replay.id) {
      this.replay.until = until
      this.replay.startedAt = performance.now()
      return
    }
    const { subtitleLanguages } = settingsStore.get()
    const plan = planReplay(subtitles, subtitleId, subtitleLanguages.length ? subtitleLanguages : [navigator.language])
    if (plan.kind === 'seek') return
    if (plan.kind === 'none') {
      this.notify('This video has no subtitles to show.')
      return
    }
    const id = plan.track.id
    const last = this.lastSubtitle
    this.endReplay()
    const replay = { id, until, startedAt: performance.now(), last, timer: 0 }
    this.replay = replay
    void this.selectSubtitle(id, false).then(() => {
      // Choosing them for a moment isn't choosing them: C still brings back what was picked before.
      this.lastSubtitle = last
    })
    replay.timer = window.setInterval(() => {
      if (!replayDone({ startedAt: replay.startedAt, now: performance.now(), time: video.currentTime, until: replay.until })) return
      // The viewer picking something themselves in the meantime stands.
      if (this.state.subtitleId === id) void this.selectSubtitle(null, false)
      this.endReplay()
    }, 250)
  }
  private endReplay() {
    if (!this.replay) return
    clearInterval(this.replay.timer)
    this.replay = null
  }

  // MARK: Subtitle delay

  /** Shifts the subtitles Flow draws; positive shows them later. Remembered for the title until the page closes. */
  setSubtitleDelay(seconds: number) {
    const delay = clampDelay(seconds)
    rememberDelay(this.context.key, delay)
    this.set({ subtitleDelay: delay })
  }

  // MARK: Volume Boost

  /** Applies Settings' boost to this stream, once it can: where the stream allows it, and (the first time) from
   *  a tap or key press, which `gesture` says. A boost that can't start says so and goes back to Off. */
  async applyBoost(gesture: boolean) {
    const boost = this.boost
    const db = settingsStore.get().volumeBoostDB ?? 0
    if (!boost || !this.state.boostable || (db === 0 && !boost.active)) return
    if (!gesture && !boost.active && navigator.userActivation?.hasBeenActive === false) return
    await boost.set(db)
    if (gesture && db > 0 && !boost.active) {
      settingsStore.set({ volumeBoostDB: 0 })
      this.notify('Volume Boost couldn’t start in this browser.')
    }
  }
  setVolumeBoost(db: number) {
    settingsStore.set({ volumeBoostDB: clampBoost(db) })
    void this.applyBoost(true)
  }

  // MARK: Open in another app

  /** What "Open in" can offer for the stream on screen: the apps on this platform and the address they would get. */
  externalLink(): { platform: NonNullable<ReturnType<typeof detectPlatform>>; address: string } | undefined {
    const platform = detectPlatform(navigator.userAgent, navigator.maxTouchPoints)
    const address = this.source && streamLink(this.source, platform)
    return platform && address ? { platform, address } : undefined
  }
  /** Pauses (which saves the place) and hands the stream to another app, with the resume point where it takes one. */
  openExternally(id: ExternalPlayerId) {
    const link = this.externalLink()
    const video = this.video
    if (!link || !video) return
    const position = video.currentTime > 30 ? video.currentTime : undefined
    const url = launchURL(id, link.address, { position, filename: this.source?.filename })
    if (!url) return
    video.pause()
    this.notify(`Opening ${externalPlayerTitle(id)}. If nothing happens, it isn’t installed on this device.`)
    window.location.href = url
  }

  // MARK: Skipping

  setSegments = (segments: SkipSegment[]) => this.set({ segments })
  setUpNextShown = (upNext: boolean) => this.set({ upNext })

  /** What S and Enter do right now, by who offers it (the Skip button, the Up Next card). */
  private skipActions = new Map<string, () => void>()
  registerSkip(owner: string, action: (() => void) | null) {
    if (action) this.skipActions.set(owner, action)
    else this.skipActions.delete(owner)
  }
  /** Does the skip on offer, if there is one. */
  skipNow(): boolean {
    const action = this.skipActions.values().next().value
    if (!action) return false
    action()
    return true
  }
  toggleInfo = () => this.set({ info: !this.state.info })

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

  /** The attribute is for the stylesheet, which moves the subtitles clear of the panel; it's written to the
   *  element, like the idle cursor, so the screen doesn't re-render. */
  setStyling = (styling: PlayerState['styling']) => {
    if (this.state.styling === styling) return
    this.set({ styling })
    this.root?.toggleAttribute('data-styling', styling !== null)
  }

  setPanel = (panel: Panel) => {
    this.set({ panel })
    if (panel) this.showControls(false)
    else this.scheduleHide()
  }

  // MARK: Feedback

  /** A short sentence over the picture, as the apps' notices are: a few seconds, then gone. */
  onNotice(listener: (text: string) => void) {
    this.noticeListeners.add(listener)
    return () => void this.noticeListeners.delete(listener)
  }
  notify(text: string) {
    this.noticeListeners.forEach((l) => l(text))
  }

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
