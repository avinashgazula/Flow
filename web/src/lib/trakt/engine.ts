/* The library and Trakt, kept in step while this browser is signed in. It loads on its own (lib/trakt/boot.ts
   fetches it once there is a sign-in, whether made here or brought by Flow Sync), so a visitor who never
   signs in to Trakt never downloads it.

   Going up: it watches the library store and turns what changes (a title added to or removed from the watchlist,
   something marked watched, a resume point dismissed) into a queue of changes that is sent a couple of seconds
   later, and kept across reloads until Trakt has them. That covers every screen that edits the library
   without any of them knowing Trakt exists.

   Coming down: on sign-in, when the tab comes back and every five minutes, it asks Trakt for the watchlist,
   recent history, watched episodes and resume points and folds them in (merge.ts holds the rules). Titles
   Trakt names but this browser has never seen get their artwork from TMDB afterwards. */

import { libraryStore, type Library } from '../store/library'
import { settingsStore } from '../store/settings'
import { tmdbPath, type MediaItem } from '../tmdb/types'
import { TraktError } from './client'
import { claimKey, isClaimed } from './claims'
import { applyPull, diffLibrary, enqueue, enqueueAll, isStub, mergeHistory, mergeProgress, mergeWatchedEpisodes, mergeWatchlist, snapshotOf } from './merge'
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

/** Sample data is a made-up library; it never goes to someone's real Trakt account. */
const signedIn = () => currentToken() !== null && clientID() !== '' && !settingsStore.get().demo

// MARK: Going up

async function flush(): Promise<void> {
  const { ops, playbackIds } = traktStore.get()
  if (!ops.length || !signedIn()) return
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
  if (!signedIn()) return
  const ops = diffLibrary(before, lib, (h) => isClaimed(claimKey(h.item.type, h.item.id, h.episode?.season, h.episode?.episode)))
  if (!ops.length) return
  traktStore.set({ ops: enqueueAll(traktStore.get().ops, ops) })
  scheduleFlush()
}

/** The hook for star ratings, called by the library's `rate`. Sends the
 *  viewer's 1 to 10 score for a title, or removes it with null. Does nothing when signed out. */
export function rateTitle(item: Pick<MediaItem, 'type' | 'id'>, rating: number | null) {
  if (!signedIn()) return
  const score = rating === null ? null : Math.min(10, Math.max(1, Math.round(rating)))
  traktStore.set({ ops: enqueue(traktStore.get().ops, { kind: 'rate', type: item.type, id: item.id, rating: score }) })
  scheduleFlush()
}

/** Removes a play from Trakt's history: one episode, or a film (no season and episode). Called by the library's
 *  mark-unwatched actions, since the library can't tell "unwatched" from "history cleared", which never reaches
 *  Trakt. Does nothing when signed out. */
export function unwatchTitle(item: Pick<MediaItem, 'type' | 'id'>, episode?: { season: number; episode: number }) {
  if (!signedIn()) return
  traktStore.set({ ops: enqueue(traktStore.get().ops, { kind: 'unwatched', type: item.type, id: item.id, ...(episode ?? {}) }) })
  scheduleFlush()
}

// MARK: Coming down

