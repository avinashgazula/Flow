/* How this browser's library and Trakt's are brought together, as pure functions over plain data so the rules
   are tested without a browser or a server. The library keeps working signed out exactly as before; signed in,
   Trakt adds what it has that this browser lacks, and what changes here is sent to Trakt.

   - Watchlist: two-way, and the only list where a removal has to travel. A title missing on one side is either new
     on the other or removed here, and the lists as they stood at the last sync (the baseline) tell which.
   - History and watched episodes: additions only. Clearing history here never un-watches anything on Trakt.
   - Resume points: Trakt's win when they are newer than this browser's, unless the title was finished since. */

import { episodeKey, mediaKey, type HistoryEntry, type Library, type ListEntry, type Progress } from '../store/library'
import type { MediaItem, MediaType } from '../tmdb/types'
import type { Listed, Resume, ShowWatched, Watch } from './client'
import type { Op } from './store'

// MARK: Stand-in items

/** What is known of a title from Trakt alone. Artwork and the overview are filled in from TMDB afterwards. */
export function stubItem(type: MediaType, id: number, title: string, year?: number): MediaItem {
  return { type, id, title, ...(year ? { year } : {}), overview: '', genres: [] }
}

/** A stub that still needs its poster. */
export const isStub = (item: MediaItem) => !item.poster && !item.backdrop && item.overview === ''

// MARK: The queue of changes Trakt hasn't heard

const watchKey = (o: { type: MediaType; id: number; season?: number; episode?: number }) => `${o.type}:${o.id}:${o.season ?? ''}:${o.episode ?? ''}`

/** Adds a change to the queue. A later change to the same thing replaces an earlier one (add then remove from
 *  the watchlist is no change at all by the time it is sent); two plays of the same episode at the same
 *  moment are one. */
export function enqueue(ops: Op[], op: Op): Op[] {
  const same = (o: Op) => {
    if (o.kind !== op.kind) return false
    if (op.kind === 'watched') return o.kind === 'watched' && watchKey(o) === watchKey(op) && o.at === op.at
    if (op.kind === 'unwatched') return o.kind === 'unwatched' && watchKey(o) === watchKey(op)
    return o.type === op.type && o.id === op.id
  }
  // A play and its removal cancel each other while both wait; the last word on an episode or film is the one sent.
  const opposite = (o: Op) => ((op.kind === 'watched' && o.kind === 'unwatched') || (op.kind === 'unwatched' && o.kind === 'watched')) && watchKey(o) === watchKey(op)
  return [...ops.filter((o) => !same(o) && !opposite(o)), op]
}

export const enqueueAll = (ops: Op[], more: Op[]) => more.reduce(enqueue, ops)

// MARK: What changed here

export interface Snapshot {
  watchlist: Set<string>
  history: Set<string>
  progress: Set<string>
}

const historyId = (h: HistoryEntry) => `${h.key}|${h.episode ? `${h.episode.season}x${h.episode.episode}` : ''}|${h.watchedAt}`

export function snapshotOf(library: Library): Snapshot {
  return { watchlist: new Set(library.watchlist.map((e) => e.key)), history: new Set(library.history.map(historyId)), progress: new Set(Object.keys(library.progress)) }
}

const iso = (ms: number) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z')

/** The changes between two states of the library as changes for Trakt. `claimed` names plays Trakt already
 *  heard about from the player's scrobbles, which would otherwise be counted twice. */
export function diffLibrary(prev: Snapshot, library: Library, claimed: (entry: HistoryEntry) => boolean = () => false): Op[] {
  const ops: Op[] = []
  const now = snapshotOf(library)

  const byKey = new Map(library.watchlist.map((e) => [e.key, e]))
  for (const key of now.watchlist) if (!prev.watchlist.has(key)) ops.push({ kind: 'watchlist', type: byKey.get(key)!.item.type, id: byKey.get(key)!.item.id, on: true })
  for (const key of prev.watchlist) if (!now.watchlist.has(key)) ops.push({ kind: 'watchlist', ...typeAndId(key), on: false })

  const finished = new Set<string>()
  for (const h of library.history) {
    if (prev.history.has(historyId(h))) continue
    finished.add(h.key)
    if (claimed(h)) continue
    ops.push({ kind: 'watched', type: h.item.type, id: h.item.id, ...(h.episode ? { season: h.episode.season, episode: h.episode.episode } : {}), at: iso(h.watchedAt) })
  }

  // Finishing a title moves it out of Continue Watching; that is not the viewer dismissing it.
  for (const key of prev.progress) if (!now.progress.has(key) && !finished.has(key)) ops.push({ kind: 'unplayback', ...typeAndId(key) })
  return ops
}

