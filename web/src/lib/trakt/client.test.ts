import { describe, expect, it } from 'vitest'
import { createClient, readComments, readHistory, readPlayback, readWatchedShows, readWatchlist, scrobbleBody, syncBody, TraktError, words } from './client'

interface Seen {
  method: string
  url: string
  headers: Record<string, string>
  body?: unknown
  keepalive?: boolean
}

/** A Trakt that answers from a list, in order, and keeps every request. */
function fakeTrakt(...answers: ({ status: number; json?: unknown } | 'offline')[]) {
  const seen: Seen[] = []
  const fetcher = (async (url: string, init: RequestInit) => {
    seen.push({ method: init.method ?? 'GET', url, headers: init.headers as Record<string, string>, body: init.body ? JSON.parse(String(init.body)) : undefined, keepalive: init.keepalive })
    const a = answers[Math.min(seen.length - 1, answers.length - 1)]!
    if (a === 'offline') throw new TypeError('Failed to fetch')
    return new Response(a.json === undefined ? null : JSON.stringify(a.json), { status: a.status })
  }) as unknown as typeof fetch
  return { seen, fetcher }
}

const signedIn = (tokens: (string | null)[] = ['tok']) => {
  const asked: boolean[] = []
  return {
    asked,
    clientID: () => 'cid',
    accessToken: async (force?: boolean) => {
      asked.push(!!force)
      return tokens[Math.min(asked.length - 1, tokens.length - 1)] ?? null
    },
  }
}

describe('request bodies', () => {
  it('names movies by TMDB id and groups episodes by show and season', () => {
    const body = syncBody([
      { type: 'movie', id: 10, at: '2026-10-24T10:00:00Z' },
      { type: 'show', id: 20, season: 2, episode: 3, at: '2026-10-24T11:00:00Z' },
      { type: 'show', id: 20, season: 1, episode: 9 },
      { type: 'show', id: 20, season: 2, episode: 1 },
      { type: 'show', id: 30 },
    ])
    expect(body).toEqual({
      movies: [{ ids: { tmdb: 10 }, watched_at: '2026-10-24T10:00:00Z' }],
      shows: [
        { ids: { tmdb: 30 } },
        { ids: { tmdb: 20 }, seasons: [{ number: 1, episodes: [{ number: 9 }] }, { number: 2, episodes: [{ number: 1 }, { number: 3, watched_at: '2026-10-24T11:00:00Z' }] }] },
      ],
    })
    expect(syncBody([])).toEqual({})
    expect(syncBody([{ type: 'show', id: 5, rating: 8 }])).toEqual({ shows: [{ ids: { tmdb: 5 }, rating: 8 }] })
  })

  it('builds a scrobble for a movie or an episode, with progress held between 0 and 100', () => {
    expect(scrobbleBody({ type: 'movie', id: 7 }, 42.123456)).toEqual({ movie: { ids: { tmdb: 7 } }, progress: 42.12 })
    expect(scrobbleBody({ type: 'show', id: 7, season: 1, episode: 2 }, 130)).toEqual({ show: { ids: { tmdb: 7 } }, episode: { season: 1, number: 2 }, progress: 100 })
    expect(scrobbleBody({ type: 'movie', id: 7 }, -4).progress).toBe(0)
  })
})

