import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { computeStats, defaultEpisodeMinutes, defaultFilmMinutes, durationText, type StatsPeriod } from './stats'
import type { HistoryEntry } from './store/library'
import type { MediaItem } from './tmdb/types'

/* The apps' WatchStatsTests, case for case. Days are local days; Saturday 10 October 2026, midday, is "now", and weeks
   start on Monday, as the apps' tests set them. */

const now = new Date(2026, 9, 10, 12).getTime()
const at = (day: string, hour = 20) => {
  const [y, m, d] = day.split('-').map(Number)
  return new Date(y!, m! - 1, d!, hour).getTime()
}
const movie = (id: number, genres: number[] = []): MediaItem => ({ type: 'movie', id, title: `Film ${id}`, overview: '', genres })
const show = (id: number, genres: number[] = []): MediaItem => ({ type: 'show', id, title: `Show ${id}`, overview: '', genres })
const watched = (item: MediaItem, day: string, episode?: [number, number], hour = 20, runtime?: number): HistoryEntry => ({
  key: `${item.type}:${item.id}`,
  item,
  episode: episode && { season: episode[0], episode: episode[1] },
  watchedAt: at(day, hour),
  ...(runtime !== undefined ? { runtime } : {}),
})
const stats = (period: StatsPeriod, entries: HistoryEntry[], runtimes: Record<string, number> = {}) => computeStats(period, entries, { now, weekStart: 1, runtimeOf: (key) => runtimes[key] })

describe('an empty history', () => {
  it('has nothing to report', () => {
    const s = stats('allTime', [])
    expect(s.isEmpty).toBe(true)
    expect(s.totalMinutes).toBe(0)
    expect(s.longestStreak).toBe(0)
    expect(s.busiestWeekday).toBeUndefined()
    expect(s.histogram).toEqual([])
  })
})

describe('counts and watch time', () => {
  it('adds up the known runtimes', () => {
    const dune = movie(1)
    const bear = show(2)
    const s = stats('thisYear', [watched(dune, '2026-03-01'), watched(bear, '2026-03-02', [1, 1]), watched(bear, '2026-03-02', [1, 2]), watched(bear, '2026-03-03', [1, 3])], { 'movie:1': 155, 'show:2': 30 })
    expect(s.filmsWatched).toBe(1)
    expect(s.episodesWatched).toBe(3)
    expect(s.showsWatched).toBe(1)
    expect(s.totalMinutes).toBe(155 + 3 * 30)
    expect(s.isEmpty).toBe(false)
  })

  it('falls back to a default for a runtime nobody knows, and a zero one is unknown too', () => {
    const s = stats('allTime', [watched(movie(1), '2026-05-01'), watched(show(2), '2026-05-02', [1, 1]), watched(movie(3), '2026-05-03')], { 'movie:3': 0 })
    expect(s.totalMinutes).toBe(defaultFilmMinutes + defaultEpisodeMinutes + defaultFilmMinutes)
  })

  it('takes the length a play recorded over its title’s typical runtime', () => {
    const bear = show(2)
    const s = stats('allTime', [watched(bear, '2026-05-02', [1, 1], 20, 62), watched(bear, '2026-05-03', [1, 2])], { 'show:2': 30 })
    expect(s.totalMinutes).toBe(62 + 30)
  })

  it('counts the same episode twice on one day once, and a rewatch on another day again', () => {
    const bear = show(2)
    const s = stats('allTime', [watched(bear, '2026-04-01', [1, 1], 9), watched(bear, '2026-04-01', [1, 1], 22), watched(bear, '2026-04-08', [1, 1])], { 'show:2': 30 })
    expect(s.episodesWatched).toBe(2)
    expect(s.totalMinutes).toBe(60)
    expect(s.mostWatchedShows).toEqual([{ key: 'show:2', episodes: 2 }])
  })
})

