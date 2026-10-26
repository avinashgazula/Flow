import { beforeEach, describe, expect, it } from 'vitest'
import { settingsStore } from '../store/settings'
import { checkMDBListKey, mdblistRatings, mergeRatings, parseRatings, RatingsError, traktRating } from './mdblist'
import { demoRatings, loadRatings } from './load'
import { posterOf, rpdbPoster } from './posters'
import { isDefaultSources, moveSource, orderedSources, ratingLink, ratingSources, scoreText, shownSources, spokenScore, toggleSource } from './sources'

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
const stub = (fn: (url: string, init?: RequestInit) => Response | Promise<Response>) => fn as unknown as typeof fetch

/** What MDBList answers for a film, in the shape its `ratings` list has. */
const mdblist = {
  title: 'Dune: Part Two',
  ratings: [
    { source: 'imdb', value: 8.5, score: 85, votes: 640000 },
    { source: 'tomatoes', value: 92.6, score: 93 },
    { source: 'popcorn', value: null, score: 95 },
    { source: 'metacritic', value: 79, score: 79 },
    { source: 'tmdb', value: 83, score: 83 },
    { source: 'letterboxd', value: 4.3, score: 86 },
    { source: 'trakt', value: 88, score: 88 },
    { source: 'rogerebert', value: 4, score: 80 },
    { source: 'imdb' },
  ],
}

describe('reading MDBList', () => {
  it('turns its ratings list into scores on each site’s own scale', () => {
    expect(parseRatings(mdblist)).toEqual({ imdb: 8.5, imdbVotes: 640000, tomatometer: 92, popcornmeter: 95, metacritic: 79, tmdb: 8.3, letterboxd: 4.3, trakt: 88 })
  })

  it('takes the value, truncated, or else the 0-100 score, for the whole-number sources', () => {
    expect(parseRatings({ ratings: [{ source: 'tomatoes', value: 99.9 }, { source: 'audience', score: 71 }, { source: 'trakt', value: null, score: 64 }] })).toEqual({ tomatometer: 99, popcornmeter: 71, trakt: 64 })
  })

  it('reads a TMDB score given out of 10 as it is, and out of 100 as a tenth', () => {
    expect(parseRatings({ ratings: [{ source: 'tmdb', value: 7.4 }] }).tmdb).toBe(7.4)
    expect(parseRatings({ ratings: [{ source: 'tmdb', value: 74 }] }).tmdb).toBe(7.4)
  })

  it('survives an answer that is not a ratings list', () => {
    for (const body of [null, 3, 'x', [], {}, { ratings: 'no' }, { ratings: [null, 1, 'x'] }]) expect(parseRatings(body)).toEqual({})
  })

  it('fills what MDBList lacks from the other scores, and never overwrites its own', () => {
    expect(mergeRatings({ imdb: 8.1 }, { imdb: 7, tmdb: 7.9 })).toEqual({ imdb: 8.1, tmdb: 7.9 })
    expect(mergeRatings({}, { tmdb: 7.9 })).toEqual({ tmdb: 7.9 })
    expect(mergeRatings({ imdb: undefined }, { imdb: 7 })).toEqual({ imdb: 7 })
  })
})

describe('asking MDBList', () => {
  it('asks by TMDB id with the key in the address, and reads the answer', async () => {
    const seen: string[] = []
    const fetchImpl = stub((url) => (seen.push(url), json(mdblist)))
    const ratings = await mdblistRatings('show', 1396, 'k e/y', { fetchImpl })
    expect(seen).toEqual(['https://api.mdblist.com/tmdb/show/1396?apikey=k%20e%2Fy'])
    expect(ratings.imdb).toBe(8.5)
    await mdblistRatings('movie', 693134, 'k', { fetchImpl })
    expect(seen[1]).toBe('https://api.mdblist.com/tmdb/movie/693134?apikey=k')
  })

  it('reads a title it does not know as no scores', async () => {
    expect(await mdblistRatings('movie', 1, 'k', { fetchImpl: stub(() => json({ error: 'nope' }, 404)) })).toEqual({})
  })

  it('says what to do about a refused key, a spent allowance and an unreachable service, without the key', async () => {
    const asks = (status: number) => mdblistRatings('movie', 1, 'secret-key', { fetchImpl: stub(() => json({ error: 'x' }, status)) })
    await expect(asks(401)).rejects.toThrow('didn’t accept that API key')
    await expect(asks(429)).rejects.toThrow('no requests left')
    await expect(asks(500)).rejects.toThrow('answered 500')
    const offline = mdblistRatings('movie', 1, 'secret-key', {
      fetchImpl: stub(() => {
        throw new TypeError('Failed to fetch')
      }),
    })
    await expect(offline).rejects.toBeInstanceOf(RatingsError)
    await expect(offline).rejects.not.toThrow(/secret-key/)
  })

  it('checks a key against the account call', async () => {
    const seen: string[] = []
    const ok = stub((url) => (seen.push(url), json({ user_id: 1 })))
    expect(await checkMDBListKey(' abc ', { fetchImpl: ok })).toEqual({ ok: true })
    expect(seen[0]).toBe('https://api.mdblist.com/user?apikey=abc')
    expect(await checkMDBListKey('', { fetchImpl: ok })).toMatchObject({ ok: false })
    expect(await checkMDBListKey('bad', { fetchImpl: stub(() => json({}, 401)) })).toMatchObject({ ok: false, error: expect.stringContaining('didn’t accept') })
  })

  it('reads Trakt’s community score as a percentage', async () => {
    const seen: [string, HeadersInit | undefined][] = []
    const fetchImpl = stub((url, init) => (seen.push([url, init?.headers]), json({ rating: 8.2345 })))
    expect(await traktRating('movie', 'tt15239678', 'cid', { fetchImpl })).toBe(82)
    expect(seen[0]![0]).toBe('https://api.trakt.tv/movies/tt15239678/ratings')
    expect(seen[0]![1]).toMatchObject({ 'trakt-api-key': 'cid' })
    expect(await traktRating('show', 'tt1', 'cid', { fetchImpl: stub(() => json({ rating: 0 })) })).toBeUndefined()
    expect(await traktRating('show', 'tt1', 'cid', { fetchImpl: stub(() => json({}, 403)) })).toBeUndefined()
  })
})

