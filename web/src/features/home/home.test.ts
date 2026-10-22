import { describe, expect, it } from 'vitest'
import type { Progress } from '../../lib/store/library'
import type { MediaItem } from '../../lib/tmdb/types'
import { episodeLine, episodeShort, firstWithStill, formatPrint, formatSpoken, inProgress, pickMeta, pickPrint, resumePrint, secondsLeft, spokenPick, spokenResume, watchedFraction } from './logic'

const item = (over: Partial<MediaItem> = {}): MediaItem => ({ type: 'movie', id: 1, title: 'Dune: Part Two', overview: '', genres: [878, 12], year: 2024, rating: 8.24, ...over })
const entry = (key: string, updatedAt: number, over: Partial<Progress> = {}): Progress => ({ key, item: item(), position: 1750, duration: 2820, updatedAt, ...over })
const now = new Date(2026, 9, 22, 21, 30).getTime()
const nbsp = ' '

describe('Up Next', () => {
  it('orders in-progress titles by most recent, and drops ones with no length', () => {
    const list = inProgress({ a: entry('a', 10), b: entry('b', 30), c: entry('c', 20), d: entry('d', 40, { duration: 0 }) })
    expect(list.map((p) => p.key)).toEqual(['b', 'c', 'a'])
  })

  it('counts what is left, never below zero, and how far through', () => {
    expect(secondsLeft({ position: 1750, duration: 2820 })).toBe(1070)
    expect(secondsLeft({ position: 3000, duration: 2820 })).toBe(0)
    expect(watchedFraction({ position: 705, duration: 2820 })).toBeCloseTo(0.25)
    expect(watchedFraction({ position: 9000, duration: 2820 })).toBe(1)
  })

  it('names an episode, and nothing for a film', () => {
    expect(episodeLine({ season: 3, episode: 7, name: 'Fly' })).toBe('S3 E7 · Fly')
    expect(episodeLine({ season: 3, episode: 7 })).toBe('S3 E7')
    expect(episodeShort({ season: 3, episode: 7, name: 'Fly' })).toBe('S3 E7')
    expect(episodeLine()).toBeUndefined()
  })
})

describe('edge print for something started', () => {
  it('reads episode, time left in yellow, end time, then format', () => {
    const p = entry('a', 1, { item: item({ type: 'show' }), episode: { season: 3, episode: 7 }, position: 1740, duration: 2820 })
    expect(resumePrint(p, now, { resolution: '2160p', hdr: ['DV'], quality: 'REMUX' }, 'en-GB')).toEqual(['S3 E7', { key: '18 min left' }, 'ends 21:48', '2160p', 'DV', 'REMUX'])
  })

  it('leaves out what is not known: no episode for a film, no format before one has played', () => {
    expect(resumePrint(entry('b', 1, { position: 0, duration: 2 * 3600 }), now, undefined, 'en-GB')).toEqual([{ key: '2 h left' }, 'ends 23:30'])
  })

  it('lists the format of the last source as print, and as words', () => {
    expect(formatPrint({ resolution: '1080p', quality: 'WEB-DL' })).toEqual(['1080p', 'WEB-DL'])
    expect(formatPrint()).toEqual([])
    expect(formatSpoken({ resolution: '2160p', hdr: ['DV'], quality: 'REMUX' })).toBe('2160p Dolby Vision REMUX')
    expect(formatSpoken({})).toBeUndefined()
  })
})

describe('edge print for something not started', () => {
  const seasons = [
    { number: 0, name: 'Specials', episodeCount: 3 },
    { number: 1, name: 'S1', episodeCount: 10 },
    { number: 2, name: 'S2', episodeCount: 8 },
  ]
  const ep = (airDate: string) => ({ id: 1, season: 2, number: 1, name: '', overview: '', airDate })

  it('says only what the list knew until the detail arrives', () => {
    expect(pickPrint(item(), undefined, now)).toEqual(['Film', '8.2'])
    expect(pickPrint(item({ type: 'show' }), undefined, now)).toEqual(['Series', '8.2'])
  })

  it('gives a film its runtime and rating, and when it would end where there is room', () => {
    expect(pickPrint(item(), { runtime: 167, seasons: [] }, now)).toEqual(['2 h 47', '8.2'])
    expect(pickPrint(item(), { runtime: 167, seasons: [] }, now, { ends: true, locale: 'en-GB' })).toEqual(['2 h 47', 'ends 00:17', '8.2'])
  })

  it('gives a series its seasons, or NEW EP when one aired in the last two weeks', () => {
    expect(pickPrint(item({ type: 'show' }), { seasons }, now)).toEqual(['2 seasons', '8.2'])
    expect(pickPrint(item({ type: 'show' }), { seasons: seasons.slice(0, 2) }, now)).toEqual(['1 season', '8.2'])
    expect(pickPrint(item({ type: 'show' }), { seasons, lastEpisode: ep('2026-10-15') }, now)).toEqual([{ key: 'new ep' }, '8.2'])
    expect(pickPrint(item({ type: 'show' }), { seasons, lastEpisode: ep('2026-09-01') }, now)).toEqual(['2 seasons', '8.2'])
  })
})

describe('words for titles and screen readers', () => {
  it('gives a title its plain facts', () => {
    expect(pickMeta(item())).toBe('Film · 2024 · Science Fiction, Adventure')
    expect(pickMeta(item({ type: 'show', genres: [18], year: undefined }))).toBe('Series · Drama')
  })

  it('reads a started title naturally, with the end time in the locale and the format', () => {
    const p = entry('a', 1, { item: item({ title: 'Breaking Bad', type: 'show' }), episode: { season: 3, episode: 7 }, position: 1740, duration: 2820 })
    expect(spokenResume(p, now, 'en-US', { resolution: '2160p', hdr: ['DV'] })).toBe(`Breaking Bad, season 3 episode 7, 18 minutes left, ends 9:48${nbsp}PM, 2160p Dolby Vision`)
    expect(spokenResume(entry('b', 1, { position: 0, duration: 2 * 3600 }), now, 'en-GB')).toBe('Dune: Part Two, 2 hours left, ends 23:30')
  })

  it('reads a title not started, with its runtime when known', () => {
    expect(spokenPick(item())).toBe('Dune: Part Two, film, 2024, rated 8.2 on TMDB')
    expect(spokenPick(item(), { runtime: 167, seasons: [] })).toBe('Dune: Part Two, film, 2024, 2 hours 47 minutes, rated 8.2 on TMDB')
    expect(spokenPick(item({ rating: undefined, type: 'show' }))).toBe('Dune: Part Two, series, 2024')
  })

  it('finds the first title with a still', () => {
    expect(firstWithStill([item({ id: 1 }), item({ id: 2, backdrop: '/a.jpg' })])?.id).toBe(2)
    expect(firstWithStill(undefined)).toBeUndefined()
  })
})
