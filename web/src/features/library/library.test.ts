import { describe, expect, it } from 'vitest'
import type { HistoryEntry, ListEntry } from '../../lib/store/library'
import type { MediaItem } from '../../lib/tmdb/types'
import { dayGroup, episodeLabel, groupHistory, historyRows, parseListSort, sortEntries } from './logic'

// Noon local time on a Wednesday, so day boundaries are unambiguous in any zone the tests run in.
const now = new Date(2026, 9, 14, 12, 0).getTime()
const at = (daysAgo: number, hour = 12) => new Date(2026, 9, 14 - daysAgo, hour, 0).getTime()
const item = (id: number, extra: Partial<MediaItem> = {}): MediaItem => ({ id, type: 'movie', title: `T${id}`, overview: '', genres: [], ...extra })
const entry = (id: number, watchedAt: number): HistoryEntry => ({ key: `movie:${id}`, item: item(id), watchedAt })

describe('dayGroup', () => {
  it('uses the local calendar, not 24-hour windows', () => {
    expect(dayGroup(at(0, 0), now)).toBe('Today')
    expect(dayGroup(at(1, 23), now)).toBe('Yesterday')
    expect(dayGroup(at(1, 0), now)).toBe('Yesterday')
    expect(dayGroup(at(2, 23), now)).toBe('This Week')
    expect(dayGroup(at(6, 0), now)).toBe('This Week')
    expect(dayGroup(at(7, 23), now)).toBe('Earlier')
  })
})

describe('groupHistory', () => {
  it('sorts newest first and leaves out empty headings', () => {
    const groups = groupHistory([entry(1, at(30)), entry(2, at(0, 9)), entry(3, at(0, 11)), entry(4, at(3))], now)
    expect(groups.map((g) => g.label)).toEqual(['Today', 'This Week', 'Earlier'])
    expect(groups[0]!.entries.map((e) => e.item.id)).toEqual([3, 2])
  })

  it('flattens to headings and entries for the virtual list', () => {
    const rows = historyRows(groupHistory([entry(1, at(0)), entry(2, at(1)), entry(3, at(1, 8))], now))
    expect(rows.map((r) => (r.kind === 'header' ? `${r.label}:${r.count}` : r.entry.item.id))).toEqual(['Today:1', 1, 'Yesterday:2', 2, 3])
  })

  it('is empty for an empty history', () => {
    expect(groupHistory([], now)).toEqual([])
  })
})

describe('episodeLabel', () => {
  it('reads as on the other platforms', () => {
    expect(episodeLabel({ season: 3, episode: 7 }, 'One Minute')).toBe('S3 E7 · One Minute')
    expect(episodeLabel({ season: 3, episode: 7 })).toBe('S3 E7')
  })
})

describe('sortEntries', () => {
  const list: ListEntry[] = [
    { key: 'a', item: item(1, { title: 'The Matrix', date: '1999-03-31', rating: 8.2 }), addedAt: 3 },
    { key: 'b', item: item(2, { title: 'Arcane', type: 'show', date: '2021-11-06', rating: 8.7 }), addedAt: 1 },
    { key: 'c', item: item(3, { title: 'Dune 2', date: '2024-02-27', rating: 8.2 }), addedAt: 2 },
    { key: 'd', item: item(4, { title: 'Dune 10', year: 2030 }), addedAt: 4 },
  ]
  const ids = (l: ListEntry[]) => l.map((e) => e.item.id)

  it('sorts by when each was added, newest first, by default', () => {
    expect(ids(sortEntries(list, 'added'))).toEqual([4, 1, 3, 2])
  })
  it('sorts titles naturally: 2 before 10', () => {
    expect(ids(sortEntries(list, 'title'))).toEqual([2, 3, 4, 1])
  })
  it('sorts by release date, newest first, falling back to the year', () => {
    expect(ids(sortEntries(list, 'year'))).toEqual([4, 3, 2, 1])
  })
  it('sorts by rating, ties by title, unrated last', () => {
    expect(ids(sortEntries(list, 'rating'))).toEqual([2, 3, 1, 4])
  })
  it('filters to one type without changing the store’s list', () => {
    expect(ids(sortEntries(list, 'added', 'show'))).toEqual([2])
    expect(ids(list)).toEqual([1, 2, 3, 4])
  })
  it('reads unknown sorts as Recently Added', () => {
    expect(parseListSort('rating')).toBe('rating')
    expect(parseListSort('nope')).toBe('added')
  })
})
