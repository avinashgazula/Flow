import { beforeEach, describe, expect, it } from 'vitest'
import { library, libraryStore, mediaKey } from './library'
import type { MediaItem } from '../tmdb/types'

const film: MediaItem = { type: 'movie', id: 155, title: 'The Dark Knight', overview: '', genres: [] }
const show: MediaItem = { type: 'show', id: 1396, title: 'Breaking Bad', overview: '', genres: [] }

describe('Library', () => {
  beforeEach(() => libraryStore.set({ progress: {}, watchlist: [], favourites: [], history: [], watchedEpisodes: {}, ratings: {}, rewatches: {}, shuffled: {} }))

  it('ignores the first half minute, so opening a film by mistake doesn’t start it', () => {
    library.saveProgress(film, 12, 9000)
    expect(libraryStore.get().progress).toEqual({})
  })

  it('remembers where playback is', () => {
    library.saveProgress(film, 600, 9000)
    expect(libraryStore.get().progress[mediaKey('movie', 155)]?.position).toBe(600)
  })

  it('moves a title past the credits threshold to History', () => {
    library.saveProgress(film, 600, 9000)
    library.saveProgress(film, 8500, 9000)
    expect(libraryStore.get().progress).toEqual({})
    expect(libraryStore.get().history[0]?.key).toBe('movie:155')
  })

  it('marks a finished episode watched', () => {
    library.saveProgress(show, 2700, 2820, { season: 3, episode: 7 })
    expect(libraryStore.get().watchedEpisodes['show:1396:s3e7']).toBeTypeOf('number')
  })

  it('toggles the watchlist', () => {
    library.toggleWatchlist(film)
    expect(libraryStore.get().watchlist.map((e) => e.key)).toEqual(['movie:155'])
    library.toggleWatchlist(film)
    expect(libraryStore.get().watchlist).toEqual([])
  })

  it('marks a season watched in one change, once for each episode not already watched', () => {
    library.markWatched(show, { season: 1, episode: 1 })
    library.markEpisodesWatched(show, [{ season: 1, episode: 1 }, { season: 1, episode: 2 }, { season: 1, episode: 3 }])
    const l = libraryStore.get()
    expect(Object.keys(l.watchedEpisodes).sort()).toEqual(['show:1396:s1e1', 'show:1396:s1e2', 'show:1396:s1e3'])
    expect(l.history.length).toBe(3)
  })

  it('takes an episode back out of what is watched, and a film', () => {
    library.markEpisodesWatched(show, [{ season: 1, episode: 1 }, { season: 1, episode: 2 }])
    library.markWatched(film)
    library.markUnwatched(show, [{ season: 1, episode: 1 }])
    library.markUnwatched(film)
    const l = libraryStore.get()
    expect(Object.keys(l.watchedEpisodes)).toEqual(['show:1396:s1e2'])
    expect(l.history.map((h) => h.key)).toEqual(['show:1396'])
  })

  it('keeps a score, and clears it', () => {
    library.rate(film, 7)
    expect(libraryStore.get().ratings?.['movie:155']).toBe(7)
    library.rate(film, 40)
    expect(libraryStore.get().ratings?.['movie:155']).toBe(10)
    library.rate(film, null)
    expect(libraryStore.get().ratings).toEqual({})
  })

  it('moves a rewatch on as episodes are watched again, and leaves earlier plays alone when one is unticked', () => {
    library.markEpisodesWatched(show, [{ season: 1, episode: 1 }, { season: 1, episode: 2 }])
    library.startRewatch(show)
    expect(libraryStore.get().rewatches?.['show:1396']?.watched).toEqual([])
    library.markWatched(show, { season: 1, episode: 1 })
    library.markEpisodesWatched(show, [{ season: 1, episode: 2 }])
    expect(libraryStore.get().rewatches?.['show:1396']?.watched).toEqual(['s1e1', 's1e2'])
    const history = libraryStore.get().history.length
    library.markUnwatched(show, [{ season: 1, episode: 2 }])
    expect(libraryStore.get().rewatches?.['show:1396']?.watched).toEqual(['s1e1'])
    expect(libraryStore.get().history.length).toBe(history)
    expect(libraryStore.get().watchedEpisodes['show:1396:s1e2']).toBeTypeOf('number')
    library.endRewatch(show)
    expect(libraryStore.get().rewatches).toEqual({})
  })
})
