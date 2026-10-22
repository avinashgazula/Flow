import { describe, expect, it } from 'vitest'
import type { SearchResult } from '../../lib/tmdb/types'
import { groupResults, neighbour, pushRecent, topResult, type Box } from './logic'

const media = (id: number, title: string, type: 'movie' | 'show' = 'movie', poster: string | null = '/p.jpg'): SearchResult => ({ kind: 'media', id, type, title, overview: '', genres: [], poster: poster ?? undefined })
const person = (id: number, name: string): SearchResult => ({ kind: 'person', id, name, knownFor: [] })

describe('topResult', () => {
  it('picks the first title when its name starts with the words typed', () => {
    expect(topResult([person(1, 'Dune Fan'), media(2, 'Dune: Part Two'), media(3, 'Dune')], 'dune')?.id).toBe(2)
  })

  it('accepts a match at the start of a later word', () => {
    expect(topResult([media(2, 'The Dark Knight')], 'dark')?.id).toBe(2)
  })

  it('says nothing for short or unconfident matches, or titles without a poster', () => {
    expect(topResult([media(2, 'Dune')], 'du')).toBeUndefined()
    expect(topResult([media(2, 'Paradune')], 'dune')).toBeUndefined()
    expect(topResult([media(2, 'Dune', 'movie', null)], 'dune')).toBeUndefined()
    expect(topResult([person(1, 'Dune')], 'dune')).toBeUndefined()
  })
})

describe('groupResults', () => {
  it('splits movies, shows and people, leaving out the top result', () => {
    const results = [media(1, 'A'), media(2, 'B', 'show'), person(3, 'C'), media(4, 'D'), media(1, 'Same id, a show', 'show')]
    const top = results[0] as Extract<SearchResult, { kind: 'media' }>
    const g = groupResults(results, top)
    expect(g.movies.map((m) => m.id)).toEqual([4])
    expect(g.shows.map((m) => m.id)).toEqual([2, 1])
    expect(g.people.map((p) => p.id)).toEqual([3])
  })
})

describe('neighbour', () => {
  // Two rows of three posters, then one wide item.
  const cell = (col: number, row: number): Box => ({ left: col * 100, right: col * 100 + 90, top: row * 200, bottom: row * 200 + 180 })
  const boxes = [cell(0, 0), cell(1, 0), cell(2, 0), cell(0, 1), cell(1, 1), cell(2, 1), { left: 0, right: 290, top: 400, bottom: 460 }]

  it('walks along a row and stops at its ends', () => {
    expect(neighbour(boxes, 0, 'right')).toBe(1)
    expect(neighbour(boxes, 1, 'left')).toBe(0)
    expect(neighbour(boxes, 2, 'right')).toBeUndefined()
    expect(neighbour(boxes, 0, 'left')).toBeUndefined()
  })

  it('goes to the nearest row and column when moving up or down', () => {
    expect(neighbour(boxes, 1, 'down')).toBe(4)
    expect(neighbour(boxes, 5, 'up')).toBe(2)
    expect(neighbour(boxes, 4, 'down')).toBe(6)
    expect(neighbour(boxes, 0, 'up')).toBeUndefined()
  })
})

describe('pushRecent', () => {
  it('puts the newest first, once, ignoring case', () => {
    expect(pushRecent(['dune', 'Barbie'], 'barbie')).toEqual(['barbie', 'dune'])
  })
  it('trims, ignores one-letter searches and keeps ten', () => {
    expect(pushRecent([], '  arcane ')).toEqual(['arcane'])
    expect(pushRecent(['x1'], 'a')).toEqual(['x1'])
    const many = Array.from({ length: 10 }, (_, i) => `term ${i}`)
    expect(pushRecent(many, 'new one')).toHaveLength(10)
    expect(pushRecent(many, 'new one')[0]).toBe('new one')
  })
})
