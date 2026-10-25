import { describe, expect, it } from 'vitest'
import type { MediaItem } from '../../lib/tmdb/types'
import { alertDue, pickSuggestions, suggestionsMoment, suggestionsStart } from './filmExtras'

const film = (id: number, backdrop = '/b.jpg', type: MediaItem['type'] = 'movie'): MediaItem => ({ type, id, title: `Film ${id}`, overview: '', backdrop, genres: [] })

describe('the credits scene note', () => {
  const hours = 2 * 3600
  it('comes as the credits begin, from a segment or else the last six percent', () => {
    expect(alertDue({ time: 6800, duration: hours, creditsStart: 6900 })).toBe(false)
    expect(alertDue({ time: 6900, duration: hours, creditsStart: 6900 })).toBe(true)
    expect(alertDue({ time: 6767, duration: hours })).toBe(false)
    expect(alertDue({ time: 6769, duration: hours })).toBe(true)
  })

  it('stops for the last ten seconds, and never comes for something short', () => {
    expect(alertDue({ time: hours - 9, duration: hours, creditsStart: 6900 })).toBe(false)
    expect(alertDue({ time: 1700, duration: 1750, creditsStart: 1600 })).toBe(false)
    expect(alertDue({ time: 30, duration: 48, creditsStart: 30, minLength: 0 })).toBe(true)
  })
})

describe('Because You Watched comes up', () => {
  const hours = 2 * 3600
  it('with the credits when a segment says where, else in the last three minutes', () => {
    expect(suggestionsStart(hours, 6900)).toBe(6900)
    expect(suggestionsStart(hours)).toBe(hours - 180)
    // The later of the two, so a very long film still gets its credits to itself.
    expect(suggestionsStart(hours * 2)).toBe(hours * 2 - 180)
    expect(suggestionsStart(1900)).toBeCloseTo(1824)
  })

  it('once, in the credits, and not in the last five seconds', () => {
    expect(suggestionsMoment({ time: 6000, duration: hours, creditsStart: 6900 })).toBe('before')
    expect(suggestionsMoment({ time: 6950, duration: hours, creditsStart: 6900 })).toBe('due')
    expect(suggestionsMoment({ time: hours - 4, duration: hours, creditsStart: 6900 })).toBe('late')
    expect(suggestionsMoment({ time: hours - 100, duration: 1000, creditsStart: 900 })).toBe('before')
  })
})

describe('what is suggested', () => {
  const none = () => false
  it('is its recommendations then films like it, no repeats and not the film itself', () => {
    const picked = pickSuggestions({ id: 1, recommendations: [film(2), film(3), film(1)], similar: [film(3), film(4)] }, none)
    expect(picked.map((m) => m.id)).toEqual([2, 3, 4])
  })

  it('leaves out what was watched, what has no picture and anything that is not a film', () => {
    const picked = pickSuggestions({ id: 1, recommendations: [film(2), film(3, ''), film(4, '/b.jpg', 'show'), film(5)], similar: [] }, (m) => m.id === 2)
    expect(picked.map((m) => m.id)).toEqual([5])
  })

  it('stops at eight', () => {
    const many = Array.from({ length: 20 }, (_, i) => film(100 + i))
    expect(pickSuggestions({ id: 1, recommendations: many, similar: [] }, none)).toHaveLength(8)
  })
})
