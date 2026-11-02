/* The library and the service chosen in Settings → Account → Tracking With (Simkl or MDBList), kept in step. It is the
   same job lib/trakt/engine.ts does for Trakt and follows the same rules (lib/trakt/merge.ts and ops.ts are shared),
   for whichever one service tracks now; a service that isn't chosen is left alone, with its queue and notes kept. It
   loads on its own (lib/tracking/boot.ts fetches it once one of them tracks), so a visitor who doesn't track with
   either never downloads it.

   Going up: it watches the library store and turns what changes (a title added to or removed from the watchlist,
   something marked watched, a resume point dismissed) into a queue of changes sent a couple of seconds later and kept
   across reloads until the service has them. Coming down: when the service is chosen, when the tab comes back and
   every five minutes, it asks the service for the watchlist, resume points and, less often, watched titles and folds
   them in. The library on this device keeps working whatever the service says: a failed sync is a sentence in
   Settings, never a missing title. */

import { libraryStore } from '../store/library'
import { settingsStore } from '../store/settings'
import type { MediaItem } from '../tmdb/types'
import { claimKey, isClaimed } from '../trakt/claims'
import { TraktError } from '../trakt/client'
import { applyPull, diffLibrary, enqueue, enqueueAll, mergeHistory, mergeProgress, mergeWatchedEpisodes, mergeWatchlist, snapshotOf } from '../trakt/merge'
import { flushOps } from '../trakt/ops'
import { hydrateStubs } from './hydrate'
import { activeTracker, isOtherTracker, type OtherTracker } from './service'
import { backendFor, rememberProfile } from './session'
import { serviceState, setService } from './store'

/** About two seconds after the last change, so a few quick taps are one request. */
export const flushDelay = 2000
/** While the page is open, look at the service this often. */
export const pullEvery = 5 * 60_000
/** Coming back to the tab doesn't ask again within this long. */
const minGap = 60_000
/** Plays asked of the service at a time, and kept here. */
export const historyLimit = 500
/** The watched titles are large, so they are asked for about hourly, and on Sync Now. */
const fullEvery = 60 * 60_000

let snapshot = snapshotOf(libraryStore.get())
/** Set while this file changes the library itself, so what it brings in isn't sent back. */
let applying = false
let flushTimer: ReturnType<typeof setTimeout> | undefined
const lastFull: Partial<Record<OtherTracker, number>> = {}
let lastRun = 0
let running: Promise<void> | undefined
let again: Job | undefined

/** The service tracking now, or null when none of these does. Sample data is a made-up library and never goes to
 *  someone's real account. */
function current(): OtherTracker | null {
  const s = settingsStore.get()
  const kind = activeTracker(s)
  return !s.demo && isOtherTracker(kind) && backendFor(kind).ready() ? kind : null
}

const stamp = (ms = Date.now()) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z')

// MARK: Going up

/** Sends what is queued. Returns the first change the service refused, which is dropped (service.ts says why that
 *  is worth telling the viewer). */
async function flush(kind: OtherTracker): Promise<TraktError | undefined> {
  const { ops, playbackIds } = serviceState(kind)
  if (!ops.length) return undefined
  const result = await flushOps(backendFor(kind), ops, playbackIds)
  // Changes queued while this went out stay; what was sent leaves.
  const sent = new Set(ops.filter((o) => !result.remaining.includes(o)))
  setService(kind, (s) => ({ ops: s.ops.filter((o) => !sent.has(o)), playbackIds: result.ids }))
  if (result.error) throw result.error
  return result.dropped
}

function scheduleFlush() {
  clearTimeout(flushTimer)
  flushTimer = setTimeout(() => void run(flushOnly), flushDelay)
}

function onLibrary() {
  if (applying) return
  const lib = libraryStore.get()
  const before = snapshot
  // Kept current whoever tracks, so what changed while another service tracked isn't replayed to this one later.
  snapshot = snapshotOf(lib)
  const kind = current()
  if (!kind) return
  const ops = diffLibrary(before, lib, (h) => isClaimed(claimKey(h.item.type, h.item.id, h.episode?.season, h.episode?.episode)))
  if (!ops.length) return
  setService(kind, (s) => ({ ops: enqueueAll(s.ops, ops) }))
  scheduleFlush()
}

/** The hook for star ratings, called by the library's `rate`: the viewer's 1 to 10 score for a title, or null to remove it. */
export function rateTitle(item: Pick<MediaItem, 'type' | 'id'>, rating: number | null) {
  const kind = current()
  if (!kind) return
  const score = rating === null ? null : Math.min(10, Math.max(1, Math.round(rating)))
  setService(kind, (s) => ({ ops: enqueue(s.ops, { kind: 'rate', type: item.type, id: item.id, rating: score }) }))
  scheduleFlush()
}

