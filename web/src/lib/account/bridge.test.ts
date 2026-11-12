import { describe, expect, it } from 'vitest'
import type { Library } from '../store/library'
import type { MediaItem } from '../tmdb/types'
import { applyLocal, historyShown, patchFor, project, sourceIn, sourceOut } from './bridge'
import { emptyState, historyId, iso, mergeState, readState, writeState } from './wire'

const now = Date.parse('2026-11-01T12:00:00Z')
const item = (id: number, type: 'movie' | 'show' = 'movie', title = `Title ${id}`): MediaItem => ({ type, id, title, overview: '', genres: [18], year: 2024, poster: `/p${id}.jpg` })
const lib = (over: Partial<Library> = {}): Library => ({ progress: {}, watchlist: [], favourites: [], history: [], watchedEpisodes: {}, ratings: {}, rewatches: {}, shuffled: {}, ...over })

/** What a sync does: the changes made here laid on the account's state, merged with what the account holds. */
const sync = (base: ReturnType<typeof emptyState>, library: Library, sources = {}, remote = emptyState(), at = now) => {
  const local = applyLocal(base, library, sources, at)
  return mergeState(local, remote, at)
}

describe('the website’s library on the account', () => {
  it('stamps a new watchlist title with the time it was added and keeps a card for it', () => {
    const state = sync(emptyState(), lib({ watchlist: [{ key: 'movie:1', item: item(1), addedAt: now - 5000 }] }))
    expect(state.watchlist).toEqual([{ key: 'movie:1', addedAt: iso(now - 5000) }])
    expect(state.items['movie:1']).toMatchObject({ title: 'Title 1', poster: '/p1.jpg', genres: [18] })
  })

  it('makes a tombstone when a title is taken off, and only then', () => {
    const had = lib({ watchlist: [{ key: 'movie:1', item: item(1), addedAt: now - 5000 }] })
    const base = sync(emptyState(), had)
    expect(applyLocal(base, had, {}, now + 1000).removed).toEqual({})
    const off = applyLocal(base, lib(), {}, now + 1000)
    expect(off.watchlist).toEqual([])
    expect(off.removed).toEqual({ 'watchlist:movie:1': iso(now + 1000) })
  })

  it('does not tombstone a title that was removed and added again before the sync', () => {
    const had = lib({ watchlist: [{ key: 'movie:1', item: item(1), addedAt: now - 5000 }] })
    const base = sync(emptyState(), had)
    const again = lib({ watchlist: [{ key: 'movie:1', item: item(1), addedAt: now + 500 }] })
    const state = applyLocal(base, again, {}, now + 1000)
    expect(state.removed).toEqual({})
    expect(state.watchlist[0]!.addedAt).toBe(iso(now + 500))
  })

  it('carries ratings, with the time a score was given, and a removal when it is cleared', () => {
    const base = sync(emptyState(), lib({ ratings: { 'movie:1': 8 } }), {}, emptyState(), now)
    expect(base.ratings['movie:1']).toEqual({ value: 8, ratedAt: iso(now) })
    expect(applyLocal(base, lib({ ratings: { 'movie:1': 8 } }), {}, now + 5000).ratings['movie:1']!.ratedAt).toBe(iso(now))
    expect(applyLocal(base, lib({ ratings: { 'movie:1': 6 } }), {}, now + 5000).ratings['movie:1']).toEqual({ value: 6, ratedAt: iso(now + 5000) })
    expect(applyLocal(base, lib(), {}, now + 5000).removed).toHaveProperty(['ratings:movie:1'])
  })

  it('writes a resume point with its position, and removes it when the title is finished', () => {
    const p = { key: 'show:5', item: item(5, 'show'), episode: { season: 2, episode: 3, name: 'Pilot' }, position: 600, duration: 3000, updatedAt: now - 1000 }
    const base = sync(emptyState(), lib({ progress: { 'show:5': p } }))
    expect(base.progress[0]).toMatchObject({ key: 'show:5', episode: { season: 2, episode: 3, name: 'Pilot' }, percent: 20, positionSeconds: 600, durationSeconds: 3000 })
    const done = applyLocal(base, lib(), {}, now + 1000)
    expect(done.progress).toEqual([])
    expect(done.removed).toHaveProperty(['progress:show:5:S02E03'])
  })

  it('leaves the resume points of other episodes alone, and shows the newest one', () => {
    const base = {
      ...emptyState(),
      progress: [
        { key: 'show:5', episode: { season: 1, episode: 1 }, percent: 50, positionSeconds: 100, durationSeconds: 200, updatedAt: iso(now - 9000) },
        { key: 'show:5', episode: { season: 1, episode: 2 }, percent: 50, positionSeconds: 100, durationSeconds: 200, updatedAt: iso(now - 1000) },
      ],
    }
    const view = project(base, lib())
    expect(view.library.progress['show:5']!.episode).toMatchObject({ season: 1, episode: 2 })
    // The website finishing E02 removes that point only; E01 is still in the account.
    const next = applyLocal(base, lib(), {}, now)
    expect(next.progress.map((e) => e.episode?.episode)).toEqual([1])
  })

  it('ignores a resume point with no position', () => {
    const base = { ...emptyState(), progress: [{ key: 'movie:1', percent: 40, updatedAt: iso(now - 1000) }] }
    expect(project(base, lib()).library.progress).toEqual({})
  })

  it('turns watched episodes into plays, so another device sees them, and an unwatched one into removals', () => {
    const library = lib({ watchedEpisodes: { 'show:5:s1e1': now - 4000 }, history: [{ key: 'show:5', item: item(5, 'show'), episode: { season: 1, episode: 1 }, watchedAt: now - 4000 }] })
    const base = sync(emptyState(), library)
    expect(base.history).toHaveLength(1)
    const unwatched = applyLocal(base, lib(), {}, now + 1000)
    expect(unwatched.history).toEqual([])
    expect(Object.keys(unwatched.removed)).toEqual([`history:${historyId(base.history[0]!)}`])
  })

  it('gives a watched episode with no play behind it one', () => {
    const state = applyLocal(emptyState(), lib({ watchedEpisodes: { 'show:5:s2e4': now - 100_000 } }), {}, now)
    expect(state.history).toEqual([{ key: 'show:5', episode: { season: 2, episode: 4 }, watchedAt: iso(now - 100_000) }])
  })

  it('does not take a play out of the account when the website’s capped list drops it', () => {
    const plays = Array.from({ length: historyShown + 1 }, (_, i) => ({ key: 'movie:1', item: item(1), watchedAt: now - i * 60_000 }))
    const base = { ...emptyState(), history: plays.map(({ key, watchedAt }) => ({ key, watchedAt: iso(watchedAt) })) }
    // The website shows the newest 500 and, after one more play, would hold 500 with the oldest gone.
    const newer = [{ key: 'movie:1', item: item(1), watchedAt: now + 60_000 }, ...plays.slice(0, historyShown - 1)]
    const next = applyLocal(base, lib({ history: newer }), {}, now + 120_000)
    expect(next.removed).toEqual({})
    expect(next.history).toHaveLength(historyShown + 2)
  })

  it('does take a play out when it is within what the website shows and has been deleted', () => {
    const plays = [0, 1, 2].map((i) => ({ key: 'movie:1', item: item(1), watchedAt: now - i * 60_000 }))
    const base = { ...emptyState(), history: plays.map(({ key, watchedAt }) => ({ key, watchedAt: iso(watchedAt) })) }
    const next = applyLocal(base, lib({ history: [plays[0]!, plays[2]!] }), {}, now + 1000)
    expect(next.history).toHaveLength(2)
    expect(Object.keys(next.removed)).toHaveLength(1)
  })

  it('moves a rewatch on, with the time it moved, and ends it', () => {
    const r1 = lib({ rewatches: { 'show:5': { startedAt: now - 9000, watched: ['s1e1'] } } })
    const base = sync(emptyState(), r1)
    expect(base.rewatches[0]).toMatchObject({ key: 'show:5', watched: [{ season: 1, episode: 1 }] })
    const r2 = applyLocal(base, lib({ rewatches: { 'show:5': { startedAt: now - 9000, watched: ['s1e1', 's1e2'] } } }), {}, now + 5000)
    expect(r2.rewatches[0]!.watched).toHaveLength(2)
    expect(r2.rewatches[0]!.updatedAt).toBe(iso(now + 5000))
    expect(applyLocal(base, lib(), {}, now + 5000).removed).toHaveProperty(['rewatches:show:5'])
  })

  it('records the watchlist’s own order when it changes', () => {
    const state = applyLocal(emptyState(), lib({ watchlistOrder: ['movie:2', 'movie:1'] }), {}, now)
    expect(state.order).toEqual({ keys: ['movie:2', 'movie:1'], updatedAt: iso(now) })
    expect(applyLocal(emptyState(), lib(), {}, now).order).toBeNull()
  })

  it('remembers sources as release descriptions, never links, with resolution as a number', () => {
    const source = { providerId: 'https://addon.example/manifest.json', filename: 'Dune.2024.2160p.mkv', resolution: '2160p' as const, quality: 'WEB-DL' as const, hdr: ['DV' as const], date: now - 1000 }
    expect(sourceOut(source)).toMatchObject({ providerID: 'https://addon.example/manifest.json', resolution: 2160, quality: 'WEB-DL', hdr: ['DV'], date: iso(now - 1000) })
    expect(sourceIn(sourceOut(source))).toEqual(source)
    expect(sourceIn({ providerID: 'p', resolution: 0, quality: 'Unknown', hdr: [], date: iso(now) })).toEqual({ providerId: 'p', date: now })
    const state = applyLocal(emptyState(), lib(), { 'movie:1': source }, now)
    expect(Object.keys(state.sources)).toEqual(['movie:1'])
    expect(JSON.stringify(state)).not.toMatch(/https?:\/\/(?!addon)/)
  })
})

