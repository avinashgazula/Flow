import { describe, expect, it } from 'vitest'
import { toFacts } from '../../components/stripLayout'
import type { HistoryEntry } from '../../lib/store/library'
import type { WatchProvider } from '../../lib/providers'
import { genreTiles, serviceTiles } from './folders'
import { posterMarks, watchedMovieKeys, watchedShowsOf } from './marks'
import type { AiringDetail } from './continue'

const now = new Date(2026, 9, 24, 20, 0).getTime()
const film = (id: number): HistoryEntry => ({ key: `movie:${id}`, item: { type: 'movie', id, title: 'F', overview: '', genres: [] }, watchedAt: 1 })
const seasons = (...counts: number[]) => counts.map((episodeCount, i) => ({ number: i + 1, name: `S${i + 1}`, episodeCount }))
const detail: AiringDetail = { seasons: seasons(4, 4) }
const on = { watched: true, episodes: true }
const text = (m: ReturnType<typeof posterMarks>) => toFacts(m.parts).map((f) => f.text)

describe('watched marks on a poster', () => {
  const watched = { movies: watchedMovieKeys([film(7)]), shows: watchedShowsOf({ 'show:1:s1e1': 1, 'show:1:s1e2': 1, 'show:2:s1e1': 1, 'show:2:s1e2': 1, 'show:2:s1e3': 1, 'show:2:s1e4': 1, 'show:2:s2e1': 1, 'show:2:s2e2': 1, 'show:2:s2e3': 1, 'show:2:s2e4': 1 }) }

  it('prints WATCHED for a film in the history, and fills its perforations', () => {
    const m = posterMarks({ type: 'movie', id: 7 }, watched, undefined, now, on)
    expect(text(m)).toEqual(['watched'])
    expect(m.progress).toBe(1)
    expect(posterMarks({ type: 'movie', id: 8 }, watched, undefined, now, on)).toEqual({ parts: [] })
  })

  it('prints a series’ episodes watched, out of those aired, and fills that much of the reel', () => {
    const m = posterMarks({ type: 'show', id: 1 }, watched, detail, now, on)
    expect(text(m)).toEqual(['2/8'])
    expect(m.progress).toBe(0.25)
    expect(m.spoken).toBe('2 of 8 episodes watched')
  })

  it('prints WATCHED for a series once everything aired is watched', () => {
    expect(text(posterMarks({ type: 'show', id: 2 }, watched, detail, now, on))).toEqual(['watched'])
  })

  it('says nothing for a series until its episodes are known, or when none are watched', () => {
    expect(posterMarks({ type: 'show', id: 1 }, watched, undefined, now, on).parts).toEqual([])
    expect(posterMarks({ type: 'show', id: 3 }, watched, detail, now, on).parts).toEqual([])
  })

  it('follows the two switches in Settings', () => {
    expect(posterMarks({ type: 'movie', id: 7 }, watched, undefined, now, { watched: false, episodes: true }).parts).toEqual([])
    expect(posterMarks({ type: 'show', id: 1 }, watched, detail, now, { watched: true, episodes: false }).parts).toEqual([])
    expect(text(posterMarks({ type: 'show', id: 2 }, watched, detail, now, { watched: true, episodes: false }))).toEqual(['watched'])
  })

  it('builds each lookup once per list', () => {
    const history = [film(1)]
    expect(watchedMovieKeys(history)).toBe(watchedMovieKeys(history))
    const marks = { 'show:1:s1e1': 1 }
    expect(watchedShowsOf(marks)).toBe(watchedShowsOf(marks))
  })

  it('counts only the episodes watched again during a rewatch, as the title page does', () => {
    const marks = { 'show:1:s1e1': 1, 'show:1:s1e2': 1, 'show:2:s1e1': 1 }
    const rewatches = { 'show:1': { watched: ['s1e1'] } } as never
    const shows = watchedShowsOf(marks, rewatches)
    expect(shows.get(1)).toEqual([{ season: 1, episode: 1 }])
    expect(shows.get(2)).toEqual([{ season: 1, episode: 1 }])
    expect(watchedShowsOf(marks, rewatches)).toBe(shows)
    expect(watchedShowsOf(marks, {})).toBe(watchedShowsOf(marks))
  })
})

describe('folder rows', () => {
  const provider = (id: number, name: string, logo = `/${id}.jpg`): WatchProvider => ({ id, name, logo, rank: id })

  it('lists the featured services the region carries, in the apps’ order, with the catalogue’s logos', () => {
    const tiles = serviceTiles([provider(337, 'Disney Plus'), provider(8, 'Netflix'), provider(119, 'Amazon Prime Video'), provider(2, 'Apple TV')])
    expect(tiles).toEqual([
      { id: 8, name: 'Netflix', logo: '/8.jpg' },
      { id: 337, name: 'Disney+', logo: '/337.jpg' },
      { id: 119, name: 'Prime Video', logo: '/119.jpg' },
    ])
  })

  it('shows every service by name while the region’s list is out', () => {
    const tiles = serviceTiles([])
    expect(tiles).toHaveLength(8)
    expect(tiles[0]).toEqual({ id: 8, name: 'Netflix', logo: undefined })
  })

  it('has the apps’ twelve genres', () => {
    expect(genreTiles).toHaveLength(12)
    expect(genreTiles.map((g) => g.name).slice(0, 4)).toEqual(['Action', 'Comedy', 'Drama', 'Sci-Fi'])
    expect(new Set(genreTiles.map((g) => g.id)).size).toBe(12)
  })
})

describe('SERVER on a poster', () => {
  const none = { movies: watchedMovieKeys([]), shows: watchedShowsOf({}) }

  it('prints after the rating, ranked just under it, never before the watched marks', () => {
    const m = posterMarks({ type: 'movie', id: 1 }, none, undefined, now, on, true)
    expect(m.parts).toEqual([])
    expect(toFacts(m.tail ?? [])).toEqual([{ text: 'server', rank: 4.5 }])
    expect(m.spoken).toBe('on your server')
  })

  it('keeps WATCHED first and says both aloud', () => {
    const watched = { movies: watchedMovieKeys([film(7)]), shows: watchedShowsOf({}) }
    const m = posterMarks({ type: 'movie', id: 7 }, watched, undefined, now, on, true)
    expect(text(m)).toEqual(['watched'])
    expect(m.tail).toHaveLength(1)
    expect(m.spoken).toBe('watched, on your server')
  })

  it('is absent for a title that is not on one, and the shared empty answer is never changed', () => {
    expect(posterMarks({ type: 'movie', id: 1 }, none, undefined, now, on, false)).toEqual({ parts: [] })
    posterMarks({ type: 'movie', id: 1 }, none, undefined, now, on, true)
    expect(posterMarks({ type: 'movie', id: 2 }, none, undefined, now, on)).toEqual({ parts: [] })
  })
})
