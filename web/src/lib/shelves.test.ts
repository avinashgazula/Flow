import { describe, expect, it } from 'vitest'
import { builtIn, defaultShelves, newQuery, type ShelfConfig } from './shelfDefaults'
import { addBuiltInShelf, addDiscoverShelf, isDefaultShelves, isShelfList, missingBuiltIns, moveShelf, parseShelves, removeShelf, restoreDefaultShelves, setShelfEnabled, shelfSubtitle, shelvesToJSON, updateDiscoverShelf } from './shelves'

const comedy = (): ShelfConfig[] => addDiscoverShelf([], 'Comedy Films', { ...newQuery('movie'), genres: [35], minRating: 7 }, 'comedy')

describe('the default list', () => {
  it('is the apps’ list: what is on, in order, with the rest off', () => {
    expect(defaultShelves.filter((s) => s.enabled).map((s) => s.id)).toEqual(['continueWatching', 'upcomingEpisodes', 'watchlist', 'trendingMovies', 'trendingShows', 'becauseYouWatched', 'popularMovies', 'streamingServices', 'genres'])
    expect(defaultShelves).toHaveLength(18)
    expect(defaultShelves[0]).toMatchObject({ title: 'Continue Watching', style: 'landscape' })
    expect(isShelfList(defaultShelves)).toBe(true)
  })

  it('restores to itself, as a copy', () => {
    const copy = restoreDefaultShelves()
    expect(copy).toEqual(defaultShelves)
    expect(copy[0]).not.toBe(defaultShelves[0])
    expect(isDefaultShelves(copy)).toBe(true)
    expect(isDefaultShelves(moveShelf(copy, 'genres', -1))).toBe(false)
  })
})

describe('editing', () => {
  it('moves a shelf up or down, and not past an end', () => {
    const ids = (l: ShelfConfig[]) => l.map((s) => s.id).slice(0, 4)
    expect(ids(moveShelf(defaultShelves, 'watchlist', -1))).toEqual(['continueWatching', 'watchlist', 'upcomingEpisodes', 'trendingMovies'])
    expect(ids(moveShelf(defaultShelves, 'continueWatching', 1))).toEqual(['upcomingEpisodes', 'continueWatching', 'watchlist', 'trendingMovies'])
    expect(moveShelf(defaultShelves, 'continueWatching', -1)).toEqual(defaultShelves)
    expect(moveShelf(defaultShelves, 'genres', 1)).toEqual(defaultShelves)
    expect(moveShelf(defaultShelves, 'nope', 1)).toEqual(defaultShelves)
  })

  it('switches one shelf on or off without touching the rest', () => {
    const off = setShelfEnabled(defaultShelves, 'watchlist', false)
    expect(off.find((s) => s.id === 'watchlist')?.enabled).toBe(false)
    expect(off.filter((s) => !s.enabled)).toHaveLength(defaultShelves.filter((s) => !s.enabled).length + 1)
  })

  it('adds a Discover shelf at the end, and edits it in place', () => {
    const list = addDiscoverShelf(defaultShelves, '  Anime  ', { ...newQuery('show'), genres: [16] }, 'anime')
    expect(list.at(-1)).toMatchObject({ id: 'anime', title: 'Anime', enabled: true, style: 'poster', source: { kind: 'discover' } })
    const edited = updateDiscoverShelf(list, 'anime', 'Animation', { ...newQuery('show'), genres: [16, 10765] })
    expect(edited.at(-1)).toMatchObject({ title: 'Animation', source: { query: { genres: [16, 10765] } } })
    expect(updateDiscoverShelf(list, 'watchlist', 'x', newQuery())).toEqual(list)
  })

  it('removes only shelves of your own: a built-in row is switched off instead', () => {
    const list = [...comedy(), builtIn('watchlist')]
    expect(removeShelf(list, 'comedy').map((s) => s.id)).toEqual(['watchlist'])
    expect(removeShelf(list, 'watchlist')).toEqual(list)
  })

  it('offers the built-in rows the list lacks, and adds one once', () => {
    const list = defaultShelves.filter((s) => s.id !== 'topRatedShows' && s.id !== 'nowPlaying')
    expect(missingBuiltIns(list)).toEqual(['topRatedShows', 'nowPlaying', 'anticipatedMovies', 'anticipatedShows', 'recommendedForYou'])
    expect(missingBuiltIns(defaultShelves)).toEqual(['topRatedShows', 'anticipatedMovies', 'anticipatedShows', 'recommendedForYou'])
    const added = addBuiltInShelf(list, 'nowPlaying')
    expect(added.at(-1)).toMatchObject({ id: 'nowPlaying', title: 'Now Playing', enabled: true })
    expect(addBuiltInShelf(added, 'nowPlaying')).toHaveLength(added.length)
  })

  it('says what a shelf is', () => {
    expect(shelfSubtitle({ kind: 'builtIn', id: 'watchlist' })).toBe('Built-in')
    expect(shelfSubtitle({ kind: 'discover', query: { ...newQuery('movie'), genres: [35, 12], sort: 'vote_average.desc' } })).toBe('Discover · Movies · Rating · Comedy, Adventure')
    expect(shelfSubtitle({ kind: 'discover', query: { ...newQuery('show'), releasedToDays: 30 } })).toBe('Discover · Shows · Popularity · Upcoming')
    expect(shelfSubtitle({ kind: 'traktList', user: 'me', slug: 'noir' })).toBe('Trakt · me/noir')
    expect(shelfSubtitle({ kind: 'mdblist', id: 9 })).toBe('MDBList · #9')
  })
})

