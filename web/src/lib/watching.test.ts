import { describe, expect, it } from 'vitest'
import { allWatched, isAired, isWatched, nextUp, parseCode, pickShuffle, watchedEpisodes } from './watching'

const ep = (season: number, episode: number) => ({ season, episode })
const aired = [ep(0, 1), ep(1, 1), ep(1, 2), ep(1, 3), ep(2, 1), ep(2, 2)]

describe('nextUp', () => {
  it('starts at the first regular episode, leaving Specials out', () => {
    expect(nextUp(aired, [])).toEqual(ep(1, 1))
  })

  it('follows the furthest episode watched, skipping any watched after it', () => {
    expect(nextUp(aired, [ep(1, 1), ep(1, 2)])).toEqual(ep(1, 3))
    expect(nextUp(aired, [ep(1, 3), ep(2, 1)])).toEqual(ep(2, 2))
    // An episode skipped earlier is not Next Up: it follows where the viewer got to.
    expect(nextUp(aired, [ep(1, 3)])).toEqual(ep(2, 1))
  })

  it('has nothing next when the aired episodes are done', () => {
    expect(nextUp(aired, [ep(2, 2)])).toBeUndefined()
  })

  it('ignores a watched Special', () => {
    expect(nextUp(aired, [ep(0, 1)])).toEqual(ep(1, 1))
  })
})

describe('watched episodes', () => {
  const lib = { watchedEpisodes: { 'show:5:s1e1': 1, 'show:5:s1e2': 2, 'show:50:s1e1': 3 }, rewatches: {} as Record<string, { startedAt: number; watched: string[] }> }

  it('reads one show’s episodes from the library', () => {
    expect(watchedEpisodes(lib, 5)).toEqual([ep(1, 1), ep(1, 2)])
    expect(isWatched(lib, 5, ep(1, 2))).toBe(true)
    expect(isWatched(lib, 5, ep(1, 3))).toBe(false)
  })

  it('counts only what was watched again while a rewatch is on', () => {
    const rewatching = { ...lib, rewatches: { 'show:5': { startedAt: 9, watched: ['s1e1'] } } }
    expect(watchedEpisodes(rewatching, 5)).toEqual([ep(1, 1)])
    expect(isWatched(rewatching, 5, ep(1, 2))).toBe(false)
    expect(nextUp(aired, watchedEpisodes(rewatching, 5))).toEqual(ep(1, 2))
  })

  it('knows when a show is all watched', () => {
    expect(allWatched(aired, [ep(1, 1), ep(1, 2), ep(1, 3), ep(2, 1), ep(2, 2)])).toBe(true)
    expect(allWatched(aired, [ep(1, 1)])).toBe(false)
    expect(allWatched([], [])).toBe(false)
  })

  it('reads a code and an air date', () => {
    expect(parseCode('s3e7')).toEqual(ep(3, 7))
    expect(parseCode('3x7')).toBeUndefined()
    expect(isAired('2026-10-24', '2026-10-24')).toBe(true)
    expect(isAired('2026-10-25', '2026-10-24')).toBe(false)
    expect(isAired(undefined, '2026-10-24')).toBe(false)
  })
})

describe('pickShuffle', () => {
  const first = () => 0

  it('prefers an episode not yet watched', () => {
    expect(pickShuffle(aired, [], [ep(1, 1), ep(1, 2)], first)?.pick).toEqual(ep(1, 3))
  })

  it('takes any episode once all are watched', () => {
    const all = aired.filter((e) => e.season > 0)
    expect(pickShuffle(aired, [], all, first)?.pick).toEqual(ep(1, 1))
  })

  it('does not repeat within a round, and remembers the picks', () => {
    const a = pickShuffle(aired, [], [], first)!
    const b = pickShuffle(aired, a.played, [], first)!
    expect(a.pick).toEqual(ep(1, 1))
    expect(b.pick).toEqual(ep(1, 2))
    expect(b.played).toEqual(['s1e1', 's1e2'])
  })

  it('starts a new round when every episode has been picked', () => {
    const round = ['s1e1', 's1e2', 's1e3', 's2e1', 's2e2']
    expect(pickShuffle(aired, round, [], first)).toEqual({ pick: ep(1, 1), played: ['s1e1'] })
  })

  it('picks across the pool with the random number', () => {
    expect(pickShuffle(aired, [], [], () => 0.999)?.pick).toEqual(ep(2, 2))
  })

  it('has nothing to pick when only Specials have aired', () => {
    expect(pickShuffle([ep(0, 1)], [], [])).toBeUndefined()
  })
})