async function pull(): Promise<void> {
  const client = trakt()
  const state = traktStore.get()
  const first = state.historyThrough === null
  const withShows = first || Date.now() - lastShows > showsEvery

  const [list, plays, shows, resumes] = await Promise.all([
    client.watchlist(),
    client.history(historyLimit, state.historyThrough ?? undefined),
    withShows ? client.watchedShows() : Promise.resolve(undefined),
    client.playback(),
  ])
  if (withShows) lastShows = Date.now()

  // What is merged is read now, after the network, so a change made meanwhile is part of it.
  const lib = libraryStore.get()
  const watchlist = mergeWatchlist({ local: lib.watchlist, remote: list, baseline: state.watchlistBaseline, pending: traktStore.get().ops })
  const history = mergeHistory({ local: lib.history, remote: plays, firstSync: first, limit: historyLimit })
  const progress = mergeProgress({ local: lib.progress, remote: resumes, history: lib.history })
  const episodes = shows ? mergeWatchedEpisodes(lib.watchedEpisodes, shows, traktStore.get().ops) : {}

  applying = true
  try {
    libraryStore.set(applyPull(lib, { watchlist, history: history.add, episodes, progress: progress.set }, historyLimit))
  } finally {
    applying = false
  }
  snapshot = snapshotOf(libraryStore.get())

  const newest = plays.reduce((at, w) => Math.max(at, w.at), 0)
  traktStore.set({
    ops: enqueueAll(traktStore.get().ops, [...watchlist.push, ...history.push]),
    watchlistBaseline: watchlist.baseline,
    historyThrough: newest ? new Date(newest).toISOString().replace(/\.\d{3}Z$/, 'Z') : (state.historyThrough ?? new Date().toISOString()),
    playbackIds: { ...traktStore.get().playbackIds, ...progress.ids },
  })
}

// MARK: Artwork for titles Trakt named

const truncate = (text: string) => (text.length > 240 ? `${text.slice(0, 237)}…` : text)

/** Gives stand-in entries their poster and overview. A catalogue that can't be reached is not an error here. */
async function hydrate(): Promise<void> {
  const lib = libraryStore.get()
  const wanted = new Map<string, MediaItem>()
  for (const entry of [...lib.watchlist, ...lib.history.slice(0, 60), ...Object.values(lib.progress)]) if (isStub(entry.item)) wanted.set(`${entry.item.type}:${entry.item.id}`, entry.item)
  const queue = [...wanted.values()].slice(0, 40)
  const fresh = new Map<string, MediaItem>()
  // TMDB's client is fetched only when there is artwork to look for.
  const { item: tmdbItem, tmdb } = await import('../tmdb/client')
  const worker = async () => {
    for (let stub = queue.shift(); stub; stub = queue.shift()) {
      try {
        const found = tmdbItem(await tmdb(`/${tmdbPath(stub.type)}/${stub.id}`), stub.type)
        if (found) fresh.set(`${stub.type}:${stub.id}`, { ...found, overview: truncate(found.overview) || stub.overview })
      } catch {
        // No key, offline or an id TMDB doesn't know: the stand-in stays.
        return
      }
    }
  }
  await Promise.all([worker(), worker(), worker()])
  if (!fresh.size) return
  const swap = <T extends { item: MediaItem }>(e: T): T => (isStub(e.item) && fresh.has(`${e.item.type}:${e.item.id}`) ? { ...e, item: fresh.get(`${e.item.type}:${e.item.id}`)! } : e)
  applying = true
  try {
    libraryStore.set((l: Library) => ({
      watchlist: l.watchlist.map(swap),
      history: l.history.map(swap),
      progress: Object.fromEntries(Object.entries(l.progress).map(([k, p]) => [k, swap(p)])),
    }))
  } finally {
    applying = false
  }
}

// MARK: When

type Job = () => Promise<void>

const flushOnly: Job = flush

async function everything(): Promise<void> {
  await flush()
  await pull()
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

/** Called once there is a sign-in to look after. */
export function startTrakt() {
  if (started || typeof document === 'undefined') return
  started = true
  libraryStore.subscribe(onLibrary)
  // A sign-in that arrives later (made here, or brought by Sync) starts with a full sync.
  let was = currentToken()?.accessToken
  settingsStore.subscribe(() => {
    const now = currentToken()?.accessToken
    if (was === undefined && now !== undefined) void syncTrakt()
    was = now
  })
  const maybe = () => {
    if (document.visibilityState === 'hidden' || Date.now() - lastRun < minGap) return
    void syncTrakt()
  }
  document.addEventListener('visibilitychange', maybe)
  setInterval(maybe, pullEvery)
  void syncTrakt()
}
