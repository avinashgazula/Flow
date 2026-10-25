import { describe, expect, it } from 'vitest'
import { newQuery } from '../../lib/shelfDefaults'
import type { MediaItem } from '../../lib/tmdb/types'
import { advancesByItself, builtInExplore, discoverParams, exploreLinkFor, heroPicks, interleave } from './shelfQuery'
import { airLabel, airSpoken, buildUpcoming, type UpcomingShow } from './upcoming'

const now = new Date(2026, 9, 24, 20, 0).getTime()

describe('Discover parameters', () => {
  it('names genres, years, rating and language as TMDB does', () => {
    const p = discoverParams({ ...newQuery('movie'), genres: [35, 12], excludedGenres: [27], yearFrom: 2010, yearTo: 2019, minRating: 7, originalLanguage: 'ko' }, 'US', now)
    expect(p).toEqual({ sort_by: 'popularity.desc', with_genres: '35,12', without_genres: '27', 'primary_release_date.gte': '2010-01-01', 'primary_release_date.lte': '2019-12-31', 'vote_average.gte': 7, with_original_language: 'ko' })
  })

  it('counts relative days from today, which beat the years', () => {
    const p = discoverParams({ ...newQuery('movie'), yearFrom: 1990, releasedFromDays: 1, releasedToDays: 30 }, 'US', now)
    expect(p['primary_release_date.gte']).toBe('2026-10-25')
    expect(p['primary_release_date.lte']).toBe('2026-11-23')
  })

  it('uses TV’s own date fields and ordering', () => {
    const p = discoverParams({ ...newQuery('show'), sort: 'primary_release_date.desc', yearFrom: 2020 }, 'US', now)
    expect(p).toMatchObject({ sort_by: 'first_air_date.desc', 'first_air_date.gte': '2020-01-01' })
    expect(discoverParams({ ...newQuery('show'), sort: 'revenue.desc' }, 'US', now).sort_by).toBe('popularity.desc')
  })

  it('wants votes behind a rating sort, unless told how many', () => {
    expect(discoverParams({ ...newQuery(), sort: 'vote_average.desc' }, 'US', now)['vote_count.gte']).toBe(200)
    expect(discoverParams({ ...newQuery(), sort: 'vote_average.desc', minVotes: 50 }, 'US', now)['vote_count.gte']).toBe(50)
  })

  it('matches services in the viewer’s region unless the shelf names one', () => {
    const q = { ...newQuery(), watchProviders: [8, 337] }
    expect(discoverParams(q, 'GB', now)).toMatchObject({ with_watch_providers: '8|337', watch_region: 'GB' })
    expect(discoverParams({ ...q, watchRegion: 'US' }, 'GB', now).watch_region).toBe('US')
  })
})

describe('where See all goes', () => {
  it('opens Explore on what the query can name', () => {
    expect(exploreLinkFor({ ...newQuery('show'), genres: [16, 35], watchProviders: [8, 337], yearFrom: 2020, minRating: 7.5, originalLanguage: 'ja', sort: 'vote_average.desc' })).toEqual({
      type: 'show', genre: 16, providers: '8,337', from: 2020, rating: 7, lang: 'ja', sort: 'top',
    })
    expect(exploreLinkFor({ ...newQuery('movie'), releasedToDays: 180 })).toMatchObject({ window: 'next180' })
  })

  it('has a list for the built-in rows that are one', () => {
    expect(builtInExplore('trendingShows')).toEqual({ type: 'show', sort: 'trending' })
    expect(builtInExplore('topRatedMovies')).toEqual({ type: 'movie', sort: 'top' })
    expect(builtInExplore('watchlist')).toBeUndefined()
  })
})