describe('the account’s state as the website’s library', () => {
  const remoteFromApps = () =>
    readState({
      lists: JSON.stringify({ v: 1, watchlist: [{ key: 'movie:7', addedAt: iso(now - 9000) }], ratings: { 'movie:7': { value: 9, ratedAt: iso(now - 8000) } }, order: { keys: ['movie:7'], updatedAt: iso(now - 7000) } }),
      'history-2026-10': JSON.stringify({ v: 1, month: '2026-10', entries: [{ key: 'show:3', episode: { season: 1, episode: 2 }, watchedAt: iso(now - 20 * 86_400_000) }] }),
      'items-7': JSON.stringify({ v: 1, items: { 'movie:7': { title: 'Seven', poster: '/seven.jpg' } } }),
      'items-3': JSON.stringify({ v: 1, items: { 'show:3': { title: 'Three' } } }),
    } as Record<string, string>).state

  it('shows what another device saved, with its card and score, and derives watched episodes from history', () => {
    const merged = sync(emptyState(), lib(), {}, remoteFromApps())
    const { library } = patchFor(merged, lib())
    expect(library.watchlist?.[0]).toMatchObject({ key: 'movie:7', item: { title: 'Seven', poster: '/seven.jpg' } })
    expect(library.ratings).toEqual({ 'movie:7': 9 })
    expect(library.watchlistOrder).toEqual(['movie:7'])
    expect(library.history?.[0]).toMatchObject({ key: 'show:3', episode: { season: 1, episode: 2 } })
    expect(Object.keys(library.watchedEpisodes ?? {})).toEqual(['show:3:s1e2'])
  })

  it('merges, never replaces: what this device had stays and goes up', () => {
    const mine = lib({ watchlist: [{ key: 'movie:1', item: item(1), addedAt: now - 1000 }] })
    const merged = sync(emptyState(), mine, {}, remoteFromApps())
    expect(merged.watchlist.map((e) => e.key).sort()).toEqual(['movie:1', 'movie:7'])
    expect(patchFor(merged, mine).library.watchlist).toHaveLength(2)
    expect(Object.keys(writeState(merged, now))).toContain('lists')
  })

  it('has nothing to change when the library already matches, so a sync is quiet', () => {
    const mine = lib({ watchlist: [{ key: 'movie:1', item: item(1), addedAt: now - 1000 }], ratings: { 'movie:1': 7 }, progress: { 'movie:1': { key: 'movie:1', item: item(1), position: 60, duration: 600, updatedAt: now - 500 } } })
    const merged = sync(emptyState(), mine)
    expect(patchFor(merged, mine).library).toEqual({})
  })

  it('keeps an episode’s still and name that only this browser holds', () => {
    const p = { key: 'show:5', item: item(5, 'show'), episode: { season: 1, episode: 1, name: 'Pilot', still: '/s.jpg' }, position: 60, duration: 600, updatedAt: now - 500 }
    const mine = lib({ progress: { 'show:5': p } })
    const merged = sync(emptyState(), mine)
    expect(patchFor(merged, mine).library.progress).toBeUndefined()
  })

  it('uses what this browser already knows of a title that has no card', () => {
    const base = { ...emptyState(), watchlist: [{ key: 'movie:1', addedAt: iso(now - 1000) }] }
    const mine = lib({ history: [{ key: 'movie:1', item: item(1, 'movie', 'Known'), watchedAt: now - 10 }] })
    expect(project(base, mine).library.watchlist[0]!.item.title).toBe('Known')
    expect(project(base, lib()).library.watchlist[0]!.item.title).toBe('Untitled')
  })
})
