/* The library and Trakt, kept in step while this browser is signed in. It loads on its own (lib/trakt/boot.ts
   fetches it once there is a sign-in, whether made here or brought by Marquee Sync), so a visitor who never
   signs in to Trakt never downloads it.

   Going up: it watches the library store and turns what changes (a title added to or removed from the watchlist,
   something marked watched, a resume point dismissed) into a queue of changes that is sent a couple of seconds
   later, and kept across reloads until Trakt has them. That covers every screen that edits the library
   without any of them knowing Trakt exists.

   Coming down: on sign-in, when the tab comes back and while it is open (once the Sync Interval has passed), it asks
   Trakt for the watchlist, favourites, recent history, watched episodes and resume points and folds them in (merge.ts
   holds the rules). Titles Trakt names but this browser has never seen get their artwork from TMDB afterwards.

   Trakt does only the jobs it is given (tracking/destinations.ts): it tracks when Tracking With says so, and holds the
   watchlist or favourites when Watchlist Saved To or Favourites Saved To say so. Signed in with none of those, it idles. */

import { libraryStore } from '../store/library'
import { settingsStore } from '../store/settings'
import type { MediaItem } from '../tmdb/types'
import { hydrateStubs } from '../tracking/hydrate'
import { hasRole, opsFor, rolesOf, type Roles } from '../tracking/destinations'
import { syncDue, syncIntervalOf } from '../tracking/schedule'
import { TraktError } from './client'
import { claimKey, isClaimed } from './claims'
import { applyPull, diffLibrary, enqueue, enqueueAll, mergeFavourites, mergeHistory, mergeProgress, mergeWatchedEpisodes, mergeWatchlist, snapshotOf } from './merge'
import { flushOps } from './ops'
import { clientID, currentToken, rememberProfile, trakt } from './session'
import { traktStore } from './store'

/** About two seconds after the last change, so a few quick taps are one request. */
export const flushDelay = 2000
/** While the page is open, look at Trakt this often. */
export const pullEvery = 5 * 60_000
/** Coming back to the tab doesn't ask again within this long. */
const minGap = 60_000
/** Plays asked of Trakt at a time, and kept here. */
export const historyLimit = 500
/** Watched episodes for every show can be large, so they are asked for about hourly. */
const showsEvery = 60 * 60_000

let snapshot = snapshotOf(libraryStore.get())
/** Set while this file changes the library itself, so what it brings in isn't sent back. */
let applying = false
let flushTimer: ReturnType<typeof setTimeout> | undefined
let lastShows = 0
let lastRun = 0
let running: Promise<void> | undefined
let again = false

/** What Trakt does now: nothing, unless someone is signed in and not on sample data, which is a made-up library that
 *  never goes to a real account. Trakt keeps its sign-in and sits idle while another service does every job. */
const roles = (): Roles | null => {
  const s = settingsStore.get()
  if (currentToken() === null || clientID() === '' || s.demo) return null
  const r = rolesOf('trakt', s)
  return hasRole(r) ? r : null
}
const signedIn = () => roles() !== null

// MARK: Going up

async function flush(): Promise<void> {
  if (!signedIn()) return
  const { ops, playbackIds } = traktStore.get()
  if (!ops.length) return
  const result = await flushOps(trakt(), ops, playbackIds)
  // Changes queued while this went out stay; what was sent leaves.
  const sent = new Set(ops.filter((o) => !result.remaining.includes(o)))
  traktStore.set({ ops: traktStore.get().ops.filter((o) => !sent.has(o)), playbackIds: result.ids })
  if (result.error) throw result.error
}

function scheduleFlush() {
  clearTimeout(flushTimer)
  flushTimer = setTimeout(() => void run(flushOnly), flushDelay)
}

function onLibrary() {
  if (applying) return
  const lib = libraryStore.get()
  const before = snapshot
  snapshot = snapshotOf(lib)
  const r = roles()
  if (!r) return
  const ops = opsFor(diffLibrary(before, lib, (h) => isClaimed(claimKey(h.item.type, h.item.id, h.episode?.season, h.episode?.episode))), r)
  if (!ops.length) return
  traktStore.set({ ops: enqueueAll(traktStore.get().ops, ops) })
  scheduleFlush()
}

/** The hook for star ratings, called by the library's `rate`. Sends the
 *  viewer's 1 to 10 score for a title, or removes it with null. Does nothing when signed out. */
export function rateTitle(item: Pick<MediaItem, 'type' | 'id'>, rating: number | null) {
  if (!roles()?.track) return
  const score = rating === null ? null : Math.min(10, Math.max(1, Math.round(rating)))
  traktStore.set({ ops: enqueue(traktStore.get().ops, { kind: 'rate', type: item.type, id: item.id, rating: score }) })
  scheduleFlush()
}

/** Removes a play from Trakt's history: one episode, or a film (no season and episode). Called by the library's
 *  mark-unwatched actions, since the library can't tell "unwatched" from "history cleared", which never reaches
 *  Trakt. Does nothing when signed out. */
export function unwatchTitle(item: Pick<MediaItem, 'type' | 'id'>, episode?: { season: number; episode: number }) {
  if (!roles()?.track) return
  traktStore.set({ ops: enqueue(traktStore.get().ops, { kind: 'unwatched', type: item.type, id: item.id, ...(episode ?? {}) }) })
  scheduleFlush()
}

// MARK: Coming down

