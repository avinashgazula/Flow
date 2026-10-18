import { describe, expect, it } from 'vitest'
import type { Source } from '../../lib/sources'
import type { Episode } from '../../lib/tmdb/types'
import { matchSource, nextEpisode, nextSource, resumePosition, shouldResume } from './session'

const src = (id: string, extra: Partial<Source> = {}): Source => ({ id, origin: 'addon', provider: 'P', title: id, url: `https://x/${id}`, engine: 'native', resolution: '1080p', ...extra }) as Source
const ep = (number: number, airDate?: string): Episode => ({ id: number, season: 1, number, name: `E${number}`, overview: '', airDate })
const progress = (position: number, duration: number, episode?: { season: number; episode: number }) => ({ key: 'k', item: {} as never, position, duration, updatedAt: 0, episode })

describe('shouldResume', () => {
  it('offers a position that is neither zero nor near the end', () => {
    expect(shouldResume(0, 100)).toBe(false)
    expect(shouldResume(40, 100)).toBe(true)
    expect(shouldResume(75, 100)).toBe(false)
    expect(shouldResume(40, Number.NaN)).toBe(true)
  })
})

describe('resumePosition', () => {
  it('uses the library for the same episode only', () => {
    expect(resumePosition(progress(120, 3000, { season: 1, episode: 2 }), { season: 1, episode: 2 })).toBe(120)
    expect(resumePosition(progress(120, 3000, { season: 1, episode: 2 }), { season: 1, episode: 3 })).toBeUndefined()
  })
  it('prefers the later of library and server', () => {
    expect(resumePosition(progress(120, 3000), undefined, 900)).toBe(900)
    expect(resumePosition(progress(1200, 3000), undefined, 900)).toBe(1200)
    expect(resumePosition(undefined, undefined, 10)).toBeUndefined()
  })
})

describe('matchSource', () => {
  it('finds the same file, else the same provider and resolution', () => {
    const list = [src('a', { provider: 'Q' }), src('b'), src('c', { unsupported: 'No' } as Partial<Source>)]
    expect(matchSource(src('b'), list)?.id).toBe('b')
    expect(matchSource(src('zzz'), list)?.id).toBe('b')
    expect(matchSource(src('zzz', { resolution: '480p' }), list)).toBeUndefined()
  })
})

describe('nextEpisode', () => {
  const today = '2025-06-01'
  it('goes to the next aired episode, then the next season', () => {
    expect(nextEpisode({ season: 1, episode: 1 }, [ep(1), ep(2)], undefined, today)?.number).toBe(2)
    expect(nextEpisode({ season: 1, episode: 2 }, [ep(1), ep(2)], [ep(1), ep(2)], today)?.number).toBe(1)
  })
  it('stops at what has not aired', () => {
    expect(nextEpisode({ season: 1, episode: 1 }, [ep(1), ep(2, '2030-01-01')], undefined, today)).toBeUndefined()
    expect(nextEpisode({ season: 1, episode: 2 }, [ep(1), ep(2)], undefined, today)).toBeUndefined()
  })
})

describe('nextSource', () => {
  it('walks the list once, skipping tried and unsupported sources', () => {
    const list = [src('a'), src('b'), src('c', { unsupported: 'No' } as Partial<Source>), src('d')]
    expect(nextSource(list, list[0], new Set(['a']))?.id).toBe('b')
    expect(nextSource(list, list[1], new Set(['a', 'b']))?.id).toBe('d')
    expect(nextSource(list, list[3], new Set(['a', 'b', 'd']))?.id).toBe('c')
    expect(nextSource(list, list[3], new Set(['a', 'b', 'c', 'd']))).toBeUndefined()
  })
})
