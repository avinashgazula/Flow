import { describe, expect, it } from 'vitest'
import type { MediaItem } from '../../lib/tmdb/types'
import { age, filmography, formatDay, lifeLine } from './logic'

describe('age', () => {
  it('turns over on the birthday itself', () => {
    expect(age('1985-04-12', new Date(2026, 3, 11, 23, 59))).toBe(40)
    expect(age('1985-04-12', new Date(2026, 3, 12, 0, 1))).toBe(41)
  })
  it('handles leap-day birthdays and bad dates', () => {
    expect(age('2000-02-29', new Date(2026, 1, 28))).toBe(25)
    expect(age('2000-02-29', new Date(2026, 2, 1))).toBe(26)
    expect(age('unknown')).toBeUndefined()
  })
})

describe('lifeLine', () => {
  it('reads the birthday as the day TMDB gave, in every time zone', () => {
    expect(formatDay('1985-04-12', 'en-US')).toBe('April 12, 1985')
  })
  it('joins birth, age and place', () => {
    expect(lifeLine({ birthday: '1985-04-12', placeOfBirth: 'Los Angeles, California' }, new Date(2026, 9, 18), 'en-US')).toBe('Born April 12, 1985 (age 41) · Los Angeles, California')
    expect(lifeLine({ placeOfBirth: 'Cork' })).toBe('Cork')
    expect(lifeLine({})).toBeUndefined()
  })
})

describe('filmography', () => {
  const m = (id: number, type: 'movie' | 'show', date?: string): MediaItem => ({ id, type, title: String(id), overview: '', genres: [], date, year: date ? Number(date.slice(0, 4)) : undefined })
  const credits = [m(1, 'movie', '2010-07-16'), m(2, 'show', '2023-01-15'), m(3, 'movie'), m(4, 'movie', '2024-02-27')]

  it('keeps the ranked order for Popular', () => {
    expect(filmography(credits, undefined, 'popular').map((c) => c.id)).toEqual([1, 2, 3, 4])
  })
  it('sorts Newest by date, undated last', () => {
    expect(filmography(credits, undefined, 'year').map((c) => c.id)).toEqual([4, 2, 1, 3])
  })
  it('filters by type', () => {
    expect(filmography(credits, 'movie', 'year').map((c) => c.id)).toEqual([4, 1, 3])
    expect(filmography(credits, 'show', 'popular').map((c) => c.id)).toEqual([2])
  })
})
