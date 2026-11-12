/* Between the website's library (store/library.ts and the remembered sources) and the account's wire form (wire.ts).

   The account holds more than the website shows: every resume point of a show, all of history, titles the website has
   not opened. So the website's view is a projection of the account's state, and a change made here is found by comparing
   the library with the projection of what was last synced, entry by entry. What is new or different is stamped now; what
   has gone is a removal (a tombstone), stamped now. Pure, so the rules are tested without a browser. */

import { episodeCode as webEpisodeCode, episodeKey, type HistoryEntry as WebHistory, type Library, type ListEntry as WebListEntry, type Progress, type Rewatch } from '../store/library'
import type { LastSource } from '../sources/lastSource'
import type { Source } from '../sources/types'
import type { MediaItem } from '../tmdb/types'
import {
  at,
  canonical,
  historyId,
  iso,
  progressId,
  removedKey,
  type Card,
  type Episode,
  type HistoryEntry,
  type ListEntry,
  type ProgressEntry,
  type RatingEntry,
  type RewatchEntry,
  type SourceEntry,
  type WireState,
} from './wire'

/** The website keeps this many plays in History (store/library.ts); older ones stay in the account. */
export const historyShown = 500

const isKey = (key: string) => /^(movie|show):\d+$/.test(key)

// MARK: Titles

export function cardOf(item: MediaItem): Card {
  return {
    title: item.title,
    ...(item.year ? { year: item.year } : {}),
    ...(item.date ? { date: item.date } : {}),
    ...(item.poster ? { poster: item.poster } : {}),
    ...(item.backdrop ? { backdrop: item.backdrop } : {}),
    ...(item.rating ? { rating: item.rating } : {}),
    ...(item.genres.length ? { genres: item.genres } : {}),
    ...(item.originalLanguage ? { originalLanguage: item.originalLanguage } : {}),
  }
}

/** A title from its card. A title no card was written for keeps what this browser already knew of it, else a placeholder. */
export function itemOf(key: string, card: Card | undefined, known?: MediaItem): MediaItem {
  const [type, id] = key.split(':')
  if (!card) return known ?? { type: type as MediaItem['type'], id: Number(id), title: 'Untitled', overview: '', genres: [] }
  return {
    type: type as MediaItem['type'],
    id: Number(id),
    title: card.title,
    overview: known?.overview ?? '',
    genres: card.genres ?? [],
    ...(card.year ? { year: card.year } : {}),
    ...(card.date ? { date: card.date } : {}),
    ...(card.poster ? { poster: card.poster } : {}),
    ...(card.backdrop ? { backdrop: card.backdrop } : {}),
    ...(card.rating ? { rating: card.rating } : {}),
    ...(card.originalLanguage ? { originalLanguage: card.originalLanguage } : {}),
  }
}

const episodeOut = (e: { season: number; episode: number; name?: string; still?: string }): Episode & { name?: string; still?: string } => ({ season: e.season, episode: e.episode, ...(e.name ? { name: e.name } : {}), ...(e.still ? { still: e.still } : {}) })
const watchedCode = (e: Episode) => webEpisodeCode(e)
const parseCode = (code: string): Episode | undefined => {
  const m = /^s(\d+)e(\d+)$/i.exec(code)
  return m ? { season: Number(m[1]), episode: Number(m[2]) } : undefined
}

// MARK: The account's state as the website's library

export interface Projection {
  library: Pick<Library, 'watchlist' | 'favourites' | 'progress' | 'history' | 'watchedEpisodes' | 'ratings' | 'rewatches' | 'shuffled' | 'watchlistOrder'>
  sources: Record<string, LastSource>
}

const RESOLUTIONS: Record<number, NonNullable<Source['resolution']>> = { 2160: '2160p', 1440: '1440p', 1080: '1080p', 720: '720p', 480: '480p' }
const resolutionNumber = (r: Source['resolution']): number => (r === '2160p' ? 2160 : r === '1440p' ? 1440 : r === '1080p' ? 1080 : r === '720p' ? 720 : r === '480p' || r === 'SD' ? 480 : 0)