describe('reading what Trakt sends', () => {
  it('reads the watchlist and skips what has no TMDB id or is not a movie or show', () => {
    const list = readWatchlist([
      { type: 'movie', listed_at: '2026-10-01T00:00:00.000Z', movie: { title: 'Dune', year: 2021, ids: { tmdb: 438631 } } },
      { type: 'show', listed_at: '2026-10-02T00:00:00.000Z', show: { title: 'Severance', year: 2022, ids: { tmdb: 95396 } } },
      { type: 'movie', movie: { title: 'No TMDB', ids: { trakt: 1 } } },
      { type: 'season', show: { title: 'x', ids: { tmdb: 1 } } },
    ])
    expect(list).toEqual([
      { type: 'movie', tmdb: 438631, title: 'Dune', year: 2021, at: Date.parse('2026-10-01T00:00:00Z') },
      { type: 'show', tmdb: 95396, title: 'Severance', year: 2022, at: Date.parse('2026-10-02T00:00:00Z') },
    ])
    expect(readWatchlist({ not: 'a list' })).toEqual([])
  })

  it('reads history for movies and episodes', () => {
    const rows = readHistory([
      { type: 'movie', watched_at: '2026-10-03T20:00:00.000Z', movie: { title: 'Dune', ids: { tmdb: 1 } } },
      { type: 'episode', watched_at: '2026-10-03T21:00:00.000Z', episode: { season: 2, number: 5 }, show: { title: 'Severance', ids: { tmdb: 2 } } },
      { type: 'episode', watched_at: '2026-10-03T21:00:00.000Z', show: { title: 'No episode', ids: { tmdb: 3 } } },
    ])
    expect(rows.map((r) => [r.type, r.tmdb, r.season, r.episode])).toEqual([['movie', 1, undefined, undefined], ['show', 2, 2, 5]])
  })

  it('reads watched episodes by show, season and episode with their times', () => {
    const [show] = readWatchedShows([
      { last_watched_at: '2026-10-05T00:00:00.000Z', show: { title: 'Severance', ids: { tmdb: 2 } }, seasons: [{ number: 1, episodes: [{ number: 1, last_watched_at: '2026-10-04T00:00:00.000Z' }, { number: 2 }] }] },
    ])
    expect(show!.episodes).toEqual([
      { season: 1, episode: 1, at: Date.parse('2026-10-04T00:00:00Z') },
      { season: 1, episode: 2, at: Date.parse('2026-10-05T00:00:00Z') },
    ])
  })

  it('reads resume points with their ids and runtimes', () => {
    const [movie, episode] = readPlayback([
      { id: 11, progress: 42.5, paused_at: '2026-10-06T00:00:00.000Z', type: 'movie', movie: { title: 'Dune', runtime: 155, ids: { tmdb: 1 } } },
      { id: 12, progress: 10, paused_at: '2026-10-07T00:00:00.000Z', type: 'episode', episode: { season: 1, number: 3, title: 'Third', runtime: 50 }, show: { title: 'Severance', ids: { tmdb: 2 } } },
    ])
    expect(movie).toMatchObject({ id: 11, type: 'movie', tmdb: 1, percent: 42.5, runtimeMinutes: 155 })
    expect(episode).toMatchObject({ id: 12, type: 'show', tmdb: 2, season: 1, episode: 3, episodeTitle: 'Third', runtimeMinutes: 50 })
  })
})

