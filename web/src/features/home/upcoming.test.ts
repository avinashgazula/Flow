import { describe, expect, it } from 'vitest'
import { movieReleases } from '../../lib/tmdb/detail'
import type { MediaItem, MovieRelease } from '../../lib/tmdb/types'
import { buildUpcoming, filmCandidates, filmDate, type UpcomingFilm } from './upcoming'

const now = new Date(2026, 9, 25, 22, 30).getTime()
const film = (id: number, releases: MovieRelease[], extra: Partial<MediaItem> = {}): UpcomingFilm => ({
  item: { type: 'movie', id, title: `Film ${id}`, overview: '', genres: [], ...extra },
  releases,
})
const r = (country: string, type: number, date: string): MovieRelease => ({ country, type, date })

describe('the day a film counts as out', () => {
  const f = film(1, [r('US', 3, '2026-10-30'), r('GB', 3, '2026-10-28'), r('US', 4, '2026-12-15'), r('GB', 4, '2026-12-20'), r('US', 5, '2027-01-05')])

  it('is the digital release, or the theatrical one, in the viewer’s own country first', () => {
    expect(filmDate(f, 'digital', 'US')).toBe('2026-12-15')
    expect(filmDate(f, 'digital', 'GB')).toBe('2026-12-20')
    expect(filmDate(f, 'theatrical', 'US')).toBe('2026-10-30')
    expect(filmDate(f, 'theatrical', 'GB')).toBe('2026-10-28')
  })

  it('is the earliest anywhere when the viewer’s country has none', () => {
    expect(filmDate(f, 'digital', 'JP')).toBe('2026-12-15')
    expect(filmDate(f, 'theatrical', undefined)).toBe('2026-10-28')
  })

  it('counts a limited release as theatrical, and ignores premieres, discs and television', () => {
    expect(filmDate(film(1, [r('US', 2, '2026-11-01'), r('US', 1, '2026-10-01'), r('US', 5, '2026-09-01'), r('US', 6, '2026-08-01')]), 'theatrical', 'US')).toBe('2026-11-01')
    expect(filmDate(film(1, [r('US', 5, '2026-09-01')]), 'digital', 'US')).toBeUndefined()
  })

  it('falls back to the film’s own date for a theatrical release only', () => {
    const bare = film(2, [], { date: '2026-11-13' })
    expect(filmDate(bare, 'theatrical', 'US')).toBe('2026-11-13')
    expect(filmDate(bare, 'digital', 'US')).toBeUndefined()
  })
})

describe('Upcoming with films', () => {
  const opts = { withinDays: 14, includeWatchlistPremieres: true, filmDates: 'digital' as const, region: 'US' }
  const films = [film(1, [r('US', 4, '2026-11-02')]), film(2, [r('US', 4, '2026-10-20')]), film(3, [r('US', 4, '2026-12-01')]), film(4, [r('US', 4, '2026-10-25')])]

  it('lists the films coming out inside the window, with the show entries, soonest first', () => {
    const list = buildUpcoming([], now, opts, films)
    expect(list.map((e) => [e.item.id, e.kind, e.release])).toEqual([[4, 'film', 'digital'], [1, 'film', 'digital']])
    expect(list[0]).toMatchObject({ id: 'movie:4', date: new Date(2026, 9, 25).getTime() })
  })

  it('shows films only when watchlist premieres are wanted, as the apps do', () => {
    expect(buildUpcoming([], now, { ...opts, includeWatchlistPremieres: false }, films)).toEqual([])
  })

  it('dates them by the setting, and by digital when none is given', () => {
    const both = film(5, [r('US', 3, '2026-10-28'), r('US', 4, '2026-11-04')])
    expect(buildUpcoming([], now, { ...opts, filmDates: 'theatrical' }, [both])[0]).toMatchObject({ release: 'theatrical', date: new Date(2026, 9, 28).getTime() })
    expect(buildUpcoming([], now, { ...opts, filmDates: undefined }, [both])[0]).toMatchObject({ release: 'digital', date: new Date(2026, 10, 4).getTime() })
  })

  it('lists a film once', () => {
    expect(buildUpcoming([], now, opts, [films[0]!, films[0]!])).toHaveLength(1)
  })
})

describe('which watchlisted films are asked about', () => {
  const entry = (item: MediaItem) => ({ item })
  const movie = (id: number, date?: string): MediaItem => ({ type: 'movie', id, title: `F${id}`, overview: '', genres: [], date })
  it('skips shows and films long out or too far ahead, keeps the undated, and caps the list', () => {
    const show: MediaItem = { type: 'show', id: 9, title: 'S', overview: '', genres: [] }
    const list = filmCandidates([entry(show), entry(movie(1, '2019-06-15')), entry(movie(2, '2026-09-01')), entry(movie(3)), entry(movie(4, '2026-12-10')), entry(movie(5, '2028-01-01'))], now, 10)
    expect(list.map((i) => i.id)).toEqual([2, 3, 4])
    expect(filmCandidates([entry(movie(2)), entry(movie(3)), entry(movie(4))], now, 2).map((i) => i.id)).toEqual([2, 3])
  })
})

describe('a film’s release dates from TMDB', () => {
  it('keeps each country’s dates as calendar days and drops what it cannot use', () => {
    const raw = {
      release_dates: {
        results: [
          { iso_3166_1: 'US', release_dates: [{ type: 3, release_date: '2026-10-30T00:00:00.000Z', certification: 'PG' }, { type: 4, release_date: '2026-12-15T00:00:00.000Z' }, { type: 5, release_date: '' }] },
          { iso_3166_1: 'GB', release_dates: [{ type: 3, release_date: '2026-10-28T00:00:00.000Z' }, { type: 'x', release_date: '2026-10-28' }] },
        ],
      },
    }
    expect(movieReleases(raw)).toEqual([r('US', 3, '2026-10-30'), r('US', 4, '2026-12-15'), r('GB', 3, '2026-10-28')])
    expect(movieReleases({})).toEqual([])
  })
})