export function sourceOut(s: LastSource): SourceEntry {
  return {
    providerID: s.providerId,
    ...(s.filename ? { filename: s.filename } : {}),
    ...(s.bingeGroup ? { bingeGroup: s.bingeGroup } : {}),
    ...(s.releaseGroup ? { releaseGroup: s.releaseGroup } : {}),
    resolution: resolutionNumber(s.resolution),
    quality: s.quality ?? 'Unknown',
    hdr: s.hdr ?? [],
    date: iso(s.date),
    // The format print on Home's strips; the apps ignore these.
    ...(s.audio ? { audio: s.audio } : {}),
    ...(s.audioChannels ? { audioChannels: s.audioChannels } : {}),
  }
}

export function sourceIn(s: SourceEntry): LastSource {
  const known = s.resolution in RESOLUTIONS
  return {
    providerId: s.providerID,
    ...(s.filename ? { filename: s.filename } : {}),
    ...(s.bingeGroup ? { bingeGroup: s.bingeGroup } : {}),
    ...(s.releaseGroup ? { releaseGroup: s.releaseGroup } : {}),
    ...(known ? { resolution: RESOLUTIONS[s.resolution] } : {}),
    ...(s.quality && s.quality !== 'Unknown' ? { quality: s.quality as LastSource['quality'] } : {}),
    ...(Array.isArray(s.hdr) && s.hdr.length ? { hdr: s.hdr as LastSource['hdr'] } : {}),
    ...(Array.isArray(s.audio) ? { audio: s.audio as string[] } : {}),
    ...(typeof s.audioChannels === 'string' ? { audioChannels: s.audioChannels } : {}),
    date: at(s.date),
  }
}

/** What the website shows of an account's state. `known` is what this browser has already, for titles with no card. */
export function project(s: WireState, known: Library): Projection {
  const knownItem = (key: string) => [...known.watchlist, ...known.favourites, ...known.history, ...Object.values(known.progress)].find((e) => e.key === key)?.item
  const item = (key: string) => itemOf(key, s.items[key], knownItem(key))
  const list = (entries: ListEntry[]): WebListEntry[] => entries.map((e) => ({ key: e.key, item: item(e.key), addedAt: at(e.addedAt) }))

  // The website keeps one resume point per title: the newest. A point with no position or length can't be resumed here.
  const progress: Record<string, Progress> = {}
  for (const e of s.progress) {
    if (typeof e.positionSeconds !== 'number' || typeof e.durationSeconds !== 'number' || e.durationSeconds <= 0) continue
    const held = progress[e.key]
    if (held && held.updatedAt >= at(e.updatedAt)) continue
    progress[e.key] = { key: e.key, item: item(e.key), ...(e.episode ? { episode: episodeOut(e.episode) } : {}), position: e.positionSeconds, duration: e.durationSeconds, updatedAt: at(e.updatedAt) }
  }

  const history: WebHistory[] = s.history.slice(0, historyShown).map((e) => ({ key: e.key, item: item(e.key), ...(e.episode ? { episode: { season: e.episode.season, episode: e.episode.episode } } : {}), watchedAt: at(e.watchedAt), ...(typeof e.runtime === 'number' ? { runtime: e.runtime } : {}) }))
  const watchedEpisodes: Record<string, number> = {}
  for (const e of s.history) {
    if (!e.episode || !e.key.startsWith('show:')) continue
    const k = episodeKey(Number(e.key.slice(5)), e.episode)
    watchedEpisodes[k] = Math.max(watchedEpisodes[k] ?? 0, at(e.watchedAt))
  }

  const rewatches: Record<string, Rewatch> = {}
  for (const e of s.rewatches) rewatches[e.key] = { startedAt: at(e.startedAt), watched: e.watched.map(watchedCode) }
  const shuffled: Record<string, string[]> = {}
  for (const e of s.shuffle) shuffled[e.key] = e.played.map(watchedCode)

  return {
    library: {
      watchlist: list(s.watchlist),
      favourites: list(s.favourites),
      progress,
      history,
      watchedEpisodes,
      ratings: Object.fromEntries(Object.entries(s.ratings).map(([k, r]) => [k, r.value])),
      rewatches,
      shuffled,
      watchlistOrder: s.order?.keys ?? [],
    },
    sources: Object.fromEntries(Object.entries(s.sources).map(([k, v]) => [k, sourceIn(v)])),
  }
}

