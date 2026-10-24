import { describe, expect, it } from 'vitest'
import type { MediaItem } from '../../lib/tmdb/types'
import { estimateContentWidth, gridLayout, rowCount, shouldLoadMore } from './gridLayout'
import { exploreSource, orderGenres, parseSort, uniqueItems } from './source'

describe('gridLayout', () => {
  it('puts three posters across a phone', () => {
    const l = gridLayout(358)
    expect(l.columns).toBe(3)
    expect(l.gap).toBe(12)
    expect(l.cellWidth).toBeCloseTo((358 - 24) / 3)
  })

  it('never drops below three columns on the narrowest phones', () => {
    expect(gridLayout(288).columns).toBe(3)
  })

  it('fits as many ~170-point posters as a desktop window allows', () => {
    const l = gridLayout(1328)
    expect(l.columns).toBe(7)
    expect(l.cellWidth).toBeGreaterThanOrEqual(164)
    expect(l.cellWidth * l.columns + l.gap * (l.columns - 1)).toBeCloseTo(1328)
  })

  it('gives rows a fixed height: a 2:3 poster, its caption and the gap below', () => {
    const l = gridLayout(1328)
    expect(l.rowHeight).toBe(Math.round(l.cellWidth * 1.5 + 72 + 24))
    expect(gridLayout(1328, { caption: false }).rowHeight).toBe(Math.round(l.cellWidth * 1.5 + 24))
  })

  it('counts rows, rounding a partial last row up', () => {
    expect(rowCount(0, 7)).toBe(0)
    expect(rowCount(14, 7)).toBe(2)
    expect(rowCount(15, 7)).toBe(3)
    expect(rowCount(5, 0)).toBe(0)
  })

  it('estimates the content width from the window, as the page gutters do', () => {
    expect(estimateContentWidth(390)).toBe(358)
    expect(estimateContentWidth(1440)).toBe(1328)
    expect(estimateContentWidth(2560)).toBe(1800 - 112)
  })
})

describe('shouldLoadMore', () => {
  it('asks for the next page while the end is still two screens away', () => {
    expect(shouldLoadMore({ lastRow: 3, rows: 20, rowsPerScreen: 3 })).toBe(false)
    expect(shouldLoadMore({ lastRow: 13, rows: 20, rowsPerScreen: 3 })).toBe(true)
    expect(shouldLoadMore({ lastRow: 12, rows: 20, rowsPerScreen: 3 })).toBe(false)
  })

  it('asks straight away when nothing has loaded', () => {
    expect(shouldLoadMore({ lastRow: -1, rows: 0, rowsPerScreen: 3 })).toBe(true)
  })
})

describe('exploreSource', () => {
  const today = '2026-10-18'
  it('maps the plain sorts to trending and TMDB’s fixed lists', () => {
    expect(exploreSource('movie', 'trending', undefined, undefined, { today })).toEqual({ kind: 'list', list: 'trending' })
    expect(exploreSource('show', 'popular', undefined, undefined, { today })).toEqual({ kind: 'list', list: 'popular' })
    expect(exploreSource('movie', 'top', undefined, undefined, { today })).toEqual({ kind: 'list', list: 'top_rated' })
  })

  it('sends a genre through Discover, since the lists can’t filter', () => {
    expect(exploreSource('movie', 'trending', 878, undefined, { today })).toEqual({ kind: 'discover', params: { with_genres: 878, sort_by: 'popularity.desc' } })
    expect(exploreSource('show', 'top', 35, undefined, { today })).toEqual({ kind: 'discover', params: { with_genres: 35, sort_by: 'vote_average.desc', 'vote_count.gte': 300 } })
  })

  it('sorts Newest by the type’s own date field, released titles only', () => {
    expect(exploreSource('movie', 'new', undefined, undefined, { today }).kind).toBe('discover')
    expect(exploreSource('movie', 'new', undefined, undefined, { today })).toMatchObject({ params: { sort_by: 'primary_release_date.desc', 'primary_release_date.lte': today } })
    expect(exploreSource('show', 'new', 18, undefined, { today })).toMatchObject({ params: { with_genres: 18, sort_by: 'first_air_date.desc', 'first_air_date.lte': today } })
  })

  it('reads unknown sorts as trending', () => {
    expect(parseSort('top')).toBe('top')
    expect(parseSort('bogus')).toBe('trending')
    expect(parseSort(undefined)).toBe('trending')
  })
})

describe('uniqueItems', () => {
  const m = (id: number, type: 'movie' | 'show' = 'movie'): MediaItem => ({ id, type, title: String(id), overview: '', genres: [] })
  it('keeps each title once, where it first appeared', () => {
    const items = uniqueItems([{ results: [m(1), m(2)] }, { results: [m(2), m(3), m(1, 'show')] }])
    expect(items.map((i) => `${i.type}${i.id}`)).toEqual(['movie1', 'movie2', 'movie3', 'show1'])
  })
  it('is empty before the first page', () => {
    expect(uniqueItems(undefined)).toEqual([])
  })
})

describe('orderGenres', () => {
  it('puts the most-browsed genres first, then the rest by name', () => {
    const ordered = orderGenres(
      [
        { id: 37, name: 'Western' },
        { id: 99, name: 'Documentary' },
        { id: 28, name: 'Action' },
        { id: 36, name: 'History' },
        { id: 35, name: 'Comedy' },
      ],
      'movie',
    )
    expect(ordered.map((g) => g.name)).toEqual(['Action', 'Comedy', 'Documentary', 'History', 'Western'])
  })
})
