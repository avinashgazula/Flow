import { describe, expect, it } from 'vitest'
import type { HistoryEntry, Progress } from '../../lib/store/library'
import type { MediaItem } from '../../lib/tmdb/types'
import { candidates } from './resumeLatest'

const item = (type: 'movie' | 'show', id: number): MediaItem => ({ type, id, title: `T${id}`, overview: '', genres: [] })
const progress = (type: 'movie' | 'show', id: number, updatedAt: number): Progress => ({ key: `${type}:${id}`, item: item(type, id), position: 100, duration: 1000, updatedAt })
const watched = (id: number, watchedAt: number): HistoryEntry => ({ key: `show:${id}`, item: item('show', id), episode: { season: 1, episode: 1 }, watchedAt })

describe('candidates', () => {
  it('puts the most recently watched first, resume points and next episodes together', () => {
    const list = candidates({ 'movie:1': progress('movie', 1, 100), 'show:2': progress('show', 2, 300) }, [watched(3, 200)])
    expect(list.map((c) => [c.kind, c.kind === 'resume' ? c.progress.item.id : c.item.id])).toEqual([['resume', 2], ['next', 3], ['resume', 1]])
  })

  it('leaves out a series that is already in progress, since its resume point is the way back', () => {
    const list = candidates({ 'show:2': progress('show', 2, 100) }, [watched(2, 500)])
    expect(list).toHaveLength(1)
    expect(list[0]!.kind).toBe('resume')
  })

  it('has nothing for an empty library, and never offers a watched film', () => {
    expect(candidates({}, [])).toEqual([])
    expect(candidates({}, [{ key: 'movie:9', item: item('movie', 9), watchedAt: 1 }])).toEqual([])
  })
})
