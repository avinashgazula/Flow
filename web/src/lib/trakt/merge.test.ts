import { describe, expect, it } from 'vitest'
import type { HistoryEntry, Library, ListEntry, Progress } from '../store/library'
import type { MediaItem } from '../tmdb/types'
import type { Listed, Resume, Watch } from './client'
import { applyPull, diffLibrary, enqueue, mergeHistory, mergeProgress, mergeWatchedEpisodes, mergeWatchlist, snapshotOf, stubItem } from './merge'
import type { Op } from './store'

const item = (type: 'movie' | 'show', id: number, extra: Partial<MediaItem> = {}): MediaItem => ({ type, id, title: `T${id}`, overview: 'o', genres: [], poster: '/p.jpg', ...extra })
const listEntry = (type: 'movie' | 'show', id: number, addedAt = 1): ListEntry => ({ key: `${type}:${id}`, item: item(type, id), addedAt })
const library = (extra: Partial<Library> = {}): Library => ({ progress: {}, watchlist: [], favourites: [], history: [], watchedEpisodes: {}, ...extra })
const listed = (type: 'movie' | 'show', tmdb: number, at = 10): Listed => ({ type, tmdb, title: `T${tmdb}`, at })
const watch = (type: 'movie' | 'show', id: number, watchedAt: number, episode?: { season: number; episode: number }): HistoryEntry => ({ key: `${type}:${id}`, item: item(type, id), watchedAt, ...(episode ? { episode } : {}) })

const minute = 60_000
const t0 = Date.parse('2026-10-24T12:00:00Z')

describe('the queue of changes', () => {
  it('lets the last word on a title win, so add then remove is only the remove', () => {
    let ops: Op[] = []
    ops = enqueue(ops, { kind: 'watchlist', type: 'movie', id: 1, on: true })
    ops = enqueue(ops, { kind: 'watchlist', type: 'show', id: 1, on: true })
    ops = enqueue(ops, { kind: 'watchlist', type: 'movie', id: 1, on: false })
    expect(ops).toEqual([
      { kind: 'watchlist', type: 'show', id: 1, on: true },
      { kind: 'watchlist', type: 'movie', id: 1, on: false },
    ])
  })

  it('keeps two plays of one episode at different times, and counts one at the same time once', () => {
    const play = (at: string): Op => ({ kind: 'watched', type: 'show', id: 1, season: 1, episode: 2, at })
    let ops = enqueue([], play('2026-10-24T10:00:00Z'))
    ops = enqueue(ops, play('2026-10-24T10:00:00Z'))
    ops = enqueue(ops, play('2026-10-25T10:00:00Z'))
    expect(ops).toHaveLength(2)
  })
})

describe('what changed here', () => {
  it('turns watchlist additions and removals into changes', () => {
    const before = snapshotOf(library({ watchlist: [listEntry('movie', 1), listEntry('show', 2)] }))
    const ops = diffLibrary(before, library({ watchlist: [listEntry('show', 2), listEntry('movie', 3)] }))
    expect(ops).toEqual([
      { kind: 'watchlist', type: 'movie', id: 3, on: true },
      { kind: 'watchlist', type: 'movie', id: 1, on: false },
    ])
  })

  it('sends a title marked watched, and an episode finished, with the time it happened', () => {
    const before = snapshotOf(library())
    const ops = diffLibrary(before, library({ history: [watch('show', 5, t0, { season: 2, episode: 3 }), watch('movie', 6, t0 - minute)] }))
    expect(ops).toEqual([
      { kind: 'watched', type: 'show', id: 5, season: 2, episode: 3, at: '2026-10-24T12:00:00Z' },
      { kind: 'watched', type: 'movie', id: 6, at: '2026-10-24T11:59:00Z' },
    ])
  })

  it('skips plays the scrobbler already reported, and changes nothing when nothing changed', () => {
    const lib = library({ history: [watch('movie', 6, t0)] })
    expect(diffLibrary(snapshotOf(library()), lib, (h) => h.key === 'movie:6')).toEqual([])
    expect(diffLibrary(snapshotOf(lib), lib)).toEqual([])
  })

  it('treats a resume point that disappears as dismissed, unless the title was just finished', () => {
    const progress: Progress = { key: 'movie:1', item: item('movie', 1), position: 100, duration: 1000, updatedAt: 1 }
    const before = snapshotOf(library({ progress: { 'movie:1': progress } }))
    expect(diffLibrary(before, library())).toEqual([{ kind: 'unplayback', type: 'movie', id: 1 }])
    const finished = diffLibrary(before, library({ history: [watch('movie', 1, t0)] }))
    expect(finished.map((o) => o.kind)).toEqual(['watched'])
  })
})

