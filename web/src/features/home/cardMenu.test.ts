import { describe, expect, it } from 'vitest'
import { cardActionLabels, cardActions } from './cardMenu'

describe('cardActions', () => {
  it('gives a Continue Watching card the three the apps give it', () => {
    expect(cardActions({ kind: 'continue', hasProgress: true })).toEqual(['details', 'watched', 'remove'])
    expect(cardActions({ kind: 'continue', hasProgress: true }).map((a) => cardActionLabels[a])).toEqual(['Go to Details', 'Mark as Watched', 'Remove from Continue Watching'])
  })

  it('does not offer to remove a next episode, which has no resume point to forget', () => {
    expect(cardActions({ kind: 'continue', hasProgress: false })).toEqual(['details', 'watched'])
  })

  it('turns Watched and Watchlist around when they are already so', () => {
    expect(cardActions({ kind: 'title', watched: false, onWatchlist: false })).toEqual(['details', 'watched', 'watchlist'])
    expect(cardActions({ kind: 'title', watched: true, onWatchlist: true })).toEqual(['details', 'unwatched', 'unwatchlist'])
  })
})