describe('requests', () => {
  it('sends the client id, the API version and the token, and reads the profile', async () => {
    const trakt = fakeTrakt({ status: 200, json: { user: { username: 'avi', name: 'Avi' } } })
    const profile = await createClient(signedIn(), trakt.fetcher).profile()
    expect(profile).toEqual({ username: 'avi', name: 'Avi' })
    expect(trakt.seen[0]).toMatchObject({ method: 'GET', url: 'https://api.trakt.tv/users/settings', headers: { 'trakt-api-key': 'cid', 'trakt-api-version': '2', Authorization: 'Bearer tok' } })
  })

  it('adds only what is asked of a query', async () => {
    const trakt = fakeTrakt({ status: 200, json: [] })
    await createClient(signedIn(), trakt.fetcher).history(500, '2026-10-01T00:00:00Z')
    expect(trakt.seen[0]!.url).toBe('https://api.trakt.tv/sync/history?limit=500&start_at=2026-10-01T00%3A00%3A00Z')
    await createClient(signedIn(), trakt.fetcher).history(50)
    expect(trakt.seen[1]!.url).toBe('https://api.trakt.tv/sync/history?limit=50')
  })

  it('asks for a fresh token once when Trakt refuses the one it has, then repeats the request', async () => {
    const trakt = fakeTrakt({ status: 401 }, { status: 200, json: [] })
    const auth = signedIn(['stale', 'fresh'])
    await createClient(auth, trakt.fetcher).watchlist()
    expect(auth.asked).toEqual([false, true])
    expect(trakt.seen.map((s) => s.headers.Authorization)).toEqual(['Bearer stale', 'Bearer fresh'])
  })

  it('says to sign in again when the token is refused twice, or there is none', async () => {
    const refused = createClient(signedIn(['a', 'b']), fakeTrakt({ status: 401 }).fetcher).watchlist()
    await expect(refused).rejects.toMatchObject({ kind: 'signed-out', message: words.signedOut })
    const nobody = createClient(signedIn([null]), fakeTrakt().fetcher).watchlist()
    await expect(nobody).rejects.toMatchObject({ kind: 'signed-out' })
  })

  it('says the client id was not accepted on a 403, and sends nothing without one', async () => {
    await expect(createClient(signedIn(), fakeTrakt({ status: 403 }).fetcher).watchlist()).rejects.toMatchObject({ kind: 'client-id', message: 'Trakt didn’t accept this app’s client ID. Check it in Settings → Account.' })
    const none = fakeTrakt()
    await expect(createClient({ ...signedIn(), clientID: () => '' }, none.fetcher).watchlist()).rejects.toMatchObject({ kind: 'client-id' })
    expect(none.seen).toEqual([])
  })

  it('checks a client id on a public list with no sign-in', async () => {
    const trakt = fakeTrakt({ status: 200, json: [] })
    const auth = signedIn()
    await createClient(auth, trakt.fetcher).checkClientID()
    expect(trakt.seen[0]!.headers.Authorization).toBeUndefined()
    expect(auth.asked).toEqual([])
    await expect(createClient(signedIn(), fakeTrakt({ status: 403 }).fetcher).checkClientID()).rejects.toMatchObject({ kind: 'client-id' })
  })

  it('tells a busy Trakt, an outage and no connection apart', async () => {
    await expect(createClient(signedIn(), fakeTrakt({ status: 429 }).fetcher).watchlist()).rejects.toMatchObject({ kind: 'rate' })
    await expect(createClient(signedIn(), fakeTrakt({ status: 503 }).fetcher).watchlist()).rejects.toMatchObject({ kind: 'server', message: expect.stringContaining('503') })
    await expect(createClient(signedIn(), fakeTrakt('offline').fetcher).watchlist()).rejects.toMatchObject({ kind: 'network', message: words.network })
    await expect(createClient(signedIn(), fakeTrakt({ status: 420 }).fetcher).watchlist()).rejects.toBeInstanceOf(TraktError)
  })

  it('posts a scrobble with progress, keeps the page’s keepalive, and counts 409 as done', async () => {
    const trakt = fakeTrakt({ status: 201, json: {} }, { status: 409, json: {} })
    const client = createClient(signedIn(), trakt.fetcher)
    await client.scrobble('pause', { type: 'show', id: 2, season: 1, episode: 4 }, 37.5, true)
    expect(trakt.seen[0]).toMatchObject({ method: 'POST', url: 'https://api.trakt.tv/scrobble/pause', keepalive: true, body: { show: { ids: { tmdb: 2 } }, episode: { season: 1, number: 4 }, progress: 37.5 } })
    await expect(client.scrobble('stop', { type: 'movie', id: 1 }, 90)).resolves.toBeUndefined()
  })

  it('sends watchlist, history, playback and rating changes to their endpoints', async () => {
    const trakt = fakeTrakt({ status: 201, json: {} })
    const client = createClient(signedIn(), trakt.fetcher)
    await client.addToWatchlist([{ type: 'movie', id: 1 }])
    await client.removeFromWatchlist([{ type: 'show', id: 2 }])
    await client.addHistory([{ type: 'movie', id: 1, at: '2026-10-24T00:00:00Z' }])
    await client.removeHistory([{ type: 'movie', id: 1 }])
    await client.deletePlayback(99)
    await client.rate([{ type: 'movie', id: 1, rating: 9 }])
    await client.unrate([{ type: 'movie', id: 1 }])
    expect(trakt.seen.map((s) => `${s.method} ${s.url.replace('https://api.trakt.tv', '')}`)).toEqual([
      'POST /sync/watchlist',
      'POST /sync/watchlist/remove',
      'POST /sync/history',
      'POST /sync/history/remove',
      'DELETE /sync/playback/99',
      'POST /sync/ratings',
      'POST /sync/ratings/remove',
    ])
    expect(trakt.seen[5]!.body).toEqual({ movies: [{ ids: { tmdb: 1 }, rating: 9 }] })
  })
})

describe('comments', () => {
  const body = [
    { id: 1, comment: '**Great** &amp; moving', spoiler: false, created_at: '2026-10-01T10:00:00.000Z', user: { username: 'sam' }, user_stats: { rating: 9 } },
    { id: 2, comment: 'He dies at the end.', spoiler: true, user: {}, user_rating: 4.6 },
    { id: 3, comment: '   ', user: { username: 'blank' } },
  ]

  it('reads them as reviews, cleaned, with the spoiler flag and the score out of 10', () => {
    expect(readComments(body)).toEqual([
      { id: 'trakt:1', source: 'trakt', author: 'sam', text: 'Great & moving', rating: 9, date: Date.parse('2026-10-01T10:00:00.000Z'), spoiler: false },
      { id: 'trakt:2', source: 'trakt', author: 'Anonymous', text: 'He dies at the end.', rating: 5, spoiler: true },
    ])
  })

  it('asks for the most-liked comments without a sign-in, naming the title the way Trakt’s paths do', async () => {
    const trakt = fakeTrakt({ status: 200, json: body })
    const out = await createClient({ clientID: () => 'cid', accessToken: async () => null }, trakt.fetcher).comments('movie', 'tt0816692')
    expect(out).toHaveLength(2)
    expect(trakt.seen[0]!.url).toBe('https://api.trakt.tv/movies/tt0816692/comments/likes?limit=10')
    expect(trakt.seen[0]!.headers.Authorization).toBeUndefined()
  })
})
