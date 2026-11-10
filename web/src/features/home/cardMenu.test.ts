import { describe, expect, it } from 'vitest'
import { cardActionLabels, cardActions, shareMessage, tmdbPage } from './cardMenu'

describe('cardActions', () => {
  it('gives a Continue Watching card the three the apps give it', () => {
    expect(cardActions({ kind: 'continue', hasProgress: true })).toEqual(['details', 'watched', 'remove'])
    expect(cardActions({ kind: 'continue', hasProgress: true }).map((a) => cardActionLabels[a])).toEqual(['Go to Details', 'Mark as Watched', 'Remove from Continue Watching'])
  })

  it('does not offer to remove a next episode, which has no resume point to forget', () => {
    expect(cardActions({ kind: 'continue', hasProgress: false })).toEqual(['details', 'watched'])
  })

  it('gives any other title the apps\u2019 menu: Play, Watchlist, Watched, Favourites, Share', () => {
    const film = { kind: 'title', show: false, watched: false, onWatchlist: false, favourite: false } as const
    expect(cardActions(film)).toEqual(['details', 'play', 'watchlist', 'watched', 'favourite', 'share'])
    expect(cardActions(film).map((a) => cardActionLabels[a])).toEqual(['Go to Details', 'Play', 'Add to Watchlist', 'Mark as Watched', 'Add to Favourites', 'Share'])
  })

  it('adds Shuffle Play for a series only', () => {
    expect(cardActions({ kind: 'title', show: true, watched: false, onWatchlist: false, favourite: false })).toContain('shuffle')
    expect(cardActions({ kind: 'title', show: false, watched: false, onWatchlist: false, favourite: false })).not.toContain('shuffle')
  })

  it('turns Watched, Watchlist and Favourites around when they are already so', () => {
    expect(cardActions({ kind: 'title', show: false, watched: true, onWatchlist: true, favourite: true })).toEqual(['details', 'play', 'unwatchlist', 'unwatched', 'unfavourite', 'share'])
  })

  it('shares the title\u2019s TMDB page with its name and year', () => {
    expect(tmdbPage({ type: 'movie', id: 693134 })).toBe('https://www.themoviedb.org/movie/693134')
    expect(tmdbPage({ type: 'show', id: 1396 })).toBe('https://www.themoviedb.org/tv/1396')
    expect(shareMessage({ title: 'Dune: Part Two', year: 2024 })).toBe('Dune: Part Two (2024)')
    expect(shareMessage({ title: 'Dune' })).toBe('Dune')
  })
})
