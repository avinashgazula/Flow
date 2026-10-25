import type { MediaItem, MediaType } from '../tmdb/types'
import { createStore, useStore } from './createStore'

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

export function advanceRewatch(rewatches: Library['rewatches'], key: string, episode: EpisodeRef): Library['rewatches'] {
  const current = rewatches?.[key]
  if (!current || current.watched.includes(episodeCode(episode))) return rewatches
  return { ...rewatches, [key]: { ...current, watched: [...current.watched, episodeCode(episode)] } }
}

/** Drops the overview so hundreds of entries stay small in storage. */
export function slim(item: MediaItem): MediaItem {
  return { ...item, overview: item.overview.length > 240 ? `${item.overview.slice(0, 237)}…` : item.overview }
}
