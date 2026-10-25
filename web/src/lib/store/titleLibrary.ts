import { settingsStore } from './settings'
import { advanceRewatch, episodeCode, episodeKey, libraryStore, mediaKey, slim, type EpisodeRef, type Library } from './library'
import type { MediaItem } from '../tmdb/types'

/* What a title's page does to the library beyond marking one thing watched: whole seasons, taking watched back out,
   the viewer's own score, rewatches and Shuffle's memory. They sit apart from `library` (store/library.ts) so the
   first page doesn't carry them; only a title page, which is a chunk of its own, imports this. */

export const titleLibrary = {
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
}

function unwatchInRewatch(rewatches: Library['rewatches'], key: string, episodes: EpisodeRef[]): Library['rewatches'] {
  const current = rewatches?.[key]
  if (!current) return rewatches
  const gone = new Set(episodes.map(episodeCode))
  return { ...rewatches, [key]: { ...current, watched: current.watched.filter((c) => !gone.has(c)) } }
}
