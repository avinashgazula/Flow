import { describe, expect, it } from 'vitest'
import { createMDBListClient, listBody, readHistory, readPlayback, readWatchedShows, readWatchlist, tmdbOf } from './mdblist'

/* MDBList's Trakt-shaped answers, in the shapes FlowKit's KeyedSyncClient accepts, and the requests the page makes. */

const at = (iso: string) => Date.parse(iso)

describe('reading MDBList’s answers', () => {
  it('finds a TMDB id in each shape', () => {
    expect(tmdbOf({ ids: { tmdb: 5 } })).toBe(5)
    expect(tmdbOf({ tmdb: 6 })).toBe(6)
    expect(tmdbOf({ tmdb_id: '7' })).toBe(7)
    expect(tmdbOf({ id: 8 })).toBe(8)
    expect(tmdbOf({ ids: { imdb: 'tt1' } })).toBeUndefined()
    expect(tmdbOf(null)).toBeUndefined()
  })

  it('reads the watchlist as a list of rows or as movies and shows', () => {
    const rows = [
      { mediatype: 'movie', watchlist_at: '2026-10-02T00:00:00Z', movie: { title: 'Dune', ids: { tmdb: 2 } } },
      { type: 'show', listed_at: '2026-10-03T00:00:00Z', show: { title: 'Severance', ids: { tmdb: 3 } } },
      { mediatype: 'show', id: 4, title: 'Flat', added_at: '2026-10-04T00:00:00Z' },
    ]
    expect(readWatchlist(rows).map((e) => [e.type, e.tmdb, e.title, e.at])).toEqual([
      ['movie', 2, 'Dune', at('2026-10-02T00:00:00Z')],
      ['show', 3, 'Severance', at('2026-10-03T00:00:00Z')],
      ['show', 4, 'Flat', at('2026-10-04T00:00:00Z')],
    ])
    expect(readWatchlist({ movies: [{ movie: { title: 'A', ids: { tmdb: 1 } } }], shows: [{ show: { title: 'B', ids: { tmdb: 2 } } }] }).map((e) => `${e.type}:${e.tmdb}`)).toEqual(['movie:1', 'show:2'])
    expect(readWatchlist(null)).toEqual([])
  })

  it('reads the history: a row without a type is a film, and an episode’s show may be nested', () => {
    const body = [
      { watched_at: '2026-10-01T00:00:00Z', movie: { title: 'Dune', ids: { tmdb: 2 } } },
      { type: 'episode', watched_at: '2026-10-02T00:00:00Z', show: { title: 'Severance', ids: { tmdb: 3 } }, episode: { season: 1, number: 2 } },
      { type: 'episode', watched_at: '2026-10-03T00:00:00Z', episode: { season: 2, number: 1, show: { title: 'Nested', ids: { tmdb: 4 } } } },
      { type: 'episode', show: { ids: { tmdb: 3 } } },
    ]
    expect(readHistory(body).map((w) => [w.type, w.tmdb, w.season, w.episode])).toEqual([
      ['movie', 2, undefined, undefined],
      ['show', 3, 1, 2],
      ['show', 4, 2, 1],
    ])
  })

  it('reads watched shows from seasons and from a flat list of episodes', () => {
    const out = readWatchedShows({
      movies: [{ movie: { ids: { tmdb: 1 } } }],
      shows: [{ last_watched_at: '2026-10-05T00:00:00Z', show: { title: 'Severance', ids: { tmdb: 3 } }, seasons: [{ number: 1, episodes: [{ number: 1 }, { number: 2, last_watched_at: '2026-10-06T00:00:00Z' }] }] }],
      episodes: [{ watched_at: '2026-10-07T00:00:00Z', show: { title: 'Severance', ids: { tmdb: 3 } }, episode: { season: 1, number: 3 } }],
    })
    expect(out).toHaveLength(1)
    expect(out[0]!.episodes.map((e) => [e.season, e.episode, e.at])).toEqual([
      [1, 1, at('2026-10-05T00:00:00Z')],
      [1, 2, at('2026-10-06T00:00:00Z')],
      [1, 3, at('2026-10-07T00:00:00Z')],
    ])
  })

  it('reads resume points from a list or from {playback: []}', () => {
    const row = { id: 7, progress: 33, paused_at: '2026-10-06T00:00:00Z', type: 'episode', show: { title: 'Severance', ids: { tmdb: 3 } }, episode: { season: 1, number: 2 } }
    expect(readPlayback([row]).map((r) => [r.id, r.tmdb, r.season, r.episode, r.percent])).toEqual([[7, 3, 1, 2, 33]])
    expect(readPlayback({ playback: [row] })).toHaveLength(1)
    expect(readPlayback([{ ...row, id: undefined }])).toEqual([])
  })

  it('names a title by its TMDB id alone for the watchlist calls', () => {
    expect(listBody([{ type: 'movie', id: 1 }, { type: 'show', id: 2 }])).toEqual({ movies: [{ tmdb: 1 }], shows: [{ tmdb: 2 }] })
  })
})

