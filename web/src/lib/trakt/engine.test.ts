import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { MediaItem } from '../tmdb/types'

/* The library sync against a fake Trakt: what comes down on sign-in, what goes up as the library changes, and
   what happens when Trakt can't be reached. Storage is in memory and timers are faked. */

function memoryStorage() {
  const data = new Map<string, string>()
  return { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, String(v)), removeItem: (k: string) => void data.delete(k), clear: () => data.clear(), key: () => null, length: 0 }
}

type Modules = Awaited<ReturnType<typeof load>>
async function load() {
  vi.resetModules()
  const settings = await import('../store/settings')
  const library = await import('../store/library')
  const store = await import('./store')
  const engine = await import('./engine')
  const claims = await import('./claims')
  return { ...settings, ...library, ...store, ...engine, ...claims }
}

interface Call {
  method: string
  path: string
  body: Record<string, any> | undefined
}
let m: Modules
let calls: Call[]
let routes: Record<string, () => { status: number; json?: unknown } | 'offline'>

const item = (type: 'movie' | 'show', id: number, title = `T${id}`): MediaItem => ({ type, id, title, overview: 'overview', genres: [], poster: `/${id}.jpg` })
const posts = (path: string) => calls.filter((c) => c.method === 'POST' && c.path === path)
const at = (iso: string) => Date.parse(iso)

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'Date'] })
  vi.stubGlobal('localStorage', memoryStorage())
  vi.stubGlobal('sessionStorage', memoryStorage())
  vi.stubGlobal('location', { origin: 'https://flow.example.com', assign() {} })
  vi.stubGlobal('document', { addEventListener() {}, visibilityState: 'visible' })
  calls = []
  routes = {
    'GET /users/settings': () => ({ status: 200, json: { user: { username: 'avi' } } }),
    'GET /sync/watchlist': () => ({ status: 200, json: [] }),
    'GET /sync/history': () => ({ status: 200, json: [] }),
    'GET /sync/watched/shows': () => ({ status: 200, json: [] }),
    'GET /sync/playback': () => ({ status: 200, json: [] }),
  }
  vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
    const path = new URL(url).pathname
    const method = init.method ?? 'GET'
    calls.push({ method, path, body: init.body ? JSON.parse(String(init.body)) : undefined })
    const answer = routes[`${method} ${path}`]?.() ?? { status: 201, json: {} }
    if (answer === 'offline') throw new TypeError('Failed to fetch')
    return new Response(answer.json === undefined ? null : JSON.stringify(answer.json), { status: answer.status })
  })
  m = await load()
  m.settingsStore.set({ traktClientID: 'cid', traktAccount: { accessToken: 'tok', refreshToken: 'r', expiresAt: '2099-01-01T00:00:00Z', redirectURI: 'https://flow.example.com/settings/trakt-callback' } })
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

/** Runs the engine until its first sync has finished. */
async function started() {
  m.startTrakt()
  await vi.waitFor(() => expect(m.traktStore.get().lastSyncAt ?? m.traktStore.get().error).toBeTruthy())
}
const quiet = async () => void (await vi.advanceTimersByTimeAsync(m.flushDelay + 50))

