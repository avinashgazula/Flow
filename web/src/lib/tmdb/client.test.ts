import { describe, expect, it } from 'vitest'
import { item } from './client'
import { srcSet, imageURL } from './images'
import { demoTmdb } from './demo'

describe('TMDB normalising', () => {
  it('reads a film from a trending result', () => {
    const m = item({ id: 693134, media_type: 'movie', title: 'Dune: Part Two', release_date: '2024-02-27', vote_average: 8.234, genre_ids: [878, 12], poster_path: '/p.jpg', overview: 'x' })
    expect(m).toMatchObject({ type: 'movie', id: 693134, title: 'Dune: Part Two', year: 2024, rating: 8.2, genres: [878, 12], poster: '/p.jpg' })
  })

  it('reads a show and leaves out people', () => {
    expect(item({ id: 1396, media_type: 'tv', name: 'Breaking Bad', first_air_date: '2008-01-20' })).toMatchObject({ type: 'show', year: 2008, title: 'Breaking Bad' })
    expect(item({ id: 17419, media_type: 'person', name: 'Bryan Cranston' })).toBeUndefined()
  })

  it('takes the list’s type when the result has none', () => {
    expect(item({ id: 1, name: 'A Show' }, 'show')?.type).toBe('show')
    expect(item({ id: 2, title: 'A Film' })?.type).toBe('movie')
  })

  it('treats a missing date as no year', () => {
    expect(item({ id: 3, title: 'Untitled', release_date: '' })?.year).toBeUndefined()
  })
})

describe('Images', () => {
  it('offers every poster width and passes full URLs through', () => {
    expect(srcSet('/a.jpg', 'poster')).toContain('https://image.tmdb.org/t/p/w342/a.jpg 342w')
    expect(srcSet('/a.jpg', 'backdrop')).toContain('original/a.jpg 1920w')
    expect(imageURL('https://example.com/x.png', 300)).toBe('https://example.com/x.png')
    expect(imageURL(undefined, 300)).toBeUndefined()
  })
})

describe('Sample data', () => {
  it('answers the catalogue requests Home and title pages make', async () => {
    const trending: any = await demoTmdb('/trending/all/day', { page: 1 })
    expect(trending.results.length).toBe(20)
    const detail: any = await demoTmdb('/tv/1396', {})
    expect(detail.seasons).toHaveLength(5)
    const season: any = await demoTmdb('/tv/1396/season/3', {})
    expect(season.episodes.length).toBeGreaterThan(7)
    const search: any = await demoTmdb('/search/multi', { query: 'dune' })
    expect(search.results.map((r: any) => r.title)).toContain('Dune: Part Two')
  })
})