interface Seen {
  url: URL
  init: RequestInit
}
function client(answer: (seen: Seen) => Response | 'offline', key = 'secret-key') {
  const seen: Seen[] = []
  const fetcher = (async (url: string, init: RequestInit) => {
    const s = { url: new URL(url), init }
    seen.push(s)
    const out = answer(s)
    if (out === 'offline') throw new TypeError('Failed to fetch')
    return out
  }) as typeof fetch
  return { seen, api: createMDBListClient(() => key, fetcher) }
}
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status })

describe('requests', () => {
  it('puts the key in the address and sends a GET with no headers at all, so the browser needs no preflight', async () => {
    const { seen, api } = client(() => json([]))
    await api.history(50)
    expect(seen[0]!.url.href).toBe('https://api.mdblist.com/sync/history?apikey=secret-key&limit=50')
    expect(seen[0]!.init.headers).toBeUndefined()
  })

  it('sends a POST as text/plain with the JSON in the body, which is also a simple request', async () => {
    const { seen, api } = client(() => json({}, 201))
    await api.addHistory([{ type: 'movie', id: 1, at: '2026-10-01T00:00:00Z' }])
    expect(seen[0]!.init.method).toBe('POST')
    expect(seen[0]!.init.headers).toEqual({ 'Content-Type': 'text/plain;charset=UTF-8' })
    expect(JSON.parse(String(seen[0]!.init.body))).toEqual({ movies: [{ ids: { tmdb: 1 }, watched_at: '2026-10-01T00:00:00Z' }] })
    expect(seen[0]!.url.pathname).toBe('/sync/watched')
  })

  it('keeps no scores of its own: a rating goes nowhere', async () => {
    const { seen, api } = client(() => json({}))
    await api.rate([{ type: 'movie', id: 1, rating: 8 }])
    await api.unrate([{ type: 'movie', id: 1 }])
    expect(seen).toEqual([])
  })

  it('says in words what went wrong, never with the key in them', async () => {
    const say = async (status: number | 'offline', key = 'secret-key') => {
      const { api } = client(() => (status === 'offline' ? 'offline' : new Response('{}', { status })), key)
      return api.watchlist().catch((e: Error & { kind?: string }) => `${e.kind}: ${e.message}`)
    }
    expect(await say(401)).toBe('client-id: MDBList didn’t accept this key. Check it in Settings → Account.')
    expect(await say(403)).toBe('client-id: MDBList didn’t accept this key. Check it in Settings → Account.')
    expect(await say(429)).toBe('rate: MDBList is busy. Marquee will try again in a moment.')
    expect(await say(502)).toBe('server: MDBList had a problem (502). Marquee will try again in a moment.')
    expect(await say(400)).toBe('rejected: MDBList didn’t accept that update (400).')
    expect(await say('offline')).toBe('network: Couldn’t reach MDBList. Check your connection.')
    expect(await say(200, ' ')).toBe('client-id: Add an MDBList API key in Settings → Metadata first.')
    const { api } = client(() => new Response('{}', { status: 415 }))
    const refused = await api.addToWatchlist([{ type: 'movie', id: 1 }]).catch((e: Error) => e.message)
    expect(refused).toMatch(/won’t take updates sent from a web page/)
    expect(refused).not.toContain('secret-key')
  })

  it('reads who the key belongs to', async () => {
    expect(await client(() => json({ username: 'avi' })).api.profile()).toBe('avi')
    expect(await client(() => json({ name: 'Avi' })).api.profile()).toBe('Avi')
    expect(await client(() => json({})).api.profile()).toBeUndefined()
  })
})