function typeAndId(key: string): { type: MediaType; id: number } {
  const [type, id] = key.split(':')
  return { type: type === 'movie' ? 'movie' : 'show', id: Number(id) }
}

// MARK: Watchlist

export interface WatchlistMerge {
  /** Titles on Trakt's list that this browser should now have. */
  add: Listed[]
  /** Keys removed on Trakt since the last sync, to drop here. */
  remove: string[]
  /** Changes to send: titles here that Trakt lacks. */
  push: Op[]
  /** The list as it stands after this sync. */
  baseline: string[]
}

export function mergeWatchlist(args: { local: ListEntry[]; remote: Listed[]; baseline: string[] | null; pending: Op[] }): WatchlistMerge {
  const local = new Set(args.local.map((e) => e.key))
  const remote = new Map(args.remote.map((r) => [mediaKey(r.type, r.tmdb), r]))
  const before = new Set(args.baseline ?? [])
  // What is still on its way, by key: the last word on it.
  const waiting = new Map<string, boolean>()
  for (const op of args.pending) if (op.kind === 'watchlist') waiting.set(mediaKey(op.type, op.id), op.on)

  const add: Listed[] = []
  for (const [key, r] of remote) {
    // In the baseline but not here means it was removed here and Trakt hasn't heard yet.
    if (!local.has(key) && !before.has(key) && waiting.get(key) !== false) add.push(r)
  }
  const remove: string[] = []
  for (const key of local) if (before.has(key) && !remote.has(key) && waiting.get(key) !== true) remove.push(key)
  const push: Op[] = []
  for (const e of args.local) if (!remote.has(e.key) && !before.has(e.key) && waiting.get(e.key) !== true) push.push({ kind: 'watchlist', type: e.item.type, id: e.item.id, on: true })

  const after = new Set(remote.keys())
  for (const [key, on] of waiting) on ? after.add(key) : after.delete(key)
  for (const op of push) if (op.kind === 'watchlist') after.add(mediaKey(op.type, op.id))
  return { add, remove, push, baseline: [...after] }
}

// MARK: History

/** The same play recorded twice, a minute apart by the two clocks, is one. */
const sameMoment = 5 * 60_000

const sameWatch = (h: HistoryEntry, w: { type: MediaType; tmdb: number; season?: number; episode?: number; at: number }) =>
  h.key === mediaKey(w.type, w.tmdb) && (h.episode?.season ?? -1) === (w.season ?? -1) && (h.episode?.episode ?? -1) === (w.episode ?? -1) && Math.abs(h.watchedAt - w.at) < sameMoment

export interface HistoryMerge {
  add: Watch[]
  /** Plays here that Trakt doesn't have, found when signing in for the first time. Later plays travel as they happen. */
  push: Op[]
}

export function mergeHistory(args: { local: HistoryEntry[]; remote: Watch[]; firstSync: boolean; limit: number }): HistoryMerge {
  const add = args.remote.filter((w) => !args.local.some((h) => sameWatch(h, w)))
  const push: Op[] = []
  if (args.firstSync) {
    // Trakt sent its newest `limit` plays; anything here older than the oldest of them may well be there too.
    const oldest = args.remote.length >= args.limit ? Math.min(...args.remote.map((w) => w.at)) : -Infinity
    for (const h of args.local) {
      if (h.watchedAt < oldest || args.remote.some((w) => sameWatch(h, w))) continue
      push.push({ kind: 'watched', type: h.item.type, id: h.item.id, ...(h.episode ? { season: h.episode.season, episode: h.episode.episode } : {}), at: iso(h.watchedAt) })
    }
  }
  return { add, push }
}

/** Episodes Trakt says were watched that this browser doesn't know, with the time Trakt has. `pending` is the queue:
 *  an episode marked unwatched here whose removal Trakt hasn't heard yet is not brought back by its old play. */