describe('the lead’s titles', () => {
  const item = (id: number, backdrop = '/b.jpg'): MediaItem => ({ type: 'movie', id, title: `T${id}`, overview: '', genres: [], backdrop: backdrop || undefined })

  it('alternates two lists', () => {
    expect(interleave<number | string>([1, 2, 3], ['a'])).toEqual([1, 'a', 2, 3])
  })

  it('takes the primary source, mixes in the secondary, and keeps each title once', () => {
    const picks = heroPicks([item(1), item(2), item(3)], [item(2), item(9)])
    expect(picks.map((m) => m.id)).toEqual([1, 2, 9, 3])
  })

  it('leaves out titles with no still, and stops at ten', () => {
    expect(heroPicks([item(1, ''), item(2)], undefined).map((m) => m.id)).toEqual([2])
    expect(heroPicks(Array.from({ length: 30 }, (_, i) => item(i + 1)), undefined)).toHaveLength(10)
  })

  it('turns by itself only when nothing is in progress and motion is allowed', () => {
    const on = { setting: true, resuming: false, slides: 5, reducedMotion: false }
    expect(advancesByItself(on)).toBe(true)
    expect(advancesByItself({ ...on, resuming: true })).toBe(false)
    expect(advancesByItself({ ...on, reducedMotion: true })).toBe(false)
    expect(advancesByItself({ ...on, setting: false })).toBe(false)
    expect(advancesByItself({ ...on, slides: 1 })).toBe(false)
  })
})

describe('Upcoming', () => {
  const show = (id: number, airDate: string | undefined, number: number, patch: Partial<UpcomingShow> = {}): UpcomingShow => ({
    item: { type: 'show', id, title: `Show ${id}`, overview: '', genres: [] },
    nextEpisode: airDate ? { id: id * 100 + number, season: 2, number, name: 'Pilot', airDate } : undefined,
    caughtUp: true,
    onWatchlist: false,
    ...patch,
  })
  const opts = { withinDays: 7, includeWatchlistPremieres: false }

  it('lists the next episode of a show the viewer is caught up on, soonest first', () => {
    const list = buildUpcoming([show(1, '2026-10-29', 4), show(2, '2026-10-24', 8), show(3, '2026-10-26', 2)], now, opts)
    expect(list.map((e) => [e.item.id, e.kind])).toEqual([[2, 'episode'], [3, 'episode'], [1, 'episode']])
  })

  it('counts today, even after midnight, and stops at the window', () => {
    const ids = (days: number) => buildUpcoming([show(1, '2026-10-24', 3), show(2, '2026-10-31', 3), show(3, '2026-11-01', 3), show(4, '2026-10-23', 3)], now, { ...opts, withinDays: days }).map((e) => e.item.id)
    expect(ids(7)).toEqual([1, 2])
    expect(ids(3)).toEqual([1])
    expect(ids(14)).toEqual([1, 2, 3])
  })

  it('leaves out a show with something unwatched, unless it is a premiere on the watchlist and those are wanted', () => {
    const behind = show(1, '2026-10-26', 5, { caughtUp: false, onWatchlist: true })
    const premiere = show(2, '2026-10-26', 1, { caughtUp: false, onWatchlist: true })
    const unlisted = show(3, '2026-10-26', 1, { caughtUp: false, onWatchlist: false })
    expect(buildUpcoming([behind, premiere, unlisted], now, opts)).toEqual([])
    expect(buildUpcoming([behind, premiere, unlisted], now, { ...opts, includeWatchlistPremieres: true }).map((e) => [e.item.id, e.kind])).toEqual([[2, 'premiere']])
  })

  it('calls a caught-up show’s first episode of a season a premiere', () => {
    expect(buildUpcoming([show(1, '2026-10-26', 1)], now, opts)[0]!.kind).toBe('premiere')
  })

  it('skips a show with no next episode or no date', () => {
    expect(buildUpcoming([show(1, undefined, 1)], now, opts)).toEqual([])
  })

  it('labels the air day', () => {
    const day = (d: number) => new Date(2026, 9, d).getTime()
    expect(airLabel(day(24), now, 'en-GB')).toBe('Today')
    expect(airLabel(day(25), now, 'en-GB')).toBe('Tomorrow')
    expect(airLabel(day(27), now, 'en-GB')).toBe('Tue 27')
    expect(airSpoken(day(25), now, 'en-GB')).toBe('tomorrow')
    expect(airSpoken(day(27), now, 'en-GB')).toBe('on Tuesday 27 October')
  })
})