/** Takes a play back out of the service's history: one episode, or a film (no season and episode). Called by the
 *  library's mark-unwatched actions, since the library can't tell "unwatched" from "history cleared", which never
 *  reaches the service. */
export function unwatchTitle(item: Pick<MediaItem, 'type' | 'id'>, episode?: { season: number; episode: number }) {
  const kind = current()
  if (!kind) return
  setService(kind, (s) => ({ ops: enqueue(s.ops, { kind: 'unwatched', type: item.type, id: item.id, ...(episode ?? {}) }) }))
  scheduleFlush()
}

// MARK: Coming down

async function pull(kind: OtherTracker, forceFull: boolean): Promise<void> {
  const state = serviceState(kind)
  const first = state.historyThrough === null
  const full = forceFull || first || Date.now() - (lastFull[kind] ?? 0) > fullEvery
  const pulled = await backendFor(kind).pull({ full, limit: historyLimit, startAt: state.historyThrough ?? undefined })
  if (full) lastFull[kind] = Date.now()

  // What is merged is read now, after the network, so a change made meanwhile is part of it.
  const lib = libraryStore.get()
  const pending = serviceState(kind).ops
  const watchlist = mergeWatchlist({ local: lib.watchlist, remote: pulled.watchlist, baseline: state.watchlistBaseline, pending })
  const history = mergeHistory({ local: lib.history, remote: pulled.history, firstSync: first, limit: historyLimit })
  const progress = mergeProgress({ local: lib.progress, remote: pulled.resumes, history: lib.history })
  const episodes = pulled.shows ? mergeWatchedEpisodes(lib.watchedEpisodes, pulled.shows, pending) : {}

  applying = true
  try {
    libraryStore.set(applyPull(lib, { watchlist, history: history.add, episodes, progress: progress.set }, historyLimit))
  } finally {
    applying = false
  }
  snapshot = snapshotOf(libraryStore.get())

  const newest = pulled.history.reduce((at, w) => Math.max(at, w.at), 0)
  setService(kind, (s) => ({
    ops: enqueueAll(s.ops, [...watchlist.push, ...history.push]),
    watchlistBaseline: watchlist.baseline,
    historyThrough: newest ? stamp(newest) : (s.historyThrough ?? stamp()),
    playbackIds: { ...s.playbackIds, ...progress.ids },
  }))
}

// MARK: When

type Job = (kind: OtherTracker) => Promise<void>

const flushOnly: Job = async (kind) => {
  const refused = await flush(kind)
  if (refused) setService(kind, { error: refused.message })
}

const everything =
  (forceFull: boolean): Job =>
  async (kind) => {
    const first = await flush(kind)
    await pull(kind, forceFull)
    const second = await flush(kind)
    void hydrateStubs((change) => {
      applying = true
      try {
        change()
      } finally {
        applying = false
      }
    })
    if (!serviceState(kind).username) await rememberProfile(kind)
    // A refused update is the one thing worth keeping on screen after a sync that otherwise went well.
    setService(kind, { lastSyncAt: stamp(), error: (second ?? first)?.message ?? null, signInAgain: false })
  }

/** One job at a time. A request that arrives meanwhile runs once more afterwards. */
async function run(job: Job): Promise<void> {
  const kind = current()
  if (!kind) return
  if (running) {
    again = job
    return running
  }
  running = (async () => {
    try {
      await job(kind)
    } catch (error) {
      setService(kind, {
        error: error instanceof TraktError ? error.message : `${backendFor(kind).name} sync stopped unexpectedly. Try Sync Now again.`,
        ...(error instanceof TraktError && error.kind === 'signed-out' ? { signInAgain: true } : {}),
      })
    } finally {
      running = undefined
      const next = again
      again = undefined
      if (next) void run(next)
    }
  })()
  return running
}

/** Sync Now: send what is waiting, then bring in everything the service has. */
export function syncTracker(): Promise<void> {
  lastRun = Date.now()
  return run(everything(true))
}

let started = false

/** Called once one of these services tracks. */
export function startTracking() {
  if (started || typeof document === 'undefined') return
  started = true
  libraryStore.subscribe(onLibrary)
  // Choosing a service (or signing in to it) starts with a full sync.
  let was = current()
  settingsStore.subscribe(() => {
    const now = current()
    if (now !== null && now !== was) void syncTracker()
    was = now
  })
  const maybe = () => {
    if (document.visibilityState === 'hidden' || Date.now() - lastRun < minGap) return
    lastRun = Date.now()
    void run(everything(false))
  }
  document.addEventListener('visibilitychange', maybe)
  setInterval(maybe, pullEvery)
  if (was) void syncTracker()
}
