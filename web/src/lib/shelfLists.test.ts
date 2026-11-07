import { describe, expect, it } from 'vitest'
import { builtIn } from './shelfDefaults'
import { addSourceShelf, parseTraktList, sameSource, titleFromSlug, traktShelf } from './shelfLists'

describe('parseTraktList', () => {
  it('reads a list address, with or without the scheme, query and trailing slash', () => {
    expect(parseTraktList('https://trakt.tv/users/sam/lists/best-of-2024')).toEqual({ ok: true, user: 'sam', slug: 'best-of-2024' })
    expect(parseTraktList('trakt.tv/users/Sam.Lee/lists/best_of?sort=added,asc')).toEqual({ ok: true, user: 'Sam.Lee', slug: 'best_of' })
    expect(parseTraktList('  https://www.trakt.tv/users/sam/lists/horror/  ')).toEqual({ ok: true, user: 'sam', slug: 'horror' })
  })

  it('reads user and list typed with a slash', () => {
    expect(parseTraktList('sam/best-of-2024')).toEqual({ ok: true, user: 'sam', slug: 'best-of-2024' })
  })

  it('says what to do when it is not a list', () => {
    for (const bad of ['', 'sam', 'https://trakt.tv/movies/dune-2021', 'https://example.com/users/sam/lists/x', 'sam/ spaced', 'a/b/c', '-sam/list']) {
      const r = parseTraktList(bad)
      expect(r.ok).toBe(false)
      if (!r.ok) expect(r.error).toMatch(/Paste its address/)
    }
  })
})

describe('titleFromSlug', () => {
  it('reads a slug as a title', () => {
    expect(titleFromSlug('best-of-2024')).toBe('Best Of 2024')
    expect(titleFromSlug('feel_good_films')).toBe('Feel Good Films')
  })
})

describe('addSourceShelf', () => {
  const base = [builtIn('watchlist')]

  it('adds a list shelf at the end, on, as posters', () => {
    const next = addSourceShelf(base, ' Best Of ', traktShelf('sam', 'best-of'), 'x')
    expect(next).toHaveLength(2)
    expect(next[1]).toEqual({ id: 'x', title: 'Best Of', source: { kind: 'traktList', user: 'sam', slug: 'best-of' }, enabled: true, style: 'poster' })
  })

  it('does not add the same list twice, whatever the case of its name', () => {
    const once = addSourceShelf(base, 'Best Of', traktShelf('sam', 'best-of'), 'x')
    expect(addSourceShelf(once, 'Again', traktShelf('SAM', 'Best-Of'), 'y')).toEqual(once)
    expect(addSourceShelf(addSourceShelf(base, 'A', { kind: 'mdblist', id: 7 }, 'a'), 'B', { kind: 'mdblist', id: 7 }, 'b')).toHaveLength(2)
    expect(addSourceShelf(base, 'S', { kind: 'mediaServerLibrary', serverID: 's', libraryID: 'l' }, 'a')).toHaveLength(2)
  })

  it('tells lists apart by source', () => {
    expect(sameSource({ kind: 'mdblist', id: 1 }, { kind: 'mdblist', id: 2 })).toBe(false)
    expect(sameSource({ kind: 'mediaServerLibrary', serverID: 's', libraryID: '1' }, { kind: 'mediaServerLibrary', serverID: 's', libraryID: '1' })).toBe(true)
    expect(sameSource({ kind: 'builtIn', id: 'watchlist' }, { kind: 'builtIn', id: 'watchlist' })).toBe(false)
  })

  it('gives an untitled list a name rather than an empty row', () => {
    expect(addSourceShelf([], '  ', { kind: 'mdblist', id: 1 }, 'a')[0]?.title).toBe('List')
  })
})