describe('periods', () => {
  it('keeps this year, the last 30 days (today and the 29 before) and everything, and ignores the future', () => {
    const bear = show(2)
    const entries = [
      watched(bear, '2025-12-31', [1, 1]),
      watched(bear, '2026-01-01', [1, 2]),
      watched(bear, '2026-09-10', [1, 3]), // 30 days back: just outside
      watched(bear, '2026-09-11', [1, 4]), // 29 days back: the first day inside
      watched(bear, '2026-10-10', [1, 5], 23),
      watched(bear, '2026-10-12', [1, 6]), // in the future
    ]
    expect(stats('allTime', entries).episodesWatched).toBe(5)
    expect(stats('thisYear', entries).episodesWatched).toBe(4)
    expect(stats('last30Days', entries).episodesWatched).toBe(2)
  })
})

describe('streaks', () => {
  const bear = show(2)
  const run = (days: string[]) => days.map((d, i) => watched(bear, d, [1, i + 1]))

  it('runs across month and year boundaries', () => {
    const s = stats('thisYear', run(['2026-01-30', '2026-01-31', '2026-02-01', '2026-02-02', '2026-02-10', '2026-02-11']))
    expect(s.longestStreak).toBe(4)
    expect(s.longestStreakStart).toBe(at('2026-01-30', 0))
    expect(s.longestStreakEnd).toBe(at('2026-02-02', 0))
    expect(stats('allTime', run(['2025-12-30', '2025-12-31', '2026-01-01'])).longestStreak).toBe(3)
  })

  it('counts several watches in one day as one day', () => {
    const s = stats('allTime', [watched(bear, '2026-06-01', [1, 1], 8), watched(bear, '2026-06-01', [1, 2], 20), watched(bear, '2026-06-03', [1, 3])])
    expect(s.longestStreak).toBe(1)
  })

  describe('across a daylight-saving change', () => {
    const before = process.env.TZ
    beforeAll(() => {
      // New York changed its clocks on 2026-03-08: a 23-hour day between two evenings.
      process.env.TZ = 'America/New_York'
    })
    afterAll(() => {
      if (before === undefined) delete process.env.TZ
      else process.env.TZ = before
    })
    it('still counts three days in a row', () => {
      const s = computeStats('allTime', ['2026-03-07', '2026-03-08', '2026-03-09'].map((d, i) => watched(bear, d, [1, i + 1], 22)), { now, weekStart: 1 })
      expect(s.longestStreak).toBe(3)
    })
  })
})

describe('genres and shows', () => {
  it('ranks genres by watch time, counting a multi-genre title towards each, and the shares sum to one', () => {
    // TMDB ids: 18 Drama, 80 Crime, 35 Comedy.
    const drama = movie(1, [18, 80])
    const comedy = show(2, [35])
    const s = stats('allTime', [watched(drama, '2026-02-01'), watched(comedy, '2026-02-02', [1, 1]), watched(comedy, '2026-02-03', [1, 2])], { 'movie:1': 120, 'show:2': 30 })
    expect(s.topGenres.map((g) => g.name)).toEqual(['Crime', 'Drama', 'Comedy'])
    expect(s.topGenres.map((g) => g.minutes)).toEqual([120, 120, 60])
    expect(s.topGenres[0]!.share).toBeCloseTo(0.4, 4)
    expect(s.topGenres[2]!.share).toBeCloseTo(0.2, 4)
    expect(s.topGenres.reduce((n, g) => n + g.share, 0)).toBeCloseTo(1, 4)
  })

  it('keeps the top five genres and shows', () => {
    const genreIds = [28, 12, 16, 35, 80, 99, 18]
    const shows = genreIds.map((g, i) => show(i + 1, [g]))
    // Show n is watched n times (distinct episodes).
    const entries = shows.flatMap((item) => Array.from({ length: item.id }, (_, e) => watched(item, '2026-07-01', [1, e + 1])))
    const s = stats('allTime', entries, Object.fromEntries(shows.map((x) => [`show:${x.id}`, 30])))
    expect(s.topGenres).toHaveLength(5)
    expect(s.topGenres[0]!.name).toBe('Drama')
    expect(s.mostWatchedShows.map((x) => x.episodes)).toEqual([7, 6, 5, 4, 3])
    expect(s.mostWatchedShows[0]!.key).toBe('show:7')
    expect(s.showsWatched).toBe(7)
  })

  it('breaks a tie between shows by who was watched last', () => {
    const a = show(1)
    const b = show(2)
    const s = stats('allTime', [watched(a, '2026-07-01', [1, 1]), watched(b, '2026-07-02', [1, 1])])
    expect(s.mostWatchedShows.map((x) => x.key)).toEqual(['show:2', 'show:1'])
  })
})