describe('the watchlist', () => {
  const merge = (local: ListEntry[], remote: Listed[], baseline: string[] | null, pending: Op[] = []) => mergeWatchlist({ local, remote, baseline, pending })

  it('the first time, brings Trakt’s titles here and sends the ones only this browser has', () => {
    const out = merge([listEntry('movie', 1), listEntry('movie', 2)], [listed('movie', 2), listed('show', 3)], null)
    expect(out.add.map((r) => r.tmdb)).toEqual([3])
    expect(out.remove).toEqual([])
    expect(out.push).toEqual([{ kind: 'watchlist', type: 'movie', id: 1, on: true }])
    expect(out.baseline.sort()).toEqual(['movie:1', 'movie:2', 'show:3'])
  })

  it('takes a title added on Trakt since the last sync, and drops one removed there', () => {
    const out = merge([listEntry('movie', 1), listEntry('movie', 2)], [listed('movie', 1), listed('show', 9)], ['movie:1', 'movie:2'])
    expect(out.add.map((r) => r.tmdb)).toEqual([9])
    expect(out.remove).toEqual(['movie:2'])
    expect(out.push).toEqual([])
    expect(out.baseline.sort()).toEqual(['movie:1', 'show:9'])
  })

  it('does not bring back a title removed here that Trakt has not heard about yet', () => {
    const pending: Op[] = [{ kind: 'watchlist', type: 'movie', id: 2, on: false }]
    const out = merge([listEntry('movie', 1)], [listed('movie', 1), listed('movie', 2)], ['movie:1', 'movie:2'], pending)
    expect(out.add).toEqual([])
    expect(out.baseline).toEqual(['movie:1'])
  })

  it('does not drop a title added here that has not reached Trakt', () => {
    const pending: Op[] = [{ kind: 'watchlist', type: 'movie', id: 4, on: true }]
    const out = merge([listEntry('movie', 4)], [], ['movie:4'], pending)
    expect(out.remove).toEqual([])
    expect(out.push).toEqual([])
    expect(out.baseline).toEqual(['movie:4'])
  })

  it('sends titles added here while offline, which are in neither list', () => {
    const out = merge([listEntry('show', 7)], [], [])
    expect(out.push).toEqual([{ kind: 'watchlist', type: 'show', id: 7, on: true }])
    expect(out.baseline).toEqual(['show:7'])
  })
})

describe('history', () => {
  const remote = (tmdb: number, at: number, season?: number, episode?: number): Watch => ({ type: season === undefined ? 'movie' : 'show', tmdb, title: `T${tmdb}`, at, ...(season === undefined ? {} : { season, episode }) })

  it('adds plays Trakt has, and recognises its own copy of a play made here a few seconds apart', () => {
    const local = [watch('movie', 1, t0), watch('show', 2, t0, { season: 1, episode: 1 })]
    const out = mergeHistory({ local, remote: [remote(1, t0 + 4000), remote(2, t0, 1, 1), remote(2, t0, 1, 2), remote(1, t0 - 3 * 86_400_000)], firstSync: false, limit: 500 })
    expect(out.add.map((w) => [w.tmdb, w.episode])).toEqual([[2, 2], [1, undefined]])
    expect(out.push).toEqual([])
  })

  it('on the first sync sends plays only this browser has, but not ones older than what Trakt sent', () => {
    const local = [watch('movie', 1, t0), watch('movie', 2, t0 - 10 * 86_400_000), watch('movie', 3, t0 - 100 * 86_400_000)]
    // Trakt sent a full page, whose oldest play is five days ago: older local plays may simply be beyond it.
    const full = mergeHistory({ local, remote: [remote(9, t0 - 5 * 86_400_000), remote(8, t0 - 2 * 86_400_000)], firstSync: true, limit: 2 })
    expect(full.push.map((o) => (o.kind === 'watched' ? o.id : 0))).toEqual([1])
    // A short page is all there is: everything here that Trakt lacks goes up.
    const short = mergeHistory({ local, remote: [remote(9, t0)], firstSync: true, limit: 500 })
    expect(short.push.map((o) => (o.kind === 'watched' ? o.id : 0))).toEqual([1, 2, 3])
  })

  it('does not bring back an episode that was marked unwatched here and is still waiting to be removed there', () => {
    const remote = [{ tmdb: 5, title: 'S', episodes: [{ season: 1, episode: 1, at: 1 }, { season: 1, episode: 2, at: 2 }] }]
    const pending: Op[] = [{ kind: 'unwatched', type: 'show', id: 5, season: 1, episode: 1 }]
    expect(mergeWatchedEpisodes({}, remote, pending)).toEqual({ 'show:5:s1e2': 2 })
  })

  it('adds only the watched episodes this browser does not already have', () => {
    const add = mergeWatchedEpisodes({ 'show:5:s1e1': 7 }, [{ tmdb: 5, title: 'S', episodes: [{ season: 1, episode: 1, at: 1 }, { season: 1, episode: 2, at: 2 }] }])
    expect(add).toEqual({ 'show:5:s1e2': 2 })
  })
})