describe('signing in', () => {
  it('brings Trakt’s watchlist, plays, watched episodes and resume points into the library', async () => {
    m.libraryStore.set({ watchlist: [{ key: 'movie:1', item: item('movie', 1), addedAt: 1 }] })
    routes['GET /sync/watchlist'] = () => ({
      status: 200,
      json: [
        { type: 'movie', listed_at: '2026-10-02T00:00:00.000Z', movie: { title: 'Dune', year: 2021, ids: { tmdb: 2 } } },
        { type: 'show', listed_at: '2026-10-03T00:00:00.000Z', show: { title: 'Severance', year: 2022, ids: { tmdb: 3 } } },
      ],
    })
    routes['GET /sync/history'] = () => ({ status: 200, json: [{ type: 'episode', watched_at: '2026-10-05T20:00:00.000Z', episode: { season: 1, number: 2 }, show: { title: 'Severance', ids: { tmdb: 3 } } }] })
    routes['GET /sync/watched/shows'] = () => ({ status: 200, json: [{ show: { title: 'Severance', ids: { tmdb: 3 } }, seasons: [{ number: 1, episodes: [{ number: 1, last_watched_at: '2026-10-04T00:00:00.000Z' }, { number: 2, last_watched_at: '2026-10-05T20:00:00.000Z' }] }] }] })
    routes['GET /sync/playback'] = () => ({ status: 200, json: [{ id: 9, progress: 40, paused_at: '2026-10-06T00:00:00.000Z', type: 'movie', movie: { title: 'Dune', runtime: 100, ids: { tmdb: 2 } } }] })
    await started()
    const lib = m.libraryStore.get()
    expect(lib.watchlist.map((e) => e.key).sort()).toEqual(['movie:1', 'movie:2', 'show:3'])
    // What was already here keeps its artwork; what is new is a stand-in until TMDB fills it in.
    expect(lib.watchlist.find((e) => e.key === 'movie:1')!.item.poster).toBe('/1.jpg')
    expect(lib.watchlist.find((e) => e.key === 'movie:2')!.item).toMatchObject({ title: 'Dune', year: 2021 })
    expect(lib.history).toHaveLength(1)
    expect(lib.history[0]).toMatchObject({ key: 'show:3', episode: { season: 1, episode: 2 }, watchedAt: at('2026-10-05T20:00:00Z') })
    expect(Object.keys(lib.watchedEpisodes).sort()).toEqual(['show:3:s1e1', 'show:3:s1e2'])
    expect(lib.progress['movie:2']).toMatchObject({ position: 2400, duration: 6000 })
    // And the title only this browser had goes up, once.
    expect(posts('/sync/watchlist').map((c) => c.body)).toEqual([{ movies: [{ ids: { tmdb: 1 } }] }])
    expect(m.traktStore.get()).toMatchObject({ username: 'avi', error: null, ops: [] })
    expect(m.traktStore.get().lastSyncAt).toBeTruthy()
  })

  it('sends the plays this browser made before signing in, which Trakt lacks', async () => {
    m.libraryStore.set({ history: [{ key: 'movie:8', item: item('movie', 8), watchedAt: at('2026-10-01T10:00:00Z') }] })
    await started()
    expect(posts('/sync/history').map((c) => c.body)).toEqual([{ movies: [{ ids: { tmdb: 8 }, watched_at: '2026-10-01T10:00:00Z' }] }])
  })

  it('does nothing without a sign-in or without a client id', async () => {
    m.settingsStore.set({ traktAccount: null })
    await m.syncTrakt()
    expect(calls).toEqual([])
    m.settingsStore.set({ traktClientID: '', traktAccount: { accessToken: 'a', refreshToken: null, expiresAt: null, redirectURI: null } })
    await m.syncTrakt()
    expect(calls).toEqual([])
  })
})

describe('changes made here', () => {
  it('go to Trakt a couple of seconds later, as one request however many taps', async () => {
    await started()
    calls.length = 0
    m.library.toggleWatchlist(item('movie', 5))
    m.library.toggleWatchlist(item('show', 6))
    expect(calls).toEqual([])
    await quiet()
    expect(posts('/sync/watchlist').map((c) => c.body)).toEqual([{ movies: [{ ids: { tmdb: 5 } }], shows: [{ ids: { tmdb: 6 } }] }])
    m.library.toggleWatchlist(item('movie', 5))
    await quiet()
    expect(posts('/sync/watchlist/remove').map((c) => c.body)).toEqual([{ movies: [{ ids: { tmdb: 5 } }] }])
    expect(m.traktStore.get().ops).toEqual([])
  })

  it('send a title marked watched, and an episode finished, with the time', async () => {
    await started()
    calls.length = 0
    vi.setSystemTime(new Date('2026-10-24T12:00:00Z'))
    m.library.markWatched(item('movie', 7))
    m.library.markWatched(item('show', 8), { season: 3, episode: 4 })
    await quiet()
    expect(posts('/sync/history')[0]!.body).toEqual({
      movies: [{ ids: { tmdb: 7 }, watched_at: '2026-10-24T12:00:00Z' }],
      shows: [{ ids: { tmdb: 8 }, seasons: [{ number: 3, episodes: [{ number: 4, watched_at: '2026-10-24T12:00:00Z' }] }] }],
    })
  })

  it('leave out a play the scrobbler already reported, so Trakt counts it once', async () => {
    await started()
    calls.length = 0
    m.claim(m.claimKey('movie', 7))
    m.library.markWatched(item('movie', 7))
    await quiet()
    expect(posts('/sync/history')).toEqual([])
  })

  it('remove a resume point on Trakt when it is dismissed here, but not when the title is finished', async () => {
    routes['GET /sync/playback'] = () => ({ status: 200, json: [{ id: 41, progress: 40, paused_at: '2026-10-06T00:00:00.000Z', type: 'movie', movie: { title: 'Dune', runtime: 100, ids: { tmdb: 2 } } }] })
    await started()
    expect(m.libraryStore.get().progress['movie:2']).toBeTruthy()
    calls.length = 0
    m.library.removeProgress('movie:2')
    await quiet()
    expect(calls.map((c) => `${c.method} ${c.path}`)).toEqual(['DELETE /sync/playback/41'])
  })

  it('send a rating through the hook, and none while signed out', async () => {
    await started()
    calls.length = 0
    m.rateTitle({ type: 'movie', id: 3 }, 9.4)
    m.rateTitle({ type: 'show', id: 4 }, null)
    await quiet()
    expect(posts('/sync/ratings').map((c) => c.body)).toEqual([{ movies: [{ ids: { tmdb: 3 }, rating: 9 }] }])
    expect(posts('/sync/ratings/remove').map((c) => c.body)).toEqual([{ shows: [{ ids: { tmdb: 4 } }] }])
    m.settingsStore.set({ traktAccount: null })
    calls.length = 0
    m.rateTitle({ type: 'movie', id: 3 }, 5)
    await quiet()
    expect(calls).toEqual([])
  })
})

