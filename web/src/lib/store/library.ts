import type { MediaItem, MediaType } from '../tmdb/types'
import { createStore, useStore } from './createStore'
import { settingsStore } from './settings'

export const mediaKey = (type: MediaType, id: number) => `${type}:${id}`

export interface EpisodeRef {
  season: number
  episode: number
}

export interface Progress {
  key: string
  item: MediaItem
  episode?: EpisodeRef & { name?: string; still?: string }
  position: number
  duration: number
  updatedAt: number
}

export interface HistoryEntry {
  key: string
  item: MediaItem
  episode?: EpisodeRef
  watchedAt: number
}

export interface ListEntry {
  key: string
  item: MediaItem
  addedAt: number
}

export interface Library {
  progress: Record<string, Progress>
  watchlist: ListEntry[]
  favourites: ListEntry[]
  history: HistoryEntry[]
  /** Episodes marked watched, as "show:1396:s3e7". */
  watchedEpisodes: Record<string, number>
  /** The viewer's own 1 to 10 score for a title, by key. Two points a star. */
  ratings?: Record<string, number>
  /** A rewatch in progress, by show key: Next Up follows it, and the episodes ticked are the ones seen again. */
  rewatches?: Record<string, Rewatch>
  /** Episodes Shuffle has already picked in this round, by show key, as "s3e7". */
  shuffled?: Record<string, string[]>
}

/** As FlowKit's Rewatch: when it began and which episodes have been watched again since. */
export interface Rewatch {
  startedAt: number
  watched: string[]
}

const empty: Library = { progress: {}, watchlist: [], favourites: [], history: [], watchedEpisodes: {}, ratings: {}, rewatches: {}, shuffled: {} }

export const libraryStore = createStore<Library>('library', empty)
export const useLibrary = <S,>(selector: (l: Library) => S) => useStore(libraryStore, selector)

/** Below this a title hasn't really been started; above the credits threshold it's finished. */
const startedAfter = 30
const finishedAt = 0.92

