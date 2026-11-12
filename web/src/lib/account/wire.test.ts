import { describe, expect, it } from 'vitest'
import {
  canonical,
  emptyState,
  historyId,
  itemsShard,
  mergeState,
  pageLimit,
  parseLists,
  pruneRemoved,
  readState,
  sameValues,
  splitHistory,
  tombstoneDays,
  writeState,
  type HistoryEntry,
  type WireState,
} from './wire'

const now = Date.parse('2026-11-01T12:00:00Z')
const day = 86_400_000
const t = (offsetMs: number) => new Date(now + offsetMs).toISOString()
const state = (over: Partial<WireState> = {}): WireState => ({ ...emptyState(), ...over })
const play = (key: string, ms: number, episode?: { season: number; episode: number }): HistoryEntry => ({ key, ...(episode ? { episode } : {}), watchedAt: t(ms) })

describe('merging libraries: lists', () => {
  it('keeps the union of both watchlists, newest entry per title', () => {
    const a = state({ watchlist: [{ key: 'movie:1', addedAt: t(-1000) }] })
    const b = state({ watchlist: [{ key: 'movie:1', addedAt: t(-5000), extra: 'old' }, { key: 'movie:2', addedAt: t(-2000) }] })
    const merged = mergeState(a, b, now)
    expect(merged.watchlist.map((e) => e.key)).toEqual(['movie:1', 'movie:2'])
    expect(merged.watchlist[0]!.extra).toBeUndefined()
  })

  it('is the same whichever side is local', () => {
    const a = state({ watchlist: [{ key: 'movie:1', addedAt: t(-1000), tag: 'a' }], ratings: { 'movie:1': { value: 8, ratedAt: t(-100) } }, order: { keys: ['movie:1'], updatedAt: t(-50) } })
    const b = state({ watchlist: [{ key: 'movie:1', addedAt: t(-1000), tag: 'b' }], ratings: { 'movie:1': { value: 6, ratedAt: t(-100) } }, order: { keys: ['movie:1'], updatedAt: t(-50) } })
    expect(canonical(mergeState(a, b, now))).toBe(canonical(mergeState(b, a, now)))
  })

  it('removes a title taken off on one device, and brings it back when added again later', () => {
    const had = { key: 'movie:1', addedAt: t(-10 * 1000) }
    const removed = state({ removed: { 'watchlist:movie:1': t(-5 * 1000) } })
    expect(mergeState(state({ watchlist: [had] }), removed, now).watchlist).toEqual([])
    const again = { key: 'movie:1', addedAt: t(-1000) }
    expect(mergeState(state({ watchlist: [again] }), removed, now).watchlist).toEqual([again])
  })

  it('treats a removal at the very moment of adding as a removal', () => {
    const at = t(-1000)
    expect(mergeState(state({ watchlist: [{ key: 'movie:1', addedAt: at }] }), state({ removed: { 'watchlist:movie:1': at } }), now).watchlist).toEqual([])
  })

  it('forgets removals after 90 days and keeps newer ones', () => {
    const removed = { 'watchlist:movie:1': t(-(tombstoneDays + 1) * day), 'watchlist:movie:2': t(-(tombstoneDays - 1) * day) }
    expect(Object.keys(pruneRemoved(removed, now))).toEqual(['watchlist:movie:2'])
    expect(Object.keys(mergeState(state(), state({ removed }), now).removed)).toEqual(['watchlist:movie:2'])
  })

  it('takes the newer rating and honours a rating removed later', () => {
    const a = state({ ratings: { 'movie:1': { value: 9, ratedAt: t(-1000) } } })
    const b = state({ ratings: { 'movie:1': { value: 4, ratedAt: t(-2000) } } })
    expect(mergeState(a, b, now).ratings['movie:1']!.value).toBe(9)
    expect(mergeState(a, state({ removed: { 'ratings:movie:1': t(-500) } }), now).ratings).toEqual({})
  })

  it('takes the later custom order', () => {
    const a = state({ order: { keys: ['movie:1', 'movie:2'], updatedAt: t(-1000) } })
    const b = state({ order: { keys: ['movie:2', 'movie:1'], updatedAt: t(-100) } })
    expect(mergeState(a, b, now).order?.keys).toEqual(['movie:2', 'movie:1'])
    expect(mergeState(a, state(), now).order?.keys).toEqual(['movie:1', 'movie:2'])
  })

  it('unions the episodes of one rewatch and lets a newer rewatch replace an older one', () => {
    const s1 = { key: 'show:1', startedAt: t(-9000), updatedAt: t(-4000), watched: [{ season: 1, episode: 1 }] }
    const s2 = { key: 'show:1', startedAt: t(-9000), updatedAt: t(-2000), watched: [{ season: 1, episode: 2 }] }
    expect(mergeState(state({ rewatches: [s1] }), state({ rewatches: [s2] }), now).rewatches[0]!.watched).toEqual([{ season: 1, episode: 1 }, { season: 1, episode: 2 }])
    const fresh = { key: 'show:1', startedAt: t(-1000), watched: [] }
    expect(mergeState(state({ rewatches: [s1] }), state({ rewatches: [fresh] }), now).rewatches[0]!.startedAt).toBe(t(-1000))
  })

  it('unions what Shuffle has played', () => {
    const a = state({ shuffle: [{ key: 'show:1', played: [{ season: 1, episode: 1 }] }] })
    const b = state({ shuffle: [{ key: 'show:1', played: [{ season: 1, episode: 2 }] }] })
    expect(mergeState(a, b, now).shuffle[0]!.played).toHaveLength(2)
  })
})

