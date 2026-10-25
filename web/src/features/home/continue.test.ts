import { describe, expect, it } from 'vitest'
import type { HistoryEntry, Progress } from '../../lib/store/library'
import type { MediaItem } from '../../lib/tmdb/types'
import { airedEpisodes, continueEntries, episodesLeftText, followedShows, nextUp, parseEpisodeKey, showStatus, watchedByShow, type AiringDetail } from './continue'

const now = new Date(2026, 9, 24, 20, 0).getTime()
const show = (id: number): MediaItem => ({ type: 'show', id, title: `Show ${id}`, overview: '', genres: [] })
const ep = (season: number, number: number, airDate?: string) => ({ id: season * 100 + number, season, number, name: '', overview: '', airDate })
const seasons = (...counts: number[]) => counts.map((episodeCount, i) => ({ number: i + 1, name: `Season ${i + 1}`, episodeCount }))
const refs = (season: number, ...episodes: number[]) => episodes.map((episode) => ({ season, episode }))

describe('episode marks', () => {
  it('reads a mark back into its show, season and episode', () => {
    expect(parseEpisodeKey('show:1396:s3e7')).toEqual({ showId: 1396, season: 3, episode: 7 })
    expect(parseEpisodeKey('movie:1:s1e1')).toBeUndefined()
    expect(parseEpisodeKey('show:1396')).toBeUndefined()
  })

  it('groups the marks by show', () => {
    const by = watchedByShow({ 'show:1:s1e1': 1, 'show:1:s1e2': 2, 'show:2:s4e9': 3, junk: 4 })
    expect(by.get(1)).toEqual(refs(1, 1, 2))
    expect(by.get(2)).toEqual(refs(4, 9))
    expect(by.size).toBe(2)
  })
})

describe('which episodes have aired', () => {
  it('counts every episode of a finished series', () => {
    const detail: AiringDetail = { seasons: seasons(3, 2), lastEpisode: ep(2, 2, '2020-01-01') }
    expect(airedEpisodes(detail, now)).toHaveLength(5)
  })

  it('stops a running season before the next episode', () => {
    const detail: AiringDetail = { seasons: seasons(10, 8), lastEpisode: ep(2, 4, '2026-10-20'), nextEpisode: ep(2, 5, '2026-10-30') }
    const aired = airedEpisodes(detail, now)
    expect(aired).toHaveLength(10 + 4)
    expect(aired.at(-1)).toEqual({ season: 2, episode: 4 })
  })

  it('counts nothing from a season that has not begun, or from ones after the next', () => {
    const future: AiringDetail = { seasons: [...seasons(6), { number: 2, name: 'Season 2', episodeCount: 8, airDate: '2027-01-10' }] }
    expect(airedEpisodes(future, now)).toHaveLength(6)
    const upcoming: AiringDetail = { seasons: seasons(6, 8), nextEpisode: ep(2, 1, '2026-11-01') }
    expect(airedEpisodes(upcoming, now)).toHaveLength(6)
  })

  it('counts a next episode that has already come out', () => {
    const detail: AiringDetail = { seasons: seasons(8), lastEpisode: ep(1, 5, '2026-10-17'), nextEpisode: ep(1, 6, '2026-10-24') }
    expect(airedEpisodes(detail, now)).toHaveLength(6)
  })

  it('leaves out Specials', () => {
    const detail: AiringDetail = { seasons: [{ number: 0, name: 'Specials', episodeCount: 4 }, ...seasons(2)] }
    expect(airedEpisodes(detail, now)).toEqual(refs(1, 1, 2))
  })
})

describe('next episode', () => {
  const aired = [...refs(1, 1, 2, 3), ...refs(2, 1, 2)]

  it('is the first episode when nothing is watched', () => {
    expect(nextUp([], aired)).toEqual({ season: 1, episode: 1 })
  })

  it('follows the furthest watched episode, across a season', () => {
    expect(nextUp(refs(1, 1, 2), aired)).toEqual({ season: 1, episode: 3 })
    expect(nextUp(refs(1, 1, 2, 3), aired)).toEqual({ season: 2, episode: 1 })
  })

  it('skips ahead of a gap rather than back into it', () => {
    expect(nextUp(refs(1, 1, 3), aired)).toEqual({ season: 2, episode: 1 })
  })

  it('is nothing once the viewer is caught up', () => {
    expect(nextUp([...refs(1, 1, 2, 3), ...refs(2, 1, 2)], aired)).toBeUndefined()
  })

  it('ignores Specials in what is watched', () => {
    expect(nextUp([{ season: 0, episode: 5 }], aired)).toEqual({ season: 1, episode: 1 })
  })
})

describe('what is left', () => {
  const detail: AiringDetail = { seasons: seasons(10, 8), lastEpisode: ep(2, 6, '2026-10-17'), nextEpisode: ep(2, 7, '2026-10-31') }

  it('counts aired episodes not yet watched, and the next one', () => {
    const status = showStatus([...refs(1, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10), ...refs(2, 1, 2)], detail, now)
    expect(status).toMatchObject({ watched: 12, aired: 16, left: 4, complete: false, next: { season: 2, episode: 3 } })
  })

  it('is complete when everything aired is watched, even with more to come', () => {
    const all = [...refs(1, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10), ...refs(2, 1, 2, 3, 4, 5, 6)]
    const status = showStatus(all, detail, now)
    expect(status).toMatchObject({ left: 0, complete: true, next: undefined })
  })

  it('says it in words', () => {
    expect(episodesLeftText(1)).toBe('1 episode left')
    expect(episodesLeftText(5)).toBe('5 episodes left')
  })
})

describe('Continue Watching', () => {
  const progress = (id: number, updatedAt: number): Progress => ({ key: `show:${id}`, item: show(id), episode: { season: 1, episode: 2 }, position: 100, duration: 2000, updatedAt })
  const next = (id: number, updatedAt: number) => ({ key: `show:${id}`, item: show(id), episode: { season: 2, episode: 1 }, updatedAt })

  it('lists what is in progress and the next episodes, the most recent first', () => {
    const list = continueEntries([progress(1, 30), progress(2, 10)], [next(3, 20)])
    expect(list.map((e) => [e.key, e.nextUp])).toEqual([['show:1', false], ['show:3', true], ['show:2', false]])
  })

  it('lets a resume point win over a next episode of the same show', () => {
    const list = continueEntries([progress(1, 10)], [next(1, 99)])
    expect(list).toHaveLength(1)
    expect(list[0]).toMatchObject({ nextUp: false, progress: { position: 100 } })
  })

  it('keeps the most recent when limited', () => {
    const list = continueEntries([progress(1, 10), progress(2, 30), progress(3, 20)], [], 2)
    expect(list.map((e) => e.key)).toEqual(['show:2', 'show:3'])
  })

  it('finds the followed shows from the history, skipping ones in progress and films', () => {
    const entry = (item: MediaItem, watchedAt: number): HistoryEntry => ({ key: `${item.type}:${item.id}`, item, watchedAt })
    const history = [entry(show(1), 5), entry({ ...show(9), type: 'movie' }, 9), entry(show(2), 8), entry(show(1), 7), entry(show(3), 6)]
    expect(followedShows(history, new Set(['show:3']), 5).map((s) => [s.key, s.watchedAt])).toEqual([['show:2', 8], ['show:1', 7]])
    expect(followedShows(history, new Set(), 1)).toHaveLength(1)
  })
})
