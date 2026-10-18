import { beforeEach, describe, expect, it } from 'vitest'
import { library, libraryStore, mediaKey } from './library'
import type { MediaItem } from '../tmdb/types'

const film: MediaItem = { type: 'movie', id: 155, title: 'The Dark Knight', overview: '', genres: [] }
const show: MediaItem = { type: 'show', id: 1396, title: 'Breaking Bad', overview: '', genres: [] }

describe('Library', () => {
  beforeEach(() => libraryStore.set({ progress: {}, watchlist: [], favourites: [], history: [], watchedEpisodes: {} }))

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
})