describe('merging libraries: progress, sources and cards', () => {
  it('keeps one resume point per episode, the newest, and drops one watched to the end on another device', () => {
    const e = (ms: number, position: number) => ({ key: 'show:1', episode: { season: 1, episode: 2 }, percent: 10, positionSeconds: position, durationSeconds: 3000, updatedAt: t(ms) })
    expect(mergeState(state({ progress: [e(-1000, 600)] }), state({ progress: [e(-2000, 100)] }), now).progress[0]!.positionSeconds).toBe(600)
    const done = state({ removed: { 'progress:show:1:S01E02': t(-500) } })
    expect(mergeState(state({ progress: [e(-1000, 600)] }), done, now).progress).toEqual([])
  })

  it('keeps the 500 newest resume points', () => {
    const many = Array.from({ length: 520 }, (_, i) => ({ key: `movie:${i + 1}`, percent: 5, positionSeconds: 60, durationSeconds: 6000, updatedAt: t(-i * 1000) }))
    const merged = mergeState(state({ progress: many }), state(), now)
    expect(merged.progress).toHaveLength(500)
    expect(merged.progress[0]!.key).toBe('movie:1')
  })

  it('keeps the newer remembered source per title', () => {
    const src = (date: number, providerID: string) => ({ providerID, resolution: 2160, quality: 'WEB-DL', hdr: [], date: t(date) })
    const merged = mergeState(state({ sources: { 'movie:1': src(-1000, 'a') } }), state({ sources: { 'movie:1': src(-500, 'b'), 'movie:2': src(-900, 'c') } }), now)
    expect(merged.sources['movie:1']!.providerID).toBe('b')
    expect(Object.keys(merged.sources)).toHaveLength(2)
  })

  it('drops cards no entry mentions and keeps ones that are used', () => {
    const merged = mergeState(state({ watchlist: [{ key: 'movie:1', addedAt: t(-1) }], items: { 'movie:1': { title: 'One' }, 'movie:9': { title: 'Nine' } } }), state({ items: { 'movie:1': { title: 'Remote One' } } }), now)
    expect(Object.keys(merged.items)).toEqual(['movie:1'])
    expect(merged.items['movie:1']!.title).toBe('One')
  })
})

describe('merging libraries: history', () => {
  it('is append-only by id: the same play on two devices is one entry, different plays are both kept', () => {
    const a = state({ history: [play('show:1', -3000, { season: 1, episode: 1 }), play('movie:2', -1000)] })
    const b = state({ history: [play('show:1', -3000, { season: 1, episode: 1 }), play('show:1', -2000, { season: 1, episode: 2 })] })
    expect(mergeState(a, b, now).history).toHaveLength(3)
  })

  it('ids follow the apps: key, episode code or a dash, and the whole second', () => {
    expect(historyId({ key: 'show:1396', episode: { season: 3, episode: 7 }, watchedAt: '2026-10-24T18:00:00.900Z' })).toBe('show:1396:S03E07:1792864800')
    expect(historyId({ key: 'movie:693134', watchedAt: '2026-10-24T18:00:00Z' })).toBe('movie:693134:-:1792864800')
  })

  it('removes a play taken out on another device, by its tombstone', () => {
    const entry = play('show:1', -3000, { season: 1, episode: 1 })
    const merged = mergeState(state({ history: [entry] }), state({ removed: { [`history:${historyId(entry)}`]: t(-1000) } }), now)
    expect(merged.history).toEqual([])
  })

  it('lists newest first', () => {
    const merged = mergeState(state({ history: [play('movie:1', -9000), play('movie:2', -1000)] }), state(), now)
    expect(merged.history.map((e) => e.key)).toEqual(['movie:2', 'movie:1'])
  })
})