// MARK: The website's changes laid on the account's state

/** The state with this browser's changes made to it, as of `now`: `base` is what was last synced, `library` and
 *  `sources` are what the person has now. Everything else in `base` (resume points of other episodes, plays the website
 *  doesn't show, titles it has no cards for) is untouched. */
export function applyLocal(base: WireState, library: Library, sources: Record<string, LastSource>, now: number): WireState {
  const was = project(base, library)
  const next: WireState = { ...base, removed: { ...base.removed }, items: { ...base.items } }
  const stamp = iso(now)
  const gone = (list: string, id: string) => void (next.removed[removedKey(list, id)] = stamp)
  const learn = (item: MediaItem) => void (next.items[`${item.type}:${item.id}`] = cardOf(item))

  // Watchlist and favourites: a key added keeps the time it was added; a key gone is a removal.
  for (const name of ['watchlist', 'favourites'] as const) {
    const had = new Map(was.library[name].map((e) => [e.key, e]))
    const has = new Map(library[name].map((e) => [e.key, e]))
    const kept = next[name].filter((e) => !(had.has(e.key) && !has.has(e.key)))
    for (const key of had.keys()) if (!has.has(key)) gone(name, key)
    for (const e of library[name]) {
      if (had.has(e.key) && had.get(e.key)!.addedAt === e.addedAt) continue
      kept.push({ key: e.key, addedAt: iso(e.addedAt) })
      learn(e.item)
    }
    next[name] = dedupe(kept)
  }

  // Ratings.
  const ratings = { ...next.ratings }
  for (const [key, value] of Object.entries(library.ratings ?? {})) if (was.library.ratings?.[key] !== value) ratings[key] = { ...ratings[key], value, ratedAt: stamp } as RatingEntry
  for (const key of Object.keys(was.library.ratings ?? {})) if (!(key in (library.ratings ?? {}))) (delete ratings[key], gone('ratings', key))
  next.ratings = ratings

  // Resume points: the title's one entry changed, or went.
  let progress = [...next.progress]
  for (const [key, p] of Object.entries(library.progress)) {
    const before = was.library.progress[key]
    if (before && before.updatedAt === p.updatedAt) continue
    if (before) {
      const old = base.progress.find((e) => e.key === key && at(e.updatedAt) === before.updatedAt)
      if (old) {
        progress = progress.filter((e) => e !== old)
        if (progressId(old) !== progressId({ key, ...(p.episode ? { episode: p.episode } : {}) })) gone('progress', progressId(old))
      }
    }
    const entry: ProgressEntry = { key, ...(p.episode ? { episode: episodeOut(p.episode) } : {}), percent: Math.min(100, (p.position / p.duration) * 100), positionSeconds: p.position, durationSeconds: p.duration, updatedAt: iso(p.updatedAt) }
    progress = progress.filter((e) => progressId(e) !== progressId(entry))
    progress.push(entry)
    learn(p.item)
  }
  for (const [key, before] of Object.entries(was.library.progress)) {
    if (key in library.progress) continue
    const old = base.progress.find((e) => e.key === key && at(e.updatedAt) === before.updatedAt)
    if (old) {
      progress = progress.filter((e) => e !== old)
      gone('progress', progressId(old))
    }
  }
  next.progress = progress

  // History. A play is new when the website has it and the account doesn't. A play is removed when the website no longer
  // has it, unless it is older than everything the website keeps (its list is capped, so a trimmed play isn't a removal).
  const accountIds = new Map(base.history.map((e) => [historyId(e), e]))
  const localIds = new Map<string, WebHistory>()
  for (const h of library.history) localIds.set(historyId({ key: h.key, ...(h.episode ? { episode: h.episode } : {}), watchedAt: iso(h.watchedAt) }), h)
  const oldest = library.history.length >= historyShown ? Math.min(...library.history.map((h) => h.watchedAt)) : -Infinity
  const removedIds = new Set<string>()
  for (const [id, entry] of accountIds) {
    if (localIds.has(id)) continue
    const shown = was.library.history.some((h) => historyId({ key: h.key, ...(h.episode ? { episode: h.episode } : {}), watchedAt: iso(h.watchedAt) }) === id)
    if (shown && at(entry.watchedAt) >= oldest) removedIds.add(id)
  }
  // An episode that is no longer watched takes every play of it away.
  for (const [k, ts] of Object.entries(was.library.watchedEpisodes)) {
    if (k in library.watchedEpisodes || ts === undefined) continue
    for (const [id, entry] of accountIds) if (entry.episode && entry.key.startsWith('show:') && episodeKey(Number(entry.key.slice(5)), entry.episode) === k) removedIds.add(id)
  }
  let history = next.history.filter((e) => !removedIds.has(historyId(e)))
  for (const id of removedIds) gone('history', id)
  for (const [id, h] of localIds) {
    if (accountIds.has(id)) continue
    history.push({ key: h.key, ...(h.episode ? { episode: { season: h.episode.season, episode: h.episode.episode } } : {}), watchedAt: iso(h.watchedAt), ...(h.runtime ? { runtime: h.runtime } : {}) })
    learn(h.item)
  }
  // A watched episode with no play behind it (the website's list is capped) gets one, so other devices learn of it.
  const covered = new Set(history.filter((e) => e.episode && e.key.startsWith('show:')).map((e) => episodeKey(Number(e.key.slice(5)), e.episode!)))
  for (const [k, ts] of Object.entries(library.watchedEpisodes)) {
    if (covered.has(k)) continue
    const m = /^show:(\d+):s(\d+)e(\d+)$/.exec(k)
    if (!m) continue
    history.push({ key: `show:${m[1]}`, episode: { season: Number(m[2]), episode: Number(m[3]) }, watchedAt: iso(ts) })
  }
  history = dedupeHistory(history)
  next.history = history

  // Rewatches: a new one, one that moved on (stamped now), or one that ended.
  let rewatches = [...next.rewatches]
  for (const [key, r] of Object.entries(library.rewatches ?? {})) {
    const before = was.library.rewatches?.[key]
    if (before && before.startedAt === r.startedAt && canonical(before.watched) === canonical(r.watched)) continue
    const old = rewatches.find((e) => e.key === key)
    const watched = r.watched.map(parseCode).filter((e): e is Episode => !!e)
    const entry: RewatchEntry = { ...old, key, startedAt: iso(r.startedAt), updatedAt: stamp, watched }
    rewatches = rewatches.filter((e) => e.key !== key).concat(entry)
  }
  for (const key of Object.keys(was.library.rewatches ?? {})) {
    if (key in (library.rewatches ?? {})) continue
    rewatches = rewatches.filter((e) => e.key !== key)
    gone('rewatches', key)
  }
  next.rewatches = rewatches

  // Shuffle remembers what it has played; a round that starts over doesn't take plays back from the other devices.
  const shuffle = new Map(next.shuffle.map((e) => [e.key, e]))
  for (const [key, codes] of Object.entries(library.shuffled ?? {})) {
    const played = codes.map(parseCode).filter((e): e is Episode => !!e)
    const old = shuffle.get(key)
    if (!old || canonical(old.played.map(watchedCode).sort()) !== canonical([...codes].sort())) shuffle.set(key, { ...old, key, played: [...new Map([...(old?.played ?? []), ...played].map((e) => [watchedCode(e), e])).values()] })
  }
  next.shuffle = [...shuffle.values()]

  // The watchlist's own order.
  const order = library.watchlistOrder ?? []
  if (canonical(order) !== canonical(was.library.watchlistOrder ?? [])) next.order = order.length ? { keys: order.filter(isKey), updatedAt: stamp } : { keys: [], updatedAt: stamp }

  // Remembered sources.
  const sourcesNext = { ...next.sources }
  for (const [key, s] of Object.entries(sources)) if (was.sources[key]?.date !== s.date) sourcesNext[key] = sourceOut(s)
  for (const key of Object.keys(was.sources)) if (!(key in sources)) (delete sourcesNext[key], gone('sources', key))
  next.sources = sourcesNext

  return next
}