describe('the busiest weekday', () => {
  it('is by watch time, not by how many plays', () => {
    const bear = show(2)
    const long = movie(3)
    const s = stats('allTime', [watched(bear, '2026-10-05', [1, 1]), watched(bear, '2026-10-05', [1, 2]), watched(bear, '2026-10-05', [1, 3]), watched(long, '2026-10-09')], { 'show:2': 30, 'movie:3': 180 })
    expect(s.busiestWeekday).toBe(5) // Friday: 180 minutes against Monday's 90
  })

  it('goes to the earlier weekday in a tie', () => {
    const bear = show(2)
    const s = stats('allTime', [watched(bear, '2026-10-06', [1, 1]), watched(bear, '2026-10-08', [1, 2])], { 'show:2': 30 })
    expect(s.busiestWeekday).toBe(2) // Tuesday before Thursday
  })
})

describe('the histogram', () => {
  const bear = show(2)
  const runtimes = { 'show:2': 30 }

  it('has twelve months for a year and marks the current one', () => {
    const s = stats('thisYear', [watched(bear, '2026-01-15', [1, 1]), watched(bear, '2026-01-16', [1, 2]), watched(bear, '2026-10-02', [1, 3])], runtimes)
    expect(s.histogramGranularity).toBe('month')
    expect(s.histogram).toHaveLength(12)
    expect(s.histogram[0]!.minutes).toBe(60)
    expect(s.histogram[9]!.minutes).toBe(30)
    expect(s.histogram[9]!.isCurrent).toBe(true)
    expect(s.histogram.filter((b) => b.isCurrent)).toHaveLength(1)
    expect(s.histogram.reduce((n, b) => n + b.minutes, 0)).toBe(s.totalMinutes)
  })

  it('is weekly for thirty days, starting on the week’s first day', () => {
    const s = stats('last30Days', [watched(bear, '2026-09-14', [1, 1]), watched(bear, '2026-09-20', [1, 2]), watched(bear, '2026-10-10', [1, 3])], runtimes)
    expect(s.histogramGranularity).toBe('week')
    expect(s.histogram[0]!.start).toBe(at('2026-09-07', 0))
    expect(s.histogram).toHaveLength(5)
    expect(s.histogram.find((b) => b.start === at('2026-09-14', 0))!.minutes).toBe(60)
    expect(s.histogram.at(-1)!.minutes).toBe(30)
    expect(s.histogram.at(-1)!.isCurrent).toBe(true)
    // Sunday-first weeks start a day earlier.
    expect(computeStats('last30Days', [watched(bear, '2026-09-14', [1, 1])], { now, weekStart: 0, runtimeOf: () => 30 }).histogram[0]!.start).toBe(at('2026-09-06', 0))
  })

  it('switches to years past two years of history', () => {
    const recent = stats('allTime', [watched(bear, '2026-05-01', [1, 1])], runtimes)
    expect(recent.histogramGranularity).toBe('month')
    expect(recent.histogram).toHaveLength(6)
    const old = stats('allTime', [watched(bear, '2022-05-01', [1, 1]), watched(bear, '2026-05-01', [1, 2])], runtimes)
    expect(old.histogramGranularity).toBe('year')
    expect(old.histogram).toHaveLength(5)
    expect(old.histogram.map((b) => b.minutes)).toEqual([30, 0, 0, 0, 30])
  })
})

describe('the hero line', () => {
  it('speaks in minutes, hours, or days and hours', () => {
    expect(durationText(1)).toBe('1 minute')
    expect(durationText(45)).toBe('45 minutes')
    expect(durationText(61)).toBe('1 hour')
    expect(durationText(30 * 60)).toBe('30 hours')
    expect(durationText((3 * 24 + 4) * 60 + 20)).toBe('3 days 4 hours')
    expect(durationText(48 * 60)).toBe('2 days')
  })
})