describe('marking unwatched', () => {
  const watched = (episode: number, at: string): Op => ({ kind: 'watched', type: 'show', id: 5, season: 1, episode, at })
  const unwatched = (episode: number): Op => ({ kind: 'unwatched', type: 'show', id: 5, season: 1, episode })

  it('queues one removal for each episode, not one for the show', () => {
    const ops = enqueue(enqueue([], unwatched(1)), unwatched(2))
    expect(ops).toEqual([unwatched(1), unwatched(2)])
  })

  it('lets the last word win while both wait: a play then its removal is just the removal, and back again', () => {
    expect(enqueue([watched(1, 'a'), watched(2, 'a')], unwatched(1))).toEqual([watched(2, 'a'), unwatched(1)])
    expect(enqueue([unwatched(1), unwatched(2)], watched(1, 'b'))).toEqual([unwatched(2), watched(1, 'b')])
  })
})

describe('resume points', () => {
  const resume = (over: Partial<Resume> = {}): Resume => ({ id: 1, type: 'movie', tmdb: 10, title: 'Dune', percent: 50, at: t0, runtimeMinutes: 100, ...over })

  it('turns a percentage into a position using Trakt’s runtime', () => {
    const { set, ids } = mergeProgress({ local: {}, remote: [resume()], history: [] })
    expect(set[0]).toMatchObject({ key: 'movie:10', position: 3000, duration: 6000, updatedAt: t0 })
    expect(ids).toEqual({ 'movie:10': 1 })
  })

  it('uses a typical runtime when Trakt has none, and names the episode', () => {
    const { set } = mergeProgress({ local: {}, remote: [resume({ type: 'show', tmdb: 20, season: 1, episode: 3, episodeTitle: 'Third', runtimeMinutes: undefined, percent: 10 })], history: [] })
    expect(set[0]).toMatchObject({ key: 'show:20', duration: 2700, position: 270, episode: { season: 1, episode: 3, name: 'Third' } })
  })

  it('keeps this browser’s point when it is newer, and takes Trakt’s when that is', () => {
    const local: Record<string, Progress> = { 'movie:10': { key: 'movie:10', item: item('movie', 10), position: 5, duration: 10, updatedAt: t0 + minute } }
    expect(mergeProgress({ local, remote: [resume()], history: [] }).set).toEqual([])
    expect(mergeProgress({ local, remote: [resume({ at: t0 + 2 * minute })], history: [] }).set).toHaveLength(1)
  })

  it('skips stale points: nearly finished, barely started, or finished here since', () => {
    expect(mergeProgress({ local: {}, remote: [resume({ percent: 95 }), resume({ id: 2, tmdb: 11, percent: 0.2 })], history: [] }).set).toEqual([])
    expect(mergeProgress({ local: {}, remote: [resume()], history: [watch('movie', 10, t0 + minute)] }).set).toEqual([])
  })

  it('keeps one point per title, the newest, but remembers Trakt’s id for it', () => {
    const { set, ids } = mergeProgress({ local: {}, remote: [resume({ id: 1, at: t0 }), resume({ id: 2, at: t0 + minute, percent: 30 })], history: [] })
    expect(set).toHaveLength(1)
    expect(set[0]!.position).toBe(1800)
    expect(ids['movie:10']).toBe(2)
  })
})

describe('applying a pull', () => {
  it('adds stand-ins for new titles, keeps what is already here with its artwork, and drops what was removed', () => {
    const lib = library({ watchlist: [listEntry('movie', 1, 5), listEntry('movie', 2, 6)] })
    const out = applyPull(lib, { watchlist: { add: [listed('show', 9, 100)], remove: ['movie:2'], push: [], baseline: [] } })
    expect(out.watchlist.map((e) => e.key)).toEqual(['show:9', 'movie:1'])
    expect(out.watchlist[0]!.item).toEqual(stubItem('show', 9, 'T9'))
    expect(out.watchlist[1]!.item.poster).toBe('/p.jpg')
  })

  it('merges pulled history newest first, counts its episodes as watched, and caps it', () => {
    const lib = library({ history: [watch('movie', 1, t0)], watchedEpisodes: { 'show:5:s1e1': 99 } })
    const pulled: Watch[] = [
      { type: 'show', tmdb: 5, title: 'S', season: 1, episode: 1, at: t0 + minute },
      { type: 'show', tmdb: 5, title: 'S', season: 1, episode: 2, at: t0 + 2 * minute },
    ]
    const out = applyPull(lib, { history: pulled }, 3)
    expect(out.history.map((h) => h.watchedAt)).toEqual([t0 + 2 * minute, t0 + minute, t0])
    expect(out.watchedEpisodes).toEqual({ 'show:5:s1e1': 99, 'show:5:s1e2': t0 + 2 * minute })
    expect(applyPull(lib, { history: pulled }, 2).history).toHaveLength(2)
  })

  it('leaves the library as it was when there is nothing to apply', () => {
    const lib = library({ watchlist: [listEntry('movie', 1)] })
    expect(applyPull(lib, {})).toEqual(lib)
  })
})