export function mergeWatchedEpisodes(local: Record<string, number>, remote: ShowWatched[], pending: Op[] = []): Record<string, number> {
  const add: Record<string, number> = {}
  const removing = new Set(pending.flatMap((o) => (o.kind === 'unwatched' && o.type === 'show' && o.season !== undefined && o.episode !== undefined ? [episodeKey(o.id, { season: o.season, episode: o.episode })] : [])))
  for (const show of remote) {
    for (const e of show.episodes) {
      const key = episodeKey(show.tmdb, e)
      if (!(key in local) && !removing.has(key)) add[key] = e.at
    }
  }
  return add
}

// MARK: Resume points

const fallbackRuntime = { movie: 7200, show: 2700 }
/** Past this a title counts as finished, as the library's own player does; a resume point beyond it is stale. */
const finishedPercent = 92

export function mergeProgress(args: { local: Record<string, Progress>; remote: Resume[]; history: HistoryEntry[] }): { set: Progress[]; ids: Record<string, number> } {
  const newest = new Map<string, Resume>()
  for (const r of args.remote) {
    const key = mediaKey(r.type, r.tmdb)
    if (!newest.has(key) || newest.get(key)!.at < r.at) newest.set(key, r)
  }
  const set: Progress[] = []
  const ids: Record<string, number> = {}
  for (const [key, r] of newest) {
    ids[key] = r.id
    if (r.percent < 1 || r.percent >= finishedPercent) continue
    if ((args.local[key]?.updatedAt ?? 0) >= r.at) continue
    // Finished here since Trakt last heard: its resume point is stale.
    if (args.history.some((h) => h.key === key && (h.episode?.season ?? -1) === (r.season ?? -1) && (h.episode?.episode ?? -1) === (r.episode ?? -1) && h.watchedAt >= r.at)) continue
    const duration = (r.runtimeMinutes ? r.runtimeMinutes * 60 : fallbackRuntime[r.type]) || fallbackRuntime[r.type]
    set.push({
      key,
      item: stubItem(r.type, r.tmdb, r.title, r.year),
      ...(r.season !== undefined && r.episode !== undefined ? { episode: { season: r.season, episode: r.episode, ...(r.episodeTitle ? { name: r.episodeTitle } : {}) } } : {}),
      position: Math.round((r.percent / 100) * duration),
      duration,
      updatedAt: r.at,
    })
  }
  return { set, ids }
}

// MARK: Applying a pull

/** The library with Trakt's contributions folded in. Existing entries (and their artwork) are kept as they are. */
export function applyPull(
  library: Library,
  pulled: { watchlist?: WatchlistMerge; history?: Watch[]; episodes?: Record<string, number>; progress?: Progress[] },
  historyLimit = 500,
): Library {
  let { watchlist, history, watchedEpisodes, progress } = library
  if (pulled.watchlist) {
    const drop = new Set(pulled.watchlist.remove)
    const added: ListEntry[] = pulled.watchlist.add.map((r) => ({ key: mediaKey(r.type, r.tmdb), item: stubItem(r.type, r.tmdb, r.title, r.year), addedAt: r.at }))
    watchlist = [...added, ...watchlist.filter((e) => !drop.has(e.key))].sort((a, b) => b.addedAt - a.addedAt)
  }
  if (pulled.history?.length) {
    const added: HistoryEntry[] = pulled.history.map((w) => ({
      key: mediaKey(w.type, w.tmdb),
      item: stubItem(w.type, w.tmdb, w.title, w.year),
      ...(w.season !== undefined && w.episode !== undefined ? { episode: { season: w.season, episode: w.episode } } : {}),
      watchedAt: w.at,
    }))
    history = [...history, ...added].sort((a, b) => b.watchedAt - a.watchedAt).slice(0, historyLimit)
    // An episode in the history is a watched episode too, without waiting for the per-show list.
    const fromHistory = Object.fromEntries(added.flatMap((h) => (h.episode ? [[episodeKey(h.item.id, h.episode), h.watchedAt] as const] : [])))
    watchedEpisodes = { ...fromHistory, ...watchedEpisodes }
  }
  if (pulled.episodes && Object.keys(pulled.episodes).length) watchedEpisodes = { ...pulled.episodes, ...watchedEpisodes }
  if (pulled.progress?.length) progress = { ...progress, ...Object.fromEntries(pulled.progress.map((p) => [p.key, p])) }
  return { ...library, watchlist, history, watchedEpisodes, progress }
}
