import { describe, expect, it } from 'vitest'
import { episodesUpTo } from './upToHere'

const season = (n: number, count: number) => Array.from({ length: count }, (_, i) => ({ season: n, number: i + 1 }))

describe('episodesUpTo', () => {
  it('is the episode and every one before it in its season', () => {
    expect(episodesUpTo(season(2, 8), { season: 2, number: 4 })).toEqual([1, 2, 3, 4].map((episode) => ({ season: 2, episode })))
  })

  it('is the first episode alone when it is the first', () => {
    expect(episodesUpTo(season(1, 8), { season: 1, number: 1 })).toEqual([{ season: 1, episode: 1 }])
  })

  it('stays in the season, whatever else the list holds', () => {
    const both = [...season(1, 3), ...season(2, 3)]
    expect(episodesUpTo(both, { season: 2, number: 2 })).toEqual([{ season: 2, episode: 1 }, { season: 2, episode: 2 }])
  })

  it('keeps a special numbered 0, and leaves a gap in the numbering as it is', () => {
    expect(episodesUpTo([{ season: 0, number: 0 }, { season: 0, number: 1 }], { season: 0, number: 1 })).toEqual([{ season: 0, episode: 0 }, { season: 0, episode: 1 }])
    expect(episodesUpTo([{ season: 1, number: 1 }, { season: 1, number: 3 }, { season: 1, number: 4 }], { season: 1, number: 4 })).toEqual([1, 3, 4].map((episode) => ({ season: 1, episode })))
  })

  it('puts them in order whatever order TMDB sent', () => {
    expect(episodesUpTo([{ season: 1, number: 3 }, { season: 1, number: 1 }, { season: 1, number: 2 }], { season: 1, number: 3 }).map((e) => e.episode)).toEqual([1, 2, 3])
  })
})
