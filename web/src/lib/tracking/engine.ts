/* The library and the services chosen in Settings → Account (Simkl or MDBList), kept in step. It is the same job
   lib/trakt/engine.ts does for Trakt and follows the same rules (lib/trakt/merge.ts and ops.ts are shared). A service
   does the jobs it is given (destinations.ts): tracking when Tracking With names it, the watchlist when Watchlist Saved To
   does. They can be two different services, so this keeps up to two in step at once; one that has no job is left alone,
   with its queue and notes kept. It loads on its own (lib/tracking/boot.ts fetches it once one of them has a job), so a
   visitor who uses neither never downloads it.

   Going up: it watches the library store and turns what changes (a title added to or removed from the watchlist,
   something marked watched, a resume point dismissed) into a queue of changes sent a couple of seconds later and kept
   across reloads until the service has them. Coming down: when the service is chosen, when the tab comes back and
   while it is open (once the Sync Interval has passed), it asks the service for the watchlist, resume points and, less
   often, watched titles and folds them in. The library on this device keeps working whatever the service says: a failed sync is a sentence in
   Settings, never a missing title. */

import { libraryStore } from '../store/library'
import { settingsStore } from '../store/settings'
import type { MediaItem } from '../tmdb/types'
import { claimKey, isClaimed } from '../trakt/claims'
import { TraktError } from '../trakt/client'
import { applyPull, diffLibrary, enqueue, enqueueAll, mergeHistory, mergeProgress, mergeWatchedEpisodes, mergeWatchlist, snapshotOf } from '../trakt/merge'
import { flushOps } from '../trakt/ops'
import { hydrateStubs } from './hydrate'
import { hasRole, opsFor, rolesOf, sameRoles, type Roles } from './destinations'
import { oldestSync, syncDue, syncIntervalOf } from './schedule'
import { isOtherTracker, type OtherTracker } from './service'
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

const services: OtherTracker[] = ['simkl', 'mdblist']

/** The services with a job now, and what each does. Sample data is a made-up library and never goes to someone's real
 *  account. */
function active(): { kind: OtherTracker; roles: Roles }[] {
  const s = settingsStore.get()
  if (s.demo) return []
  return services.flatMap((kind) => {
    const roles = rolesOf(kind, s)
    return isOtherTracker(kind) && hasRole(roles) && backendFor(kind).ready() ? [{ kind, roles }] : []
  })
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
  const jobs = active()
  if (!jobs.length) return
  const ops = diffLibrary(before, lib, (h) => isClaimed(claimKey(h.item.type, h.item.id, h.episode?.season, h.episode?.episode)))
  let queued = false
  for (const { kind, roles } of jobs) {
    const mine = opsFor(ops, roles)
    if (!mine.length) continue
    setService(kind, (s) => ({ ops: enqueueAll(s.ops, mine) }))
    queued = true
  }
  if (queued) scheduleFlush()
}

/** The hook for star ratings, called by the library's `rate`: the viewer's 1 to 10 score for a title, or null to remove it. */
export function rateTitle(item: Pick<MediaItem, 'type' | 'id'>, rating: number | null) {
  const kind = active().find((j) => j.roles.track)?.kind
  if (!kind) return
  const score = rating === null ? null : Math.min(10, Math.max(1, Math.round(rating)))
  setService(kind, (s) => ({ ops: enqueue(s.ops, { kind: 'rate', type: item.type, id: item.id, rating: score }) }))
  scheduleFlush()
}

/** Takes a play back out of the service's history: one episode, or a film (no season and episode). Called by the
 *  library's mark-unwatched actions, since the library can't tell "unwatched" from "history cleared", which never
 *  reaches the service. */
export function unwatchTitle(item: Pick<MediaItem, 'type' | 'id'>, episode?: { season: number; episode: number }) {
  const kind = active().find((j) => j.roles.track)?.kind
  if (!kind) return
  setService(kind, (s) => ({ ops: enqueue(s.ops, { kind: 'unwatched', type: item.type, id: item.id, ...(episode ?? {}) }) }))
  scheduleFlush()
}

// MARK: Coming down

