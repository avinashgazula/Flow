import { describe, expect, it } from 'vitest'
import { asMediaItem, buildIndex, lookup, normaliseTitle, titleKey } from './serverIndex'
import type { ServerTitle } from './types'

const t = (over: Partial<ServerTitle>): ServerTitle => ({ serverId: 's', itemId: 'i', type: 'movie', title: 'Title', ...over })

describe('what is on the servers', () => {
  const index = buildIndex([
    t({ itemId: '1', tmdb: 693134, title: 'Dune: Part Two' }),
    t({ itemId: '2', type: 'show', tmdb: 95396, title: 'Severance' }),
    t({ itemId: '3', title: 'Résident Évil', year: 2026 }),
    t({ itemId: '4', title: 'Home Movie' }),
    t({ itemId: '5', tmdb: 693134, title: 'Dune: Part Two' }),
  ])

  it('reduces every title to its TMDB id, or its name and year when it has none', () => {
    expect(index.movies).toEqual([693134])
    expect(index.shows).toEqual([95396])
    expect(index.titles).toEqual([titleKey('movie', 'Résident Évil', 2026), titleKey('movie', 'Home Movie')])
    expect(index.count).toBe(5)
  })

  it('answers by id first, and an id is for its own kind of title', () => {
    const on = lookup(index)
    expect(on({ type: 'movie', id: 693134, title: 'Anything' })).toBe(true)
    expect(on({ type: 'show', id: 693134, title: 'Anything' })).toBe(false)
    expect(on({ type: 'show', id: 95396, title: 'Severance' })).toBe(true)
    expect(on({ type: 'movie', id: 1, title: 'Not Here' })).toBe(false)
  })

  it('matches a title with no id by name, within a year, or by name alone when the server gives no year', () => {
    const on = lookup(index)
    expect(on({ type: 'movie', id: 9, title: 'Resident Evil', year: 2026 })).toBe(true)
    expect(on({ type: 'movie', id: 9, title: 'Resident Evil', year: 2025 })).toBe(true)
    expect(on({ type: 'movie', id: 9, title: 'Resident Evil', year: 2020 })).toBe(false)
    // The server gave "Home Movie" no year, so its name alone decides.
    expect(on({ type: 'movie', id: 9, title: 'home movie', year: 1999 })).toBe(true)
    expect(on({ type: 'movie', id: 9, title: 'Home Movie' })).toBe(true)
    expect(on({ type: 'show', id: 9, title: 'Resident Evil', year: 2026 })).toBe(false)
  })

  it('builds its answer once per index', () => {
    expect(lookup(index)).toBe(lookup(index))
  })

  it('names the servers that did not answer', () => {
    expect(buildIndex([], ['Den']).failed).toEqual(['Den'])
  })

  it('writes titles one way: accents, case, ampersands and punctuation', () => {
    expect(normaliseTitle('Amélie')).toBe('amelie')
    expect(normaliseTitle('Tom & Jerry: The Movie!')).toBe('tom and jerry the movie')
  })
})

describe('a server title as a card', () => {
  const title = t({ tmdb: 5, title: 'Server Name', year: 2020, overview: 'From the server.', poster: 'https://s/p.jpg', backdrop: 'https://s/b.jpg' })
  const tmdb = { type: 'movie' as const, id: 5, title: 'TMDB Name', overview: '', genres: [], poster: '/tmdb-p.jpg', backdrop: '/tmdb-b.jpg', rating: 8.1 }

  it('has no card without a TMDB id, since its page could not open', () => {
    expect(asMediaItem(t({ title: 'No id' }))).toBeUndefined()
  })

  it('shows the server’s own picture and text until TMDB has been read', () => {
    expect(asMediaItem(title)).toMatchObject({ id: 5, title: 'Server Name', poster: 'https://s/p.jpg', year: 2020 })
  })

  it('keeps TMDB’s pictures and facts once read, unless Use Server Artwork is on', () => {
    expect(asMediaItem(title, tmdb)).toMatchObject({ title: 'TMDB Name', poster: '/tmdb-p.jpg', backdrop: '/tmdb-b.jpg', rating: 8.1 })
    expect(asMediaItem(title, tmdb, true)).toMatchObject({ title: 'TMDB Name', poster: 'https://s/p.jpg', backdrop: 'https://s/b.jpg', rating: 8.1 })
    // A server with no picture of its own leaves TMDB's.
    expect(asMediaItem(t({ tmdb: 5 }), tmdb, true)).toMatchObject({ poster: '/tmdb-p.jpg' })
  })
})