describe('what Trakt changes', () => {
  it('drops a title removed from Trakt’s watchlist since the last sync, and adds one added there', async () => {
    m.libraryStore.set({ watchlist: [{ key: 'movie:1', item: item('movie', 1), addedAt: 1 }] })
    const listed = (id: number) => ({ type: 'movie', listed_at: '2026-10-02T00:00:00.000Z', movie: { title: `T${id}`, ids: { tmdb: id } } })
    routes['GET /sync/watchlist'] = () => ({ status: 200, json: [listed(1)] })
    await started()
    routes['GET /sync/watchlist'] = () => ({ status: 200, json: [listed(9)] })
    await m.syncTrakt()
    expect(m.libraryStore.get().watchlist.map((e) => e.key)).toEqual(['movie:9'])
    // Nothing the pull changed was sent back as if the viewer had done it.
    await quiet()
    expect(posts('/sync/watchlist/remove')).toEqual([])
  })

  it('asks only for plays since the last one it has after the first sync', async () => {
    routes['GET /sync/history'] = () => ({ status: 200, json: [{ type: 'movie', watched_at: '2026-10-05T20:00:00.000Z', movie: { title: 'Dune', ids: { tmdb: 2 } } }] })
    await started()
    calls.length = 0
    await m.syncTrakt()
    const asked = calls.find((c) => c.path === '/sync/history')
    expect(asked).toBeTruthy()
    expect(m.traktStore.get().historyThrough).toBe('2026-10-05T20:00:00Z')
  })
})

describe('when Trakt can’t be reached', () => {
  it('says so in words, keeps the changes queued, and sends them on the next sync', async () => {
    await started()
    routes['POST /sync/watchlist'] = () => 'offline'
    m.library.toggleWatchlist(item('movie', 5))
    await quiet()
    expect(m.traktStore.get().error).toBe('Couldn’t reach Trakt. Check your connection.')
    expect(m.traktStore.get().ops).toEqual([{ kind: 'watchlist', type: 'movie', id: 5, on: true }])
    routes['POST /sync/watchlist'] = () => ({ status: 201, json: {} })
    await m.syncTrakt()
    expect(m.traktStore.get().ops).toEqual([])
    expect(m.traktStore.get().error).toBeNull()
  })

  it('tells a refused client id apart, and keeps the library as it was', async () => {
    m.libraryStore.set({ watchlist: [{ key: 'movie:1', item: item('movie', 1), addedAt: 1 }] })
    routes['GET /sync/watchlist'] = () => ({ status: 403 })
    await started()
    expect(m.traktStore.get().error).toBe('Trakt didn’t accept this app’s client ID. Check it in Settings → Account.')
    expect(m.libraryStore.get().watchlist.map((e) => e.key)).toEqual(['movie:1'])
  })
})
