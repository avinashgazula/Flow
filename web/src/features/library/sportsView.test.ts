import { describe, expect, it } from 'vitest'
import type { SportsEvent } from '../../lib/sports/types'
import { actionLabel, gameActions, hasGames, metaText, scoreHidden, scoreText, whenText } from './sportsView'

const upcoming: SportsEvent = { id: '1', title: 'Harbour City vs Eastvale Athletic', league: 'Premier Division', date: new Date(2026, 9, 31, 20, 0).getTime() }
const final: SportsEvent = { ...upcoming, id: '2', homeScore: 3, awayScore: 1 }

describe('what a game does when tapped', () => {
  it('plays the best channel on tap by default, and the list is the other control', () => {
    expect(gameActions(upcoming, { chooseChannelOnTap: false, scoreHidden: false })).toEqual({ tap: 'play', other: 'list' })
  })

  it('reverses with Choose Channel on Tap', () => {
    expect(gameActions(upcoming, { chooseChannelOnTap: true, scoreHidden: false })).toEqual({ tap: 'list', other: 'play' })
  })

  it('uncovers a hidden score on a finished game, and has nothing to watch otherwise', () => {
    expect(gameActions(final, { chooseChannelOnTap: false, scoreHidden: true })).toEqual({ tap: 'reveal', other: 'none' })
    expect(gameActions(final, { chooseChannelOnTap: true, scoreHidden: false })).toEqual({ tap: 'none', other: 'none' })
  })
})

describe('hiding scores', () => {
  it('covers a finished game’s score only when spoilers are off and it has not been uncovered', () => {
    expect(scoreHidden(final, true, new Set())).toBe(false)
    expect(scoreHidden(final, false, new Set())).toBe(true)
    expect(scoreHidden(final, false, new Set(['2']))).toBe(false)
    expect(scoreHidden(upcoming, false, new Set())).toBe(false)
  })
})

describe('the words', () => {
  it('prints a score with an en dash, and nothing before there is one', () => {
    expect(scoreText(final)).toBe('3 – 1')
    expect(scoreText(upcoming)).toBe('')
    expect(scoreText({ homeScore: 0, awayScore: 0 })).toBe('0 – 0')
  })

  it('prints when and where', () => {
    expect(whenText(upcoming.date, 'en-US')).toMatch(/^Sat, Oct 31,? (at )?8:00\sPM$/)
    expect(whenText(undefined)).toBe('')
    expect(metaText(upcoming, 'en-US')).toMatch(/ · Premier Division$/)
    expect(metaText({ id: '3', title: 'x' })).toBe('')
  })

  it('names each action for a screen reader', () => {
    expect(actionLabel('list', upcoming)).toBe('Choose a channel for Harbour City vs Eastvale Athletic')
    expect(actionLabel('play', upcoming)).toBe('Watch Harbour City vs Eastvale Athletic on the best channel')
    expect(actionLabel('reveal', final)).toBe('Show the score of Harbour City vs Eastvale Athletic')
    expect(actionLabel('none', { id: '4', title: '' })).toBe('this game')
  })

  it('knows when a team has no games', () => {
    expect(hasGames([], [])).toBe(false)
    expect(hasGames([upcoming], [])).toBe(true)
  })
})
