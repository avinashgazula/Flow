import { describe, expect, it } from 'vitest'
import type { Resume } from './client'
import { TraktError } from './client'
import { flushOps } from './ops'
import type { Op } from './store'

/** A Trakt that records what it was asked, and fails the calls named. */
function fakeApi(fail: Record<string, TraktError> = {}, playback: Resume[] = []) {
  const calls: [string, unknown][] = []
  const call = (name: string) => async (arg?: unknown) => {
    calls.push([name, arg])
    if (fail[name]) throw fail[name]
  }
  return {
    calls,
    api: {
      addToWatchlist: call('addToWatchlist'),
      removeFromWatchlist: call('removeFromWatchlist'),
      addHistory: call('addHistory'),
      rate: call('rate'),
      unrate: call('unrate'),
      deletePlayback: call('deletePlayback'),
      playback: async () => (calls.push(['playback', undefined]), playback),
    },
  }
}

const ops: Op[] = [
  { kind: 'watchlist', type: 'movie', id: 1, on: true },
  { kind: 'watchlist', type: 'show', id: 2, on: true },
  { kind: 'watchlist', type: 'movie', id: 3, on: false },
  { kind: 'watched', type: 'show', id: 4, season: 1, episode: 2, at: '2026-10-24T10:00:00Z' },
  { kind: 'rate', type: 'movie', id: 5, rating: 8 },
  { kind: 'rate', type: 'movie', id: 6, rating: null },
]

describe('sending changes', () => {
  it('batches by kind into one request each and leaves nothing queued', async () => {
    const trakt = fakeApi()
    const out = await flushOps(trakt.api, ops)
    expect(out.remaining).toEqual([])
    expect(trakt.calls.map(([name]) => name)).toEqual(['addToWatchlist', 'removeFromWatchlist', 'addHistory', 'rate', 'unrate'])
    expect(trakt.calls[0]![1]).toEqual([{ type: 'movie', id: 1 }, { type: 'show', id: 2 }])
    expect(trakt.calls[2]![1]).toEqual([{ type: 'show', id: 4, season: 1, episode: 2, at: '2026-10-24T10:00:00Z' }])
    expect(trakt.calls[3]![1]).toEqual([{ type: 'movie', id: 5, rating: 8 }])
  })

  it('stops at a failure that will pass and keeps that and everything after it queued', async () => {
    const trakt = fakeApi({ addHistory: new TraktError('Couldn’t reach Trakt. Check your connection.', 'network') })
    const out = await flushOps(trakt.api, ops)
    expect(out.error?.kind).toBe('network')
    expect(out.remaining.map((o) => o.kind)).toEqual(['watched', 'rate', 'rate'])
    expect(trakt.calls.map(([name]) => name)).toEqual(['addToWatchlist', 'removeFromWatchlist', 'addHistory'])
  })

  it('drops a change Trakt rejects, so it does not block the ones behind it', async () => {
    const trakt = fakeApi({ addToWatchlist: new TraktError('no', 'rejected', 420) })
    const out = await flushOps(trakt.api, ops)
    expect(out.error).toBeUndefined()
    expect(out.remaining).toEqual([])
  })

  it('removes a resume point by Trakt’s id, looking ids up once for all of them', async () => {
    const found: Resume[] = [
      { id: 71, type: 'movie', tmdb: 1, title: 'A', percent: 10, at: 0 },
      { id: 72, type: 'show', tmdb: 2, title: 'B', percent: 10, at: 0 },
    ]
    const trakt = fakeApi({}, found)
    const out = await flushOps(trakt.api, [
      { kind: 'unplayback', type: 'movie', id: 1 },
      { kind: 'unplayback', type: 'show', id: 2 },
      { kind: 'unplayback', type: 'movie', id: 99 },
    ])
    expect(out.remaining).toEqual([])
    expect(trakt.calls).toEqual([['playback', undefined], ['deletePlayback', 71], ['deletePlayback', 72]])
  })

  it('uses an id it already knows without asking', async () => {
    const trakt = fakeApi()
    await flushOps(trakt.api, [{ kind: 'unplayback', type: 'movie', id: 1 }], { 'movie:1': 5 })
    expect(trakt.calls).toEqual([['deletePlayback', 5]])
  })

  it('passes on a failure that is not Trakt’s', async () => {
    const api = {
      ...fakeApi().api,
      addToWatchlist: async () => {
        throw new Error('bug')
      },
    }
    await expect(flushOps(api, ops)).rejects.toThrow('bug')
  })
})