async function pull(kind: OtherTracker, roles: Roles, forceFull: boolean): Promise<void> {
  const state = serviceState(kind)
  const first = state.historyThrough === null
  const full = roles.track && (forceFull || first || Date.now() - (lastFull[kind] ?? 0) > fullEvery)
  const pulled = await backendFor(kind).pull({ full, limit: historyLimit, startAt: state.historyThrough ?? undefined, track: roles.track, watchlist: roles.watchlist })
  if (full) lastFull[kind] = Date.now()

  // What is merged is read now, after the network, so a change made meanwhile is part of it. Only the jobs this
  // service has are merged: a service that holds just the watchlist never touches history or resume points.
  const lib = libraryStore.get()
  const pending = serviceState(kind).ops
  const watchlist = roles.watchlist ? mergeWatchlist({ local: lib.watchlist, remote: pulled.watchlist, baseline: state.watchlistBaseline, pending }) : undefined
  const history = roles.track ? mergeHistory({ local: lib.history, remote: pulled.history, firstSync: first, limit: historyLimit }) : undefined
  const progress = roles.track ? mergeProgress({ local: lib.progress, remote: pulled.resumes, history: lib.history }) : undefined
  const episodes = roles.track && pulled.shows ? mergeWatchedEpisodes(lib.watchedEpisodes, pulled.shows, pending) : {}

  applying = true
  try {
    libraryStore.set(applyPull(lib, { watchlist, history: history?.add, episodes, progress: progress?.set }, historyLimit))
  } finally {
    applying = false
  }
  snapshot = snapshotOf(libraryStore.get())

  const newest = roles.track ? pulled.history.reduce((at, w) => Math.max(at, w.at), 0) : 0
  setService(kind, (s) => ({
    ops: enqueueAll(s.ops, [...(watchlist?.push ?? []), ...(history?.push ?? [])]),
    ...(watchlist ? { watchlistBaseline: watchlist.baseline } : {}),
    ...(roles.track ? { historyThrough: newest ? stamp(newest) : (s.historyThrough ?? stamp()) } : {}),
    playbackIds: { ...s.playbackIds, ...progress?.ids },
  }))
}

// MARK: When

type Job = (kind: OtherTracker, roles: Roles) => Promise<void>

const flushOnly: Job = async (kind) => {
  const refused = await flush(kind)
  if (refused) setService(kind, { error: refused.message })
}

const everything =
  (forceFull: boolean): Job =>
  async (kind, roles) => {
    const first = await flush(kind)
    await pull(kind, roles, forceFull)
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

/** One job at a time, for each service with something to do in turn: one that fails doesn't stop the other. A request
 *  that arrives meanwhile runs once more afterwards. */
async function run(job: Job): Promise<void> {
  if (!active().length) return
  if (running) {
    again = job
    return running
  }
  running = (async () => {
    try {
      for (const { kind, roles } of active()) {
        try {
          await job(kind, roles)
        } catch (error) {
          setService(kind, {
            error: error instanceof TraktError ? error.message : `${backendFor(kind).name} sync stopped unexpectedly. Try Sync Now again.`,
            ...(error instanceof TraktError && error.kind === 'signed-out' ? { signInAgain: true } : {}),
          })
        }
      }
    } finally {
      running = undefined
      const next = again
      again = undefined
      if (next) void run(next)
    }
  })()
  return running
}

/** Sync Now: send what is waiting, then bring in everything the services have. */
export function syncTracker(): Promise<void> {
  lastRun = Date.now()
  return run(everything(true))
}

let started = false

/** Whether the services' last syncs are old enough, by the Sync Interval, for the next to start by itself. The oldest
 *  one decides, so a service that fell behind is caught up with the other. */
const due = () => syncDue(oldestSync(active().map((j) => serviceState(j.kind).lastSyncAt)), syncIntervalOf(settingsStore.get()), Date.now())

/** Called once one of these services has a job. */
export function startTracking() {
  if (started || typeof document === 'undefined') return
  started = true
  libraryStore.subscribe(onLibrary)
  // Choosing a service (or signing in to it), or giving it a list to hold, starts with a full sync. A list newly given
  // to a service is merged afresh: what was on it before is not a record of what was removed here since.
  let was = new Map(active().map((j) => [j.kind, j.roles]))
  settingsStore.subscribe(() => {
    // A change queued for a job a service has since lost (the watchlist was moved elsewhere) is dropped, not sent
    // later: it would no longer say what is true here.
    for (const kind of services) {
      const roles = rolesOf(kind, settingsStore.get())
      const stale = serviceState(kind).ops.filter((o) => !opsFor([o], roles).length)
      if (stale.length) setService(kind, (s) => ({ ops: s.ops.filter((o) => !stale.includes(o)) }))
    }
    const now = active()
    let gained = false
    for (const { kind, roles } of now) {
      const before = was.get(kind)
      if (roles.watchlist && !before?.watchlist) setService(kind, { watchlistBaseline: null })
      if (!sameRoles(before, roles) && ((roles.track && !before?.track) || (roles.watchlist && !before?.watchlist))) gained = true
    }
    was = new Map(now.map((j) => [j.kind, j.roles]))
    if (gained) void syncTracker()
  })
  const maybe = () => {
    if (document.visibilityState === 'hidden' || Date.now() - lastRun < minGap) return
    lastRun = Date.now()
    void run(due() ? everything(false) : flushOnly)
  }
  document.addEventListener('visibilitychange', maybe)
  setInterval(maybe, pullEvery)
  if (active().length) void (due() ? syncTracker() : run(flushOnly))
}