describe('the row', () => {
  it('prints each score as its site does', () => {
    const r = { imdb: 8.46, tomatometer: 92, popcornmeter: 95, metacritic: 79.4, tmdb: 8.3, letterboxd: 4.3, trakt: 88 }
    expect(ratingSources.map((s) => scoreText(s, r))).toEqual(['8.5', '92%', '95%', '79', '8.3', '4.3', '88%'])
  })

  it('has nothing to print for a missing score, or a TMDB score of zero', () => {
    expect(scoreText('imdb', {})).toBeUndefined()
    expect(scoreText('tmdb', { tmdb: 0 })).toBeUndefined()
    expect(scoreText('trakt', { trakt: Number.NaN })).toBeUndefined()
  })

  it('says the scale aloud', () => {
    expect(spokenScore('metacritic', '78')).toBe('Metacritic, 78 out of 100')
    expect(spokenScore('imdb', '8.5')).toBe('IMDb, 8.5 out of 10')
    expect(spokenScore('letterboxd', '4.3')).toBe('Letterboxd, 4.3 out of 5')
    expect(spokenScore('tomatometer', '92%')).toBe('Rotten Tomatoes critics, 92 percent')
    expect(spokenScore('popcornmeter', '95%')).toBe('Rotten Tomatoes audience, 95 percent')
    expect(spokenScore('trakt', '88%')).toBe('Trakt, 88 percent')
  })

  it('shows every source in the apps’ order unless a list is saved, and ignores names it does not know', () => {
    expect(shownSources(undefined)).toEqual(['imdb', 'tomatometer', 'popcornmeter', 'metacritic', 'tmdb', 'letterboxd', 'trakt'])
    expect(shownSources(['trakt', 'mal', 'imdb', 'trakt', 3])).toEqual(['trakt', 'imdb'])
    expect(shownSources([])).toEqual([])
  })
})

describe('choosing and ordering the scores', () => {
  it('lists the shown ones first, then the hidden ones in the apps’ order', () => {
    expect(orderedSources(['trakt', 'imdb'])).toEqual(['trakt', 'imdb', 'tomatometer', 'popcornmeter', 'metacritic', 'tmdb', 'letterboxd'])
    expect(orderedSources([])).toEqual([...ratingSources])
  })

  it('moves a shown score one place, and stays put at the ends or when hidden', () => {
    expect(moveSource(['imdb', 'trakt', 'tmdb'], 'trakt', -1)).toEqual(['trakt', 'imdb', 'tmdb'])
    expect(moveSource(['imdb', 'trakt', 'tmdb'], 'trakt', 1)).toEqual(['imdb', 'tmdb', 'trakt'])
    expect(moveSource(['imdb', 'trakt'], 'imdb', -1)).toEqual(['imdb', 'trakt'])
    expect(moveSource(['imdb', 'trakt'], 'trakt', 1)).toEqual(['imdb', 'trakt'])
    expect(moveSource(['imdb'], 'tmdb', 1)).toEqual(['imdb'])
  })

  it('hides a shown score and adds a hidden one at the end', () => {
    expect(toggleSource(['imdb', 'trakt'], 'imdb')).toEqual(['trakt'])
    expect(toggleSource(['imdb', 'trakt'], 'tmdb')).toEqual(['imdb', 'trakt', 'tmdb'])
  })

  it('knows the default', () => {
    expect(isDefaultSources([...ratingSources])).toBe(true)
    expect(isDefaultSources(['imdb'])).toBe(false)
    expect(isDefaultSources([...ratingSources].reverse())).toBe(false)
  })
})

