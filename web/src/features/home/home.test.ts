import { describe, expect, it } from 'vitest'
import type { Progress } from '../../lib/store/library'
import type { MediaItem } from '../../lib/tmdb/types'
import { episodeLine, firstWithStill, inProgress, pickMeta, pickWhen, secondsLeft, spokenPick, spokenResume, versionLine } from './logic'

const item = (over: Partial<MediaItem> = {}): MediaItem => ({ type: 'movie', id: 1, title: 'Dune: Part Two', overview: '', genres: [878, 12], year: 2024, rating: 8.24, ...over })
const entry = (key: string, updatedAt: number, over: Partial<Progress> = {}): Progress => ({ key, item: item(), position: 1750, duration: 2820, updatedAt, ...over })

describe('Carry On', () => {
  it('orders in-progress titles by most recent, and drops ones with no length', () => {
    const list = inProgress({ a: entry('a', 10), b: entry('b', 30), c: entry('c', 20), d: entry('d', 40, { duration: 0 }) })
    expect(list.map((p) => p.key)).toEqual(['b', 'c', 'a'])
  })

  it('counts what is left, never below zero', () => {
    expect(secondsLeft({ position: 1750, duration: 2820 })).toBe(1070)
    expect(secondsLeft({ position: 3000, duration: 2820 })).toBe(0)
  })

  it('names an episode, and nothing for a film', () => {
    expect(episodeLine({ season: 3, episode: 7, name: 'Fly' })).toBe('S3 E7 · Fly')
    expect(episodeLine({ season: 3, episode: 7 })).toBe('S3 E7')
    expect(episodeLine()).toBeUndefined()
  })
})

describe('version line', () => {
  it('reads resolution, picture and release in order, as plain text', () => {
    expect(versionLine({ resolution: '2160p', hdr: ['DV', 'HDR10'], quality: 'REMUX' })).toBe('2160p · Dolby Vision · REMUX')
    expect(versionLine({ resolution: '1080p', quality: 'WEB-DL' })).toBe('1080p · WEB-DL')
  })

  it('says nothing when nothing is known', () => {
    expect(versionLine()).toBeUndefined()
    expect(versionLine({})).toBeUndefined()
  })
})

describe('words for picks and screen readers', () => {
  it('gives a pick its plain facts', () => {
    expect(pickMeta(item())).toBe('Film · 2024 · Science Fiction, Adventure · 8.2 TMDB')
    expect(pickMeta(item({ type: 'show', genres: [18], year: undefined }))).toBe('Series · Drama · 8.2 TMDB')
  })

  it('reads a resume row naturally, with the end time in the locale', () => {
    const now = new Date(2026, 9, 22, 21, 30).getTime()
    const p = entry('a', 1, { item: item({ title: 'Breaking Bad', type: 'show' }), episode: { season: 3, episode: 7 }, position: 1740, duration: 2820 })
    expect(spokenResume(p, now, 'en-US')).toBe('Breaking Bad, season 3 episode 7, 18 minutes left, ends 9:48 PM')
    expect(spokenResume(entry('b', 1, { position: 0, duration: 2 * 3600 }), now, 'en-GB')).toBe('Dune: Part Two, 2 hours left, ends 23:30')
  })

  it('reads a pick with its rating', () => {
    expect(spokenPick(item())).toBe('Dune: Part Two, film, 2024, rated 8.2 on TMDB')
    expect(spokenPick(item({ rating: undefined, type: 'show' }))).toBe('Dune: Part Two, series, 2024')
  })

  it('finds the first title with a still', () => {
    expect(firstWithStill([item({ id: 1 }), item({ id: 2, backdrop: '/a.jpg' })])?.id).toBe(2)
    expect(firstWithStill(undefined)).toBeUndefined()
  })
})

describe('the time column of a pick', () => {
  const now = new Date(2026, 9, 22, 21, 30).getTime()
  const seasons = [{ number: 0, name: 'Specials', episodeCount: 3 }, { number: 1, name: 'S1', episodeCount: 10 }, { number: 2, name: 'S2', episodeCount: 8 }]
  const ep = (airDate: string) => ({ id: 1, season: 2, number: 1, name: '', overview: '', airDate })

  it('waits with a dash until the detail is known', () => {
    expect(pickWhen({ type: 'movie' }, undefined, now, 'en-GB')).toEqual({ time: '–' })
  })

  it('says when a film would end if started now', () => {
    expect(pickWhen({ type: 'movie' }, { runtime: 167, seasons: [] }, now, 'en-GB')).toEqual({ ends: 167 * 60 })
  })

  it('gives a series its next air date, or the latest within a month, or its episode count', () => {
    expect(pickWhen({ type: 'show' }, { seasons, nextEpisode: ep('2026-10-27') }, now, 'en-GB')).toEqual({ time: 'Tue 27', label: 'airs' })
    expect(pickWhen({ type: 'show' }, { seasons, lastEpisode: ep('2026-10-12') }, now, 'en-GB')).toEqual({ time: 'Mon 12', label: 'aired' })
    expect(pickWhen({ type: 'show' }, { seasons, lastEpisode: ep('2025-03-01') }, now, 'en-GB')).toEqual({ time: '18', label: 'eps' })
  })

  it('counts an episode airing today as still to come', () => {
    expect(pickWhen({ type: 'show' }, { seasons, nextEpisode: ep('2026-10-22') }, now, 'en-GB')).toEqual({ time: 'Thu 22', label: 'airs' })
  })
})
