/* Scrobbling: telling Trakt what is playing, as FlowKit's player does. Start when playback begins or resumes,
   pause when it pauses or the page is hidden, stop when it ends or the player closes, each with how far in
   (a percentage). Trakt does the rest: a stop at 80 % or more is a watch, anything less is a resume point.

   Flow follows Trakt's line: a stop past 80 % also marks the title watched in this browser's library, so the two
   agree without waiting for the next sync. The library's own mark at 92 % still happens as the film plays. A
   play claimed here is left out of the queue of changes (claims.ts), or Trakt would count it twice; if the stop
   can't be sent, the claim is dropped first so the library's mark travels as an ordinary change instead. */

import { library, type EpisodeRef } from '../store/library'
import type { MediaItem } from '../tmdb/types'
import type { Scrobble, Target } from './client'
import { claim, claimKey, release } from './claims'
import { trakt } from './session'

/** Where Trakt counts a play as watched. */
export const watchedAt = 80

export interface Reading {
  item: MediaItem
  episode?: EpisodeRef
  position: number
  duration: number
}

const targetOf = (r: Reading): Target => ({ type: r.item.type, id: r.item.id, ...(r.episode ? { season: r.episode.season, episode: r.episode.episode } : {}) })
const keyOf = (t: Target) => claimKey(t.type, t.id, t.season, t.episode)
const percentOf = (r: Reading) => (Number.isFinite(r.duration) && r.duration > 0 ? Math.round(Math.min(100, Math.max(0, (r.position / r.duration) * 100)) * 100) / 100 : 0)

export interface ScrobbleDeps {
  send(action: Scrobble, target: Target, percent: number, keepalive: boolean): Promise<void>
  /** The library's own mark, made when Trakt will count the play. */
  markWatched(item: MediaItem, episode?: EpisodeRef): void
}

/** The sequence of calls for one player. Sends one after another, in the order made, and never throws: a
 *  scrobble that fails is a missed update, not a reason to interrupt a film. */
export function createScrobbler(deps: ScrobbleDeps) {
  let current: { reading: Reading; target: Target; key: string } | undefined
  let playing = false
  let lastPercent = 0
  let chain: Promise<unknown> = Promise.resolve()

  const queue = <T>(job: () => Promise<T>): Promise<T | undefined> => {
    const next = chain.then(job, job).catch(() => undefined) as Promise<T | undefined>
    chain = next
    return next
  }

  async function finish(reading: Reading, percent: number) {
    const target = current!.target
    const key = current!.key
    current = undefined
    playing = false
    const counted = percent >= watchedAt
    let sent = true
    await queue(async () => {
      try {
        await deps.send('stop', target, percent, false)
      } catch {
        sent = false
      }
    })
    // Sent and counted: Trakt has the play, and the library's mark must not travel too. Not sent: let it travel.
    if (counted && !sent) release(key, false)
    if (counted) deps.markWatched(reading.item, reading.episode)
    release(key, counted && sent)
  }

  return {
    /** Playback began or resumed. */
    async play(reading: Reading): Promise<void> {
      const target = targetOf(reading)
      const key = keyOf(target)
      // The player moved on to another episode without closing: that one is over.
      if (current && current.key !== key) await finish(current.reading, lastPercent)
      if (playing) return
      if (!current) {
        current = { reading, target, key }
        claim(key)
      }
      current.reading = reading
      playing = true
      lastPercent = percentOf(reading)
      const percent = lastPercent
      await queue(() => deps.send('start', target, percent, false))
    },

    /** Playback paused, or the page was hidden (which may be the last chance to say so). */
    async pause(reading: Reading, keepalive = false): Promise<void> {
      if (!current || !playing) return
      playing = false
      current.reading = reading
      lastPercent = percentOf(reading)
      const { target } = current
      const percent = lastPercent
      await queue(() => deps.send('pause', target, percent, keepalive))
    },

    /** Playback ended (`ended`: the end of the file counts as 100) or the player closed. */
    async stop(reading: Reading, ended = false): Promise<void> {
      if (!current) return
      lastPercent = ended ? 100 : percentOf(reading)
      current.reading = reading
      await finish(reading, lastPercent)
    },

    get active() {
      return current !== undefined
    },
  }
}

/** Follows a video element: its play, pause and end, the page going away, and the player closing (the returned
 *  function). `read` says what is playing and how far in; null before there is anything to report. */
export function startScrobbling(video: HTMLVideoElement, read: () => Reading | null): () => void {
  const scrobbler = createScrobbler({
    send: (action, target, percent, keepalive) => trakt().scrobble(action, target, percent, keepalive),
    markWatched: (item, episode) => library.markWatched(item, episode),
  })
  const onPlay = () => {
    const r = read()
    if (r) void scrobbler.play(r)
  }
  const onPause = () => {
    // The end of a file pauses on its way out; the end event that follows is the stop.
    if (video.ended) return
    const r = read()
    if (r) void scrobbler.pause(r)
  }
  const onEnded = () => {
    const r = read()
    if (r) void scrobbler.stop(r, true)
  }
  const onHide = () => {
    const r = read()
    if (!r) return
    // Hidden may be the last chance to say it paused; coming back to a tab that kept playing starts it again.
    if (document.visibilityState === 'hidden') void scrobbler.pause(r, true)
    else if (!video.paused && !video.ended) void scrobbler.play(r)
  }
  const onPageHide = () => {
    const r = read()
    if (r) void scrobbler.pause(r, true)
  }
  video.addEventListener('play', onPlay)
  video.addEventListener('playing', onPlay)
  video.addEventListener('pause', onPause)
  video.addEventListener('ended', onEnded)
  document.addEventListener('visibilitychange', onHide)
  window.addEventListener('pagehide', onPageHide)
  if (!video.paused && !video.ended) onPlay()
  return () => {
    video.removeEventListener('play', onPlay)
    video.removeEventListener('playing', onPlay)
    video.removeEventListener('pause', onPause)
    video.removeEventListener('ended', onEnded)
    document.removeEventListener('visibilitychange', onHide)
    window.removeEventListener('pagehide', onPageHide)
    const r = read()
    if (r) void scrobbler.stop(r)
  }
}