export const library = {
  toggleWatchlist(item: MediaItem) {
    const key = mediaKey(item.type, item.id)
    libraryStore.set((l) => ({
      watchlist: l.watchlist.some((e) => e.key === key)
        ? l.watchlist.filter((e) => e.key !== key)
        : [{ key, item: slim(item), addedAt: Date.now() }, ...l.watchlist],
    }))
  },
  toggleFavourite(item: MediaItem) {
    const key = mediaKey(item.type, item.id)
    libraryStore.set((l) => ({
      favourites: l.favourites.some((e) => e.key === key)
        ? l.favourites.filter((e) => e.key !== key)
        : [{ key, item: slim(item), addedAt: Date.now() }, ...l.favourites],
    }))
  },
  /** Records where playback is. Finishing moves the title to History and clears its progress. */
  saveProgress(item: MediaItem, position: number, duration: number, episode?: Progress['episode']) {
    if (!Number.isFinite(duration) || duration <= 0 || position < startedAfter) return
    const key = mediaKey(item.type, item.id)
    if (position / duration >= finishedAt) {
      library.markWatched(item, episode)
      return
    }
    libraryStore.set((l) => ({
      progress: { ...l.progress, [key]: { key, item: slim(item), episode, position, duration, updatedAt: Date.now() } },
    }))
  },
  markWatched(item: MediaItem, episode?: EpisodeRef) {
    const key = mediaKey(item.type, item.id)
    libraryStore.set((l) => {
      const progress = { ...l.progress }
      delete progress[key]
      const watchedEpisodes = episode ? { ...l.watchedEpisodes, [episodeKey(item.id, episode)]: Date.now() } : l.watchedEpisodes
      return {
        progress,
        watchedEpisodes,
        history: [{ key, item: slim(item), episode, watchedAt: Date.now() }, ...l.history].slice(0, 500),
        // Watching an episode during a rewatch moves the rewatch on, as the apps' advanceRewatch.
        ...(episode ? { rewatches: advanceRewatch(l.rewatches, key, episode) } : {}),
      }
    })
  },
  /** Many episodes at once (a season, a whole show): one change to the store, one history entry for each episode
   *  not already watched. Trakt hears about them through the library's own watching of its history. */
  markEpisodesWatched(item: MediaItem, episodes: EpisodeRef[]) {
    const key = mediaKey(item.type, item.id)
    libraryStore.set((l) => {
      const now = Date.now()
      const fresh = episodes.filter((e) => !(episodeKey(item.id, e) in l.watchedEpisodes))
      // A rewatch counts them again, whether or not they were watched before.
      const rewatches = episodes.reduce((all, e) => advanceRewatch(all, key, e), l.rewatches)
      if (!fresh.length) return rewatches === l.rewatches ? {} : { rewatches }
      const progress = { ...l.progress }
      if (progress[key]?.episode && fresh.some((e) => e.season === progress[key]!.episode!.season && e.episode === progress[key]!.episode!.episode)) delete progress[key]
      return {
        progress,
        watchedEpisodes: { ...l.watchedEpisodes, ...Object.fromEntries(fresh.map((e) => [episodeKey(item.id, e), now])) },
        history: [...fresh.map((e) => ({ key, item: slim(item), episode: e, watchedAt: now })), ...l.history].slice(0, 500),
        rewatches,
      }
    })
  },
  /** Takes a film, an episode or several episodes back out of what is watched. Trakt is told, which a cleared
   *  history never does. During a rewatch an episode comes off the rewatch only: the plays before it stay. */
  markUnwatched(item: MediaItem, episodes?: EpisodeRef[]) {
    const key = mediaKey(item.type, item.id)
    const refs = episodes ?? [undefined]
    const rewatching = !!libraryStore.get().rewatches?.[key]
    if (rewatching && episodes) {
      libraryStore.set((l) => ({ rewatches: unwatchInRewatch(l.rewatches, key, episodes) }))
      return
    }
    libraryStore.set((l) => {
      const gone = new Set(refs.map((e) => (e ? episodeKey(item.id, e) : '')))
      const watchedEpisodes = { ...l.watchedEpisodes }
      for (const k of gone) delete watchedEpisodes[k]
      const history = l.history.filter((h) => h.key !== key || !gone.has(h.episode ? episodeKey(item.id, h.episode) : ''))
      return { watchedEpisodes, history }
    })
    if (settingsStore.get().traktAccount) void import('../trakt/engine').then((m) => refs.forEach((e) => m.unwatchTitle(item, e)))
  },
  /** The viewer's own score, 1 to 10, or null to clear it. Kept here whoever is signed in, and sent to Trakt when
   *  there is a sign-in. */
  rate(item: MediaItem, score: number | null) {
    const key = mediaKey(item.type, item.id)
    libraryStore.set((l) => {
      const ratings = { ...l.ratings }
      if (score === null) delete ratings[key]
      else ratings[key] = Math.min(10, Math.max(1, Math.round(score)))
      return { ratings }
    })
    if (settingsStore.get().traktAccount) void import('../trakt/engine').then((m) => m.rateTitle(item, score))
  },
  startRewatch(item: MediaItem) {
    libraryStore.set((l) => ({ rewatches: { ...l.rewatches, [mediaKey(item.type, item.id)]: { startedAt: Date.now(), watched: [] } } }))
  },
  endRewatch(item: MediaItem) {
    libraryStore.set((l) => {
      const rewatches = { ...l.rewatches }
      delete rewatches[mediaKey(item.type, item.id)]
      return { rewatches }
    })
  },
  /** Remembers an episode Shuffle picked, so the next pick is a different one until all have been. */
  rememberShuffled(item: MediaItem, picked: string[]) {
    libraryStore.set((l) => ({ shuffled: { ...l.shuffled, [mediaKey(item.type, item.id)]: picked } }))
  },
  removeProgress(key: string) {
    libraryStore.set((l) => {
      const progress = { ...l.progress }
      delete progress[key]
      return { progress }
    })
  },
  clearHistory() {
    libraryStore.set({ history: [], watchedEpisodes: {} })
  },
}

export const episodeKey = (showId: number, e: EpisodeRef) => `show:${showId}:s${e.season}e${e.episode}`
/** An episode as the rewatch and shuffle lists keep it: "s3e7". */
export const episodeCode = (e: EpisodeRef) => `s${e.season}e${e.episode}`

function advanceRewatch(rewatches: Library['rewatches'], key: string, episode: EpisodeRef): Library['rewatches'] {
  const current = rewatches?.[key]
  if (!current || current.watched.includes(episodeCode(episode))) return rewatches
  return { ...rewatches, [key]: { ...current, watched: [...current.watched, episodeCode(episode)] } }
}

function unwatchInRewatch(rewatches: Library['rewatches'], key: string, episodes: EpisodeRef[]): Library['rewatches'] {
  const current = rewatches?.[key]
  if (!current) return rewatches
  const gone = new Set(episodes.map(episodeCode))
  return { ...rewatches, [key]: { ...current, watched: current.watched.filter((c) => !gone.has(c)) } }
}

/** Drops the overview so hundreds of entries stay small in storage. */
function slim(item: MediaItem): MediaItem {
  return { ...item, overview: item.overview.length > 240 ? `${item.overview.slice(0, 237)}…` : item.overview }
}