describe('splitting a library into values', () => {
  it('writes nothing for an empty library', () => {
    expect(writeState(emptyState(), now)).toEqual({})
  })

  it('puts history in a value per month and cards in shards by TMDB id', () => {
    const s = state({
      watchlist: [{ key: 'movie:17', addedAt: t(-1) }],
      history: [play('movie:17', -1000), play('show:30', -40 * day, { season: 1, episode: 1 })],
      items: { 'movie:17': { title: 'Seventeen' }, 'show:30': { title: 'Thirty' } },
    })
    const out = writeState(s, now)
    expect(Object.keys(out).sort()).toEqual(['history-2026-09', 'history-2026-11', 'items-1', 'items-e', 'lists'])
    expect(itemsShard('movie:17')).toBe('items-1')
    expect(itemsShard('show:30')).toBe('items-e')
    expect(JSON.parse(out['history-2026-11']!).month).toBe('2026-11')
  })

  it('splits a busy month into numbered pages under the size limit, deterministically', () => {
    const entries = Array.from({ length: 1500 }, (_, i) => play('show:1', -i * 1000, { season: 1 + Math.floor(i / 100), episode: (i % 100) + 1 }))
    const pages = splitHistory(entries, {}, 20_000)
    const names = Object.keys(pages)
    expect(names.length).toBeGreaterThan(2)
    expect(names[0]).toBe('history-2026-11')
    expect(names[1]).toBe('history-2026-11-2')
    for (const text of Object.values(pages)) expect(text.length).toBeLessThanOrEqual(20_000)
    expect(JSON.stringify(splitHistory([...entries].reverse(), {}, 20_000))).toBe(JSON.stringify(pages))
    // The vector in docs/SYNC.md: the apps must split the same way.
    expect(names.map((n) => JSON.parse(pages[n]!).entries.length)).toEqual([217, 217, 217, 217, 215, 214, 203])
    expect(pages['history-2026-11']!.length).toBe(19_990)
    const back = readState(pages).state
    expect(back.history).toHaveLength(1500)
  })

  it('keeps a removal with the month of the play it removed', () => {
    const out = splitHistory([], { 'history:movie:1:-:1790000000': t(-1000) })
    expect(Object.keys(out)).toEqual(['history-2026-09'])
    expect(JSON.parse(out['history-2026-09']!).removed).toEqual({ 'history:movie:1:-:1790000000': t(-1000) })
    expect(pageLimit).toBeLessThan(256 * 1024 * 0.75)
  })

  it('reads back what it writes, and round-trips through a merge unchanged', () => {
    const s = state({
      watchlist: [{ key: 'movie:1', addedAt: t(-5000) }],
      favourites: [{ key: 'show:2', addedAt: t(-4000) }],
      ratings: { 'movie:1': { value: 9, ratedAt: t(-3000) } },
      rewatches: [{ key: 'show:2', startedAt: t(-2000), updatedAt: t(-1000), watched: [{ season: 1, episode: 1 }] }],
      progress: [{ key: 'movie:1', percent: 12.5, positionSeconds: 750, durationSeconds: 6000, updatedAt: t(-900) }],
      sources: { 'movie:1': { providerID: 'p', resolution: 1080, quality: 'WEB-DL', hdr: ['HDR10'], date: t(-800) } },
      history: [play('movie:1', -700)],
      removed: { 'watchlist:movie:3': t(-600), 'history:movie:9:-:1': t(-500) },
      order: { keys: ['movie:1'], updatedAt: t(-400) },
      items: { 'movie:1': { title: 'One' }, 'show:2': { title: 'Two' } },
    })
    const written = writeState(s, now)
    const back = readState(written)
    expect(back.unreadable).toEqual([])
    expect(canonical(mergeState(back.state, emptyState(), now))).toBe(canonical(mergeState(s, emptyState(), now)))
    expect(sameValues(written, writeState(back.state, now))).toBe(true)
  })

  it('keeps fields it does not know in a document, and in its entries', () => {
    const text = JSON.stringify({ v: 1, watchlist: [{ key: 'movie:1', addedAt: t(-1000), note: 'keep' }], futureField: { a: 1 } })
    const { state: read } = readState({ lists: text })
    const out = JSON.parse(writeState(read, now).lists!)
    expect(out.futureField).toEqual({ a: 1 })
    expect(out.watchlist[0].note).toBe('keep')
  })

  it('reports a newer format instead of reading it, and skips unreadable values', () => {
    const r = readState({ lists: JSON.stringify({ v: 2 }), progress: '{nope', sources: JSON.stringify({ v: 1, entries: {} }) })
    expect(r.newer).toEqual(['lists'])
    expect(r.unreadable).toEqual(['progress'])
    expect(parseLists('{"v":1}').ok).toBe(true)
  })

  it('ignores entries it cannot use', () => {
    const { state: read } = readState({ lists: JSON.stringify({ v: 1, watchlist: [{ key: 'bad', addedAt: t(0) }, { key: 'movie:1' }, { key: 'movie:2', addedAt: t(-1) }] }) })
    expect(read.watchlist.map((e) => e.key)).toEqual(['movie:2'])
  })

  it('compares values by meaning, not by key order', () => {
    expect(sameValues({ lists: '{"a":1,"b":2}' }, { lists: '{"b":2,"a":1}' })).toBe(true)
    expect(sameValues({ lists: '{"a":1}' }, { lists: '{"a":2}' })).toBe(false)
    expect(sameValues({ lists: '{}' }, {})).toBe(false)
  })
})
