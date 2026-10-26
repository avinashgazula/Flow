import type { ServerConfig } from '../store/settings'
import { reportTo } from './serverCatalogue'
import { uuid } from './http'
import type { ReportState } from './types'

/* Telling a media server what is playing, as FlowKit's PlaybackSession does for Jellyfin, Emby and Plex: started
   when the picture first moves, progress every ten seconds, paused on pause, stopped when it ends or the player
   closes. The server keeps Continue Watching and the watched mark from it. Reports go one after another in the
   order made, and never throw: a missed update is not a reason to interrupt a film. */

export interface Reading {
  position: number
  duration?: number
}

/** How often playback is reported while it plays. */
export const progressEveryMs = 10_000

export interface ReportDeps {
  send(state: ReportState, reading: Reading, keepalive: boolean): Promise<void>
}

/** The sequence of reports for one play. Pure of the browser: the player's events are fed in, so the order and the
 *  timing are tested without a video. `now` is the clock, in milliseconds. */
export function createReporter(deps: ReportDeps) {
  let began = false
  let ended = false
  let lastAt = -Infinity
  let chain: Promise<unknown> = Promise.resolve()

  const queue = (state: ReportState, reading: Reading, keepalive: boolean) => {
    chain = chain.then(() => deps.send(state, reading, keepalive)).catch(() => undefined)
  }

  return {
    /** Playback began or resumed after a pause. */
    playing(reading: Reading, now: number) {
      if (ended) return
      lastAt = now
      queue(began ? 'progress' : 'started', reading, false)
      began = true
    },
    /** The playhead moved; reports at most every ten seconds. */
    tick(reading: Reading, now: number) {
      if (!began || ended || now - lastAt < progressEveryMs) return
      lastAt = now
      queue('progress', reading, false)
    },
    pause(reading: Reading, now: number) {
      if (!began || ended) return
      lastAt = now
      queue('paused', reading, false)
    },
    /** The film ended or the player closed. Once. */
    stop(reading: Reading, keepalive = false) {
      if (!began || ended) return
      ended = true
      queue('stopped', reading, keepalive)
    },
  }
}

/** Reports one source's play to its server for as long as `video` is the thing playing. Returns what ends it. */
export function startReporting(video: HTMLVideoElement, config: ServerConfig, sourceId: string, read: () => Reading | null): () => void {
  const sessionId = uuid().replace(/-/g, '')
  const reporter = createReporter({
    send: (state, reading, keepalive) => reportTo(config, { state, sourceId, position: reading.position, duration: reading.duration, sessionId }, keepalive),
  })
  const reading = (): Reading | null => {
    const r = read()
    if (!r) return null
    return { position: Number.isFinite(r.position) ? Math.max(0, r.position) : 0, duration: r.duration && Number.isFinite(r.duration) && r.duration > 0 ? r.duration : undefined }
  }
  const on = <T extends keyof HTMLMediaElementEventMap>(type: T, fn: () => void) => (video.addEventListener(type, fn), () => video.removeEventListener(type, fn))
  const off = [
    on('playing', () => {
      const r = reading()
      if (r) reporter.playing(r, Date.now())
    }),
    on('timeupdate', () => {
      const r = reading()
      if (r) reporter.tick(r, Date.now())
    }),
    on('pause', () => {
      // An ended video pauses too; it is reported as the stop it is.
      if (video.ended) return
      const r = reading()
      if (r) reporter.pause(r, Date.now())
    }),
    on('ended', () => {
      const r = reading()
      if (r) reporter.stop({ position: video.duration > 0 ? video.duration : r.position, duration: r.duration })
    }),
  ]
  // The picture may already be moving by the time this starts: its `playing` event has come and gone.
  if (!video.paused && !video.ended && video.readyState >= 3) {
    const r = reading()
    if (r) reporter.playing(r, Date.now())
  }
  // A closed tab never unmounts the player: this is its last chance to say so.
  const onHide = () => {
    const r = reading()
    if (r) reporter.stop(r, true)
  }
  window.addEventListener('pagehide', onHide)
  return () => {
    off.forEach((f) => f())
    window.removeEventListener('pagehide', onHide)
    const r = reading()
    if (r) reporter.stop(r, true)
  }
}