describe('validating a saved list', () => {
  it('accepts every kind of source, including the ones other batches fill in', () => {
    const list: ShelfConfig[] = [
      ...comedy(),
      { id: 't', title: 'Noir', source: { kind: 'traktList', user: 'me', slug: 'noir' }, enabled: true, style: 'poster' },
      { id: 'm', title: 'Staff Picks', source: { kind: 'mdblist', id: 12 }, enabled: false, style: 'landscape' },
      { id: 's', title: 'Films', source: { kind: 'mediaServerLibrary', serverID: 'a', libraryID: 'b' }, enabled: true, style: 'hero' },
    ]
    expect(isShelfList(list)).toBe(true)
    expect(isShelfList([])).toBe(true)
  })

  it('refuses what TMDB or Home could not use', () => {
    const base = comedy()[0]!
    const bad = (patch: Partial<ShelfConfig> | { source: unknown }) => isShelfList([{ ...base, ...patch }])
    expect(bad({ title: ' ' })).toBe(false)
    expect(bad({ style: 'huge' as never })).toBe(false)
    expect(bad({ source: { kind: 'builtIn', id: 'nonsense' } })).toBe(false)
    expect(bad({ source: { kind: 'discover', query: { ...newQuery(), sort: 'chaos' } } })).toBe(false)
    expect(bad({ source: { kind: 'discover', query: { ...newQuery(), genres: ['35'] } } })).toBe(false)
    expect(bad({ source: { kind: 'discover', query: { ...newQuery(), watchRegion: 'usa' } } })).toBe(false)
    expect(bad({ source: { kind: 'discover', query: { ...newQuery(), minRating: 11 } } })).toBe(false)
    expect(isShelfList([base, base])).toBe(false)
    expect(isShelfList('shelves')).toBe(false)
    expect(isShelfList(Array.from({ length: 101 }, (_, i) => ({ ...base, id: `s${i}` })))).toBe(false)
  })
})

describe('the clipboard', () => {
  it('writes the apps’ JSON', () => {
    const json = JSON.parse(shelvesToJSON([builtIn('watchlist'), ...comedy()]))
    expect(json[0]).toEqual({ enabled: true, id: 'watchlist', source: { builtIn: { _0: 'watchlist' } }, style: 'poster', title: 'Watchlist' })
    expect(json[1].source).toEqual({ discover: { _0: { type: 'movie', genres: [35], excludedGenres: [], sort: 'popularity.desc', watchProviders: [], minRating: 7 } } })
  })

  it('reads back what it wrote', () => {
    const list = [...defaultShelves, ...comedy()]
    const back = parseShelves(shelvesToJSON(list))
    expect(back).toEqual({ ok: true, shelves: list, skipped: 0 })
  })

  it('reads a list copied from an iPhone, with what Swift leaves out filled in', () => {
    const swift = JSON.stringify([
      { id: 'continueWatching', title: 'Continue Watching', source: { builtIn: { _0: 'continueWatching' } }, enabled: true, style: 'landscape' },
      { id: 'A1B2', title: 'Anime', enabled: true, style: 'poster', source: { discover: { _0: { type: 'show', genres: [16], sort: 'popularity.desc', watchProviders: [8], watchRegion: 'US', extra: 1 } } } },
      { id: 'T', title: 'Noir', enabled: false, style: 'poster', source: { traktList: { user: 'me', slug: 'noir' } } },
      { id: 'S', title: 'Server', enabled: true, style: 'poster', source: { mediaServerLibrary: { serverID: 'x', libraryID: 'y' } } },
    ])
    const r = parseShelves(swift)
    expect(r.ok && r.skipped).toBe(0)
    if (!r.ok) return
    expect(r.shelves[1]!.source).toEqual({ kind: 'discover', query: { type: 'show', genres: [16], excludedGenres: [], sort: 'popularity.desc', watchProviders: [8], watchRegion: 'US' } })
    expect(r.shelves[2]).toMatchObject({ enabled: false, source: { kind: 'traktList', slug: 'noir' } })
    expect(isShelfList(r.shelves)).toBe(true)
  })

  it('also reads a whole setup export', () => {
    const r = parseShelves(JSON.stringify({ format: 'flow-setup', settings: { shelves: JSON.parse(shelvesToJSON([builtIn('genres')])) } }))
    expect(r.ok && r.shelves.map((s) => s.id)).toEqual(['genres'])
  })

  it('leaves out what it cannot read and says how many', () => {
    const r = parseShelves(JSON.stringify([
      { id: 'a', title: 'A', enabled: true, style: 'poster', source: { builtIn: { _0: 'watchlist' } } },
      { id: 'b', title: 'B', enabled: true, style: 'poster', source: { builtIn: { _0: 'notARow' } } },
      { id: 'a', title: 'Again', enabled: true, style: 'poster', source: { builtIn: { _0: 'genres' } } },
      'junk',
    ]))
    expect(r.ok && r.shelves.map((s) => s.id)).toEqual(['a'])
    expect(r.ok && r.skipped).toBe(3)
  })

  it('says what to do when the text is not shelves', () => {
    for (const text of ['', 'nope', '{"hello":1}', '[]', '[{"id":"x"}]']) {
      const r = parseShelves(text)
      expect(r.ok).toBe(false)
      if (!r.ok) expect(r.error).toMatch(/Copy|empty/)
    }
  })

  it('gives a pasted shelf without an id one of its own', () => {
    const r = parseShelves(JSON.stringify([{ title: 'Mine', source: { mdblist: { id: 3 } } }]))
    expect(r.ok && r.shelves[0]!.id.length).toBeGreaterThan(8)
    expect(r.ok && r.shelves[0]).toMatchObject({ enabled: true, style: 'poster' })
  })
})