const dedupe = (entries: ListEntry[]): ListEntry[] => [...new Map(entries.map((e) => [e.key, e])).values()]
const dedupeHistory = (entries: HistoryEntry[]): HistoryEntry[] => [...new Map(entries.map((e) => [historyId(e), e])).values()]

// MARK: Applying a merged state

/** The settings-store patch that makes the website's library match `merged`, leaving alone every collection already the same
 *  and every entry already as it is (so details only this browser holds, like an episode's still, are kept). */
export function patchFor(merged: WireState, library: Library): { library: Partial<Library>; sources: Record<string, LastSource> } {
  const view = project(merged, library)
  const out: Partial<Library> = {}
  const keepList = (now: WebListEntry[], next: WebListEntry[]) => (canonical(now.map((e) => [e.key, e.addedAt])) === canonical(next.map((e) => [e.key, e.addedAt])) ? undefined : next)
  const watchlist = keepList(library.watchlist, view.library.watchlist)
  if (watchlist) out.watchlist = watchlist
  const favourites = keepList(library.favourites, view.library.favourites)
  if (favourites) out.favourites = favourites

  const progress: Record<string, Progress> = {}
  for (const [k, p] of Object.entries(view.library.progress)) {
    const now = library.progress[k]
    progress[k] = now && now.updatedAt === p.updatedAt && canonical([now.episode?.season, now.episode?.episode]) === canonical([p.episode?.season, p.episode?.episode]) ? now : { ...p, ...(p.episode && now?.episode?.season === p.episode.season && now.episode.episode === p.episode.episode ? { episode: { ...p.episode, ...now.episode } } : {}) }
  }
  if (canonical(Object.entries(progress).map(([k, p]) => [k, p.updatedAt, p.position])) !== canonical(Object.entries(library.progress).map(([k, p]) => [k, p.updatedAt, p.position]))) out.progress = progress

  const histIds = (h: WebHistory[]) => h.map((e) => canonical([e.key, e.episode?.season, e.episode?.episode, e.watchedAt]))
  if (canonical(histIds(library.history)) !== canonical(histIds(view.library.history))) out.history = view.library.history
  if (canonical(library.watchedEpisodes) !== canonical(view.library.watchedEpisodes)) out.watchedEpisodes = view.library.watchedEpisodes
  if (canonical(library.ratings ?? {}) !== canonical(view.library.ratings ?? {})) out.ratings = view.library.ratings
  if (canonical(library.rewatches ?? {}) !== canonical(view.library.rewatches ?? {})) out.rewatches = view.library.rewatches
  // Shuffle keeps whatever the website has played too.
  const shuffled = { ...view.library.shuffled }
  for (const [k, codes] of Object.entries(library.shuffled ?? {})) shuffled[k] = [...new Set([...(shuffled[k] ?? []), ...codes])]
  if (canonical(library.shuffled ?? {}) !== canonical(shuffled)) out.shuffled = shuffled
  if (canonical(library.watchlistOrder ?? []) !== canonical(view.library.watchlistOrder ?? [])) out.watchlistOrder = view.library.watchlistOrder
  return { library: out, sources: view.sources }
}