describe('where a score leads', () => {
  const dune = { type: 'movie' as const, title: 'Dune: Part Two', tmdb: 693134, imdb: 'tt15239678' }

  it('names the site’s own page for the title', () => {
    expect(ratingLink('imdb', dune)).toBe('https://www.imdb.com/title/tt15239678/reviews')
    expect(ratingLink('tomatometer', dune)).toBe('https://www.rottentomatoes.com/search?search=Dune%3A%20Part%20Two')
    expect(ratingLink('popcornmeter', dune)).toBe(ratingLink('tomatometer', dune))
    expect(ratingLink('metacritic', dune)).toBe('https://www.metacritic.com/search/Dune%3A%20Part%20Two/')
    expect(ratingLink('tmdb', dune)).toBe('https://www.themoviedb.org/movie/693134/reviews')
    expect(ratingLink('letterboxd', dune)).toBe('https://letterboxd.com/imdb/tt15239678/')
    expect(ratingLink('trakt', dune)).toBe('https://trakt.tv/search/imdb/tt15239678')
  })

  it('has no link where the site can’t be reached from what is known', () => {
    const show = { type: 'show' as const, title: 'Breaking Bad', tmdb: 1396 }
    expect(ratingLink('imdb', show)).toBeUndefined()
    expect(ratingLink('trakt', show)).toBeUndefined()
    expect(ratingLink('letterboxd', { ...show, imdb: 'tt0903747' })).toBeUndefined()
    expect(ratingLink('tmdb', show)).toBe('https://www.themoviedb.org/tv/1396/reviews')
    expect(ratingLink('tmdb', { type: 'movie', title: 'x' })).toBeUndefined()
  })
})

describe('rated posters', () => {
  it('lead with the IMDb id and fall back to the TMDB id, which lists carry', () => {
    expect(rpdbPoster('key', { type: 'movie', id: 693134, imdb: 'tt15239678' })).toBe('https://api.ratingposterdb.com/key/imdb/poster-default/tt15239678.jpg?fallback=true')
    expect(rpdbPoster('key', { type: 'movie', id: 693134 })).toBe('https://api.ratingposterdb.com/key/tmdb/poster-default/movie-693134.jpg?fallback=true')
    expect(rpdbPoster(' k/1 ', { type: 'show', id: 1396 })).toBe('https://api.ratingposterdb.com/k%2F1/tmdb/poster-default/series-1396.jpg?fallback=true')
  })

  it('need a key', () => {
    expect(rpdbPoster(undefined, { type: 'movie', id: 1 })).toBeUndefined()
    expect(rpdbPoster('  ', { type: 'movie', id: 1 })).toBeUndefined()
  })

  describe('as a card shows them', () => {
    beforeEach(() => settingsStore.set({ demo: false, rpdbKey: undefined, posterEnhancement: undefined }))
    const item = { type: 'movie' as const, id: 7, poster: '/p.jpg' }

    it('are off unless chosen, and the plain TMDB path is kept', () => {
      expect(posterOf(item)).toBe('/p.jpg')
      settingsStore.set({ rpdbKey: 'k' })
      expect(posterOf(item)).toBe('/p.jpg')
      settingsStore.set({ posterEnhancement: 'off' })
      expect(posterOf(item)).toBe('/p.jpg')
    })

    it('swap the address once on with a key, and only for titles that have a poster', () => {
      settingsStore.set({ rpdbKey: 'k', posterEnhancement: 'rpdb' })
      expect(posterOf(item)).toBe('https://api.ratingposterdb.com/k/tmdb/poster-default/movie-7.jpg?fallback=true')
      expect(posterOf({ ...item, poster: undefined })).toBeUndefined()
      settingsStore.set({ rpdbKey: '' })
      expect(posterOf(item)).toBe('/p.jpg')
    })

    it('leave the sample catalogue’s posters alone', () => {
      settingsStore.set({ rpdbKey: 'k', posterEnhancement: 'rpdb', demo: true })
      expect(posterOf(item)).toBe('/p.jpg')
    })
  })
})

describe('a title page’s scores', () => {
  beforeEach(() => settingsStore.set({ demo: false, mdblistKey: undefined, traktClientID: '' }))
  const d = { type: 'movie' as const, id: 693134, imdb: 'tt15239678', rating: 8.1, voteCount: 5400 }

  it('are TMDB’s own score alone without a key', async () => {
    expect(await loadRatings(d)).toEqual({ tmdb: 8.1, tmdbVotes: 5400 })
  })

  it('come from the sample catalogue in sample mode, the same every time', async () => {
    settingsStore.set({ demo: true })
    const first = await loadRatings(d)
    expect(first).toEqual(await loadRatings(d))
    expect(first).toMatchObject({ imdb: 8.3, tomatometer: 89, popcornmeter: 87, metacritic: 77, letterboxd: 4.1, trakt: 81 })
  })

  it('follow the apps’ formulas for the sample scores', () => {
    expect(demoRatings(9.9)).toMatchObject({ imdb: 9.6, tomatometer: 99, popcornmeter: 98, metacritic: 95 })
  })
})