async function pull(r: Roles): Promise<void> {
  const client = trakt()
  const state = traktStore.get()
  const first = state.historyThrough === null
  const withShows = r.track && (first || Date.now() - lastShows > showsEvery)

  const [list, favs, plays, shows, resumes] = await Promise.all([
    r.watchlist ? client.watchlist() : undefined,
    r.favourites ? client.favourites() : undefined,
    r.track ? client.history(historyLimit, state.historyThrough ?? undefined) : undefined,
    withShows ? client.watchedShows() : undefined,
    r.track ? client.playback() : undefined,
  ])
  if (withShows) lastShows = Date.now()

  // What is merged is read now, after the network, so a change made meanwhile is part of it.
  const lib = libraryStore.get()
  const pending = traktStore.get().ops
  const watchlist = list && mergeWatchlist({ local: lib.watchlist, remote: list, baseline: state.watchlistBaseline, pending })
  const favourites = favs && mergeFavourites({ local: lib.favourites, remote: favs, baseline: state.favouritesBaseline, pending })
  const history = plays && mergeHistory({ local: lib.history, remote: plays, firstSync: first, limit: historyLimit })
  const progress = resumes && mergeProgress({ local: lib.progress, remote: resumes, history: lib.history })
  const episodes = shows ? mergeWatchedEpisodes(lib.watchedEpisodes, shows, pending) : {}

  applying = true
  try {
    libraryStore.set(applyPull(lib, { watchlist: watchlist ?? undefined, favourites: favourites ?? undefined, history: history?.add, episodes, progress: progress?.set }, historyLimit))
  } finally {
    applying = false
  }
  snapshot = snapshotOf(libraryStore.get())

  const newest = plays?.reduce((at, w) => Math.max(at, w.at), 0) ?? 0
  traktStore.set({
    ops: enqueueAll(traktStore.get().ops, [...(watchlist?.push ?? []), ...(favourites?.push ?? []), ...(history?.push ?? [])]),
    ...(watchlist ? { watchlistBaseline: watchlist.baseline } : {}),
    ...(favourites ? { favouritesBaseline: favourites.baseline } : {}),
    ...(plays ? { historyThrough: newest ? new Date(newest).toISOString().replace(/\.\d{3}Z$/, 'Z') : (state.historyThrough ?? new Date().toISOString()) } : {}),
    playbackIds: { ...traktStore.get().playbackIds, ...progress?.ids },
  })
}

// MARK: Artwork for titles Trakt named

const hydrate = () =>
  hydrateStubs((change) => {
    applying = true
    try {
      change()
    } finally {
      applying = false
    }
  })

// MARK: When

type Job = () => Promise<void>

const flushOnly: Job = flush

async function everything(): Promise<void> {
  const r = roles()
  if (!r) return
  await flush()
  await pull(r)
  await flush()
  void hydrate()
  if (!traktStore.get().username) await rememberProfile()
  traktStore.set({ lastSyncAt: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'), error: null })
}

/** One job at a time. A request that arrives meanwhile runs once more afterwards. */
async function run(job: Job): Promise<void> {
  if (!signedIn()) return
  if (running) {
    again = true
    return running
  }
  running = (async () => {
    try {
      await job()
    } catch (error) {
      traktStore.set({ error: error instanceof TraktError ? error.message : 'Trakt sync stopped unexpectedly. Try Sync Now again.' })
    } finally {
      running = undefined
      if (again) {
        again = false
        void run(job === flushOnly ? flushOnly : everything)
      }
    }
  })()
  return running
}

/** Sync Now: send what is waiting, then bring in what Trakt has. */
export function syncTrakt(): Promise<void> {
  lastRun = Date.now()
  return run(everything)
}

let started = false

/** Whether Trakt's last sync is old enough, by the Sync Interval, for the next to start by itself. */
const due = () => syncDue(traktStore.get().lastSyncAt, syncIntervalOf(settingsStore.get()), Date.now())

/** Called once there is a sign-in to look after. */
export function startTrakt() {
  if (started || typeof document === 'undefined') return
  started = true
  libraryStore.subscribe(onLibrary)
  // A sign-in that arrives later (made here, or brought by Sync), Trakt being chosen again, or Trakt being given a
  // list to hold, starts with a full sync. A list newly given to Trakt is merged afresh: what was on it before is not
  // a record of what was removed here since.
  let was = roles() ?? undefined
  let wasToken = currentToken()?.accessToken
  settingsStore.subscribe(() => {
    // A change queued for a job Trakt has since lost (the watchlist was moved elsewhere) is dropped, not sent later: it
    // would no longer say what is true here.
    const mine = rolesOf('trakt', settingsStore.get())
    const stale = traktStore.get().ops.filter((o) => !opsFor([o], mine).length)
    if (stale.length) traktStore.set({ ops: traktStore.get().ops.filter((o) => !stale.includes(o)) })
    const now = roles() ?? undefined
    const token = currentToken()?.accessToken
    const gained = (k: keyof Roles) => !!now?.[k] && (!was?.[k] || token !== wasToken)
    if (now && (gained('track') || gained('watchlist') || gained('favourites'))) {
      traktStore.set({ ...(gained('watchlist') ? { watchlistBaseline: null } : {}), ...(gained('favourites') ? { favouritesBaseline: null } : {}) })
      void syncTrakt()
    }
    was = now
    wasToken = token
  })
  // The page may stay open for days, so it looks again whenever the Sync Interval has passed; in between it still sends
  // anything waiting.
  const maybe = () => {
    if (document.visibilityState === 'hidden' || Date.now() - lastRun < minGap) return
    if (due()) void syncTrakt()
    else void run(flushOnly)
  }
  document.addEventListener('visibilitychange', maybe)
  setInterval(maybe, pullEvery)
  if (due()) void syncTrakt()
  else void run(flushOnly)
}
