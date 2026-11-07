import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { MediaItem } from '../tmdb/types'

/* The library sync against a fake Simkl and a fake MDBList: what comes down when one is chosen, what goes up as the
   library changes, that only the chosen service is spoken to, and what happens when it refuses or can't be reached.
   Storage is in memory and timers are faked. */

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
  const claims = await import('../trakt/claims')
  return { ...settings, ...library, ...store, ...engine, ...claims }
}

interface Call {
  method: string
  host: string
  path: string
  query: URLSearchParams
  headers: Record<string, string>
  body: Record<string, any> | undefined
}
let m: Modules
let calls: Call[]
let routes: Record<string, () => { status: number; json?: unknown } | 'offline'>

const item = (type: 'movie' | 'show', id: number, title = `T${id}`): MediaItem => ({ type, id, title, overview: 'overview', genres: [], poster: `/${id}.jpg` })
const posts = (path: string) => calls.filter((c) => c.method === 'POST' && c.path === path)
const at = (iso: string) => Date.parse(iso)
const simklToken = { accessToken: 'sk-token', refreshToken: null, expiresAt: null, redirectURI: null }

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'Date'] })
  vi.stubGlobal('localStorage', memoryStorage())
  vi.stubGlobal('sessionStorage', memoryStorage())
  vi.stubGlobal('location', { origin: 'https://flow.example.com', assign() {} })
  vi.stubGlobal('document', { addEventListener() {}, visibilityState: 'visible' })
  calls = []
  routes = {
    'GET /users/settings': () => ({ status: 200, json: { user: { name: 'avi' } } }),
    'GET /sync/all-items/movies/plantowatch': () => ({ status: 200, json: null }),
    'GET /sync/all-items/shows/plantowatch': () => ({ status: 200, json: null }),
    'GET /sync/all-items/movies/completed': () => ({ status: 200, json: null }),
    'GET /sync/all-items/shows': () => ({ status: 200, json: null }),
    'GET /sync/playback': () => ({ status: 200, json: [] }),
    'GET /user': () => ({ status: 200, json: { username: 'mdb' } }),
    'GET /watchlist/items': () => ({ status: 200, json: [] }),
    'GET /sync/history': () => ({ status: 200, json: [] }),
    'GET /sync/watched': () => ({ status: 200, json: { movies: [], shows: [] } }),
  }
  vi.stubGlobal('fetch', async (url: string, init: RequestInit = {}) => {
    const u = new URL(url)
    const method = init.method ?? 'GET'
    calls.push({ method, host: u.host, path: u.pathname, query: u.searchParams, headers: (init.headers ?? {}) as Record<string, string>, body: init.body ? JSON.parse(String(init.body)) : undefined })
    const answer = routes[`${method} ${u.pathname}`]?.() ?? { status: 201, json: {} }
    if (answer === 'offline') throw new TypeError('Failed to fetch')
    return new Response(answer.json === undefined ? null : JSON.stringify(answer.json), { status: answer.status })
  })
  m = await load()
  m.settingsStore.set({ simklClientID: 'cid', simklAccount: simklToken })
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

const state = (kind: 'simkl' | 'mdblist' = 'simkl') => m.serviceState(kind)
/** Runs the engine until its first sync has finished. */
async function started(kind: 'simkl' | 'mdblist' = 'simkl') {
  m.startTracking()
  await vi.waitFor(() => expect(state(kind).lastSyncAt ?? state(kind).error).toBeTruthy())
}
const quiet = async () => void (await vi.advanceTimersByTimeAsync(m.flushDelay + 50))

describe('choosing Simkl', () => {
  it('brings its watchlist, watched titles and resume points into the library, and sends what only this browser had', async () => {
    m.libraryStore.set({ watchlist: [{ key: 'movie:1', item: item('movie', 1), addedAt: 1 }] })
    routes['GET /sync/all-items/movies/plantowatch'] = () => ({ status: 200, json: { movies: [{ added_to_watchlist_at: '2026-10-02T00:00:00Z', movie: { title: 'Dune', year: 2021, ids: { simkl: 5, tmdb: '2' } } }] } })
    routes['GET /sync/all-items/shows/plantowatch'] = () => ({ status: 200, json: { shows: [{ added_to_watchlist_at: '2026-10-03T00:00:00Z', show: { title: 'Severance', ids: { tmdb: 3 } } }] } })
    routes['GET /sync/all-items/shows'] = () => ({
      status: 200,
      json: { shows: [{ last_watched_at: '2026-10-05T20:00:00Z', show: { title: 'Severance', ids: { tmdb: 3 } }, seasons: [{ number: 1, episodes: [{ number: 1, watched_at: '2026-10-04T00:00:00Z' }, { number: 2, watched_at: '2026-10-05T20:00:00Z' }] }] }] },
    })
    routes['GET /sync/playback'] = () => ({ status: 200, json: [{ id: 9, progress: 40, paused_at: '2026-10-06T00:00:00Z', type: 'movie', movie: { title: 'Dune', ids: { tmdb: 2 } } }] })
    await started()
    const lib = m.libraryStore.get()
    expect(lib.watchlist.map((e) => e.key).sort()).toEqual(['movie:1', 'movie:2', 'show:3'])
    expect(lib.watchlist.find((e) => e.key === 'movie:1')!.item.poster).toBe('/1.jpg')
    expect(lib.history.map((h) => h.episode?.episode)).toEqual([2, 1])
    expect(Object.keys(lib.watchedEpisodes).sort()).toEqual(['show:3:s1e1', 'show:3:s1e2'])
    expect(lib.progress['movie:2']).toMatchObject({ position: 2880, duration: 7200 })
    // The title only this browser had goes up, to the watchlist, once.
    expect(posts('/sync/add-to-list').map((c) => c.body)).toEqual([{ movies: [{ ids: { tmdb: 1 }, to: 'plantowatch' }] }])
    expect(state()).toMatchObject({ username: 'avi', error: null, ops: [] })
    expect(state().lastSyncAt).toBeTruthy()
  })

  it('says who it is, with the client id and the token, as the apps do', async () => {
    await started()
    const call = calls.find((c) => c.path === '/sync/playback')!
    expect(call.host).toBe('api.simkl.com')
    expect(call.headers).toMatchObject({ Authorization: 'Bearer sk-token', 'simkl-api-key': 'cid' })
    expect(call.query.get('client_id')).toBe('cid')
    // A GET carries no Content-Type, which keeps it free of anything a browser must ask first.
    expect(call.headers['Content-Type']).toBeUndefined()
  })

  it('sends the plays this browser made before, which Simkl lacks', async () => {
    m.libraryStore.set({ history: [{ key: 'movie:8', item: item('movie', 8), watchedAt: at('2026-10-01T10:00:00Z') }] })
    await started()
    expect(posts('/sync/history').map((c) => c.body)).toEqual([{ movies: [{ ids: { tmdb: 8 }, watched_at: '2026-10-01T10:00:00Z' }] }])
  })

  it('does nothing without a sign-in or a client id, and nothing for sample data', async () => {
    m.settingsStore.set({ simklAccount: null })
    await m.syncTracker()
    expect(calls).toEqual([])
    m.settingsStore.set({ simklClientID: '', simklAccount: simklToken })
    await m.syncTracker()
    expect(calls).toEqual([])
    m.settingsStore.set({ simklClientID: 'cid', demo: true })
    m.startTracking()
    await m.syncTracker()
    m.library.toggleWatchlist(item('movie', 5))
    await quiet()
    expect(calls).toEqual([])
  })
})

describe('only the chosen service is spoken to', () => {
  it('leaves Simkl alone while Trakt or this device tracks, and keeps what it knew', async () => {
    await started()
    m.settingsStore.set({ tracker: 'local' })
    calls.length = 0
    await m.syncTracker()
    m.library.toggleWatchlist(item('movie', 5))
    await quiet()
    expect(calls).toEqual([])
    expect(state().ops).toEqual([])
  })

  it('does not replay changes made under another service when this one is chosen', async () => {
    m.settingsStore.set({ tracker: 'local' })
    m.startTracking()
    m.library.toggleWatchlist(item('movie', 5))
    await quiet()
    m.settingsStore.set({ tracker: 'simkl' })
    await vi.waitFor(() => expect(state().lastSyncAt).toBeTruthy())
    await quiet()
    // The title was added while this device tracked; the first sync sends it as the union of both lists, once.
    expect(posts('/sync/add-to-list')).toHaveLength(1)
  })

  it('syncs with MDBList when it is chosen, with the key in the address and no custom header', async () => {
    m.settingsStore.set({ simklAccount: null, mdblistKey: 'key-123', tracker: 'mdblist' })
    routes['GET /watchlist/items'] = () => ({ status: 200, json: [{ mediatype: 'movie', watchlist_at: '2026-10-02T00:00:00Z', movie: { title: 'Dune', ids: { tmdb: 2 } } }] })
    await started('mdblist')
    const call = calls.find((c) => c.path === '/watchlist/items')!
    expect(call.host).toBe('api.mdblist.com')
    expect(call.query.get('apikey')).toBe('key-123')
    expect(call.headers).toEqual({})
    expect(m.libraryStore.get().watchlist.map((e) => e.key)).toEqual(['movie:2'])
    expect(state('mdblist')).toMatchObject({ username: 'mdb', error: null })
  })

  it('sends MDBList changes as text/plain, so the browser needs no preflight', async () => {
    m.settingsStore.set({ simklAccount: null, mdblistKey: 'key-123', tracker: 'mdblist' })
    await started('mdblist')
    calls.length = 0
    m.library.toggleWatchlist(item('movie', 5))
    await quiet()
    const sent = posts('/watchlist/items/add')
    expect(sent.map((c) => c.body)).toEqual([{ movies: [{ tmdb: 5 }] }])
    expect(sent[0]!.headers['Content-Type']).toBe('text/plain;charset=UTF-8')
  })
})

describe('changes made here', () => {
  it('go to Simkl a couple of seconds later, as one request however many taps', async () => {
    await started()
    calls.length = 0
    m.library.toggleWatchlist(item('movie', 5))
    m.library.toggleWatchlist(item('show', 6))
    expect(calls).toEqual([])
    await quiet()
    expect(posts('/sync/add-to-list').map((c) => c.body)).toEqual([{ movies: [{ ids: { tmdb: 5 }, to: 'plantowatch' }], shows: [{ ids: { tmdb: 6 }, to: 'plantowatch' }] }])
    m.library.toggleWatchlist(item('movie', 5))
    await quiet()
    expect(posts('/sync/history/remove').map((c) => c.body)).toEqual([{ movies: [{ ids: { tmdb: 5 } }] }])
    expect(state().ops).toEqual([])
  })

  it('send a title marked watched, with the time, and leave out a play the scrobbler already reported', async () => {
    await started()
    calls.length = 0
    vi.setSystemTime(new Date('2026-10-24T12:00:00Z'))
    m.library.markWatched(item('movie', 7))
    m.claim(m.claimKey('movie', 9))
    m.library.markWatched(item('movie', 9))
    await quiet()
    expect(posts('/sync/history').map((c) => c.body)).toEqual([{ movies: [{ ids: { tmdb: 7 }, watched_at: '2026-10-24T12:00:00Z' }] }])
  })

  it('send a rating and its removal through the hook', async () => {
    await started()
    calls.length = 0
    m.rateTitle({ type: 'movie', id: 3 }, 9.4)
    m.rateTitle({ type: 'show', id: 4 }, null)
    await quiet()
    expect(posts('/sync/ratings').map((c) => c.body)).toEqual([{ movies: [{ ids: { tmdb: 3 }, rating: 9 }] }])
    expect(posts('/sync/ratings/remove').map((c) => c.body)).toEqual([{ shows: [{ ids: { tmdb: 4 } }] }])
  })

  it('remove a resume point on Simkl when it is dismissed here', async () => {
    routes['GET /sync/playback'] = () => ({ status: 200, json: [{ id: 41, progress: 40, paused_at: '2026-10-06T00:00:00Z', type: 'movie', movie: { title: 'Dune', ids: { tmdb: 2 } } }] })
    await started()
    calls.length = 0
    m.library.removeProgress('movie:2')
    await quiet()
    expect(calls.map((c) => `${c.method} ${c.path}`)).toEqual(['DELETE /sync/playback/41'])
  })
})

describe('what the service changes', () => {
  it('drops a title removed from its watchlist since the last sync, and asks for the watched lists only on a full sync', async () => {
    m.libraryStore.set({ watchlist: [{ key: 'movie:1', item: item('movie', 1), addedAt: 1 }] })
    const listed = (id: number) => ({ status: 200, json: { movies: [{ added_to_watchlist_at: '2026-10-02T00:00:00Z', movie: { title: `T${id}`, ids: { tmdb: id } } }] } })
    routes['GET /sync/all-items/movies/plantowatch'] = () => listed(1)
    await started()
    routes['GET /sync/all-items/movies/plantowatch'] = () => listed(9)
    calls.length = 0
    await m.syncTracker()
    expect(m.libraryStore.get().watchlist.map((e) => e.key)).toEqual(['movie:9'])
    expect(calls.some((c) => c.path === '/sync/all-items/shows')).toBe(true)
    // Nothing the pull changed was sent back as if the viewer had done it.
    await quiet()
    expect(posts('/sync/history/remove')).toEqual([])
  })
})

describe('when the service refuses or can’t be reached', () => {
  it('says so in words, keeps the changes queued, and sends them on the next sync', async () => {
    await started()
    routes['POST /sync/add-to-list'] = () => 'offline'
    m.library.toggleWatchlist(item('movie', 5))
    await quiet()
    expect(state().error).toBe('Couldn’t reach Simkl. Check your connection.')
    expect(state().ops).toEqual([{ kind: 'watchlist', type: 'movie', id: 5, on: true }])
    routes['POST /sync/add-to-list'] = () => ({ status: 201, json: {} })
    await m.syncTracker()
    expect(state().ops).toEqual([])
    expect(state().error).toBeNull()
  })

  it('asks to sign in again when Simkl ends the sign-in, and keeps the library as it was', async () => {
    m.libraryStore.set({ watchlist: [{ key: 'movie:1', item: item('movie', 1), addedAt: 1 }] })
    routes['GET /sync/playback'] = () => ({ status: 401 })
    await started()
    expect(state()).toMatchObject({ error: 'Simkl ended this sign-in. Sign in again.', signInAgain: true })
    expect(m.libraryStore.get().watchlist.map((e) => e.key)).toEqual(['movie:1'])
  })

  it('names a refused Client ID, and a refused update stays on screen after a sync that otherwise went well', async () => {
    routes['GET /sync/playback'] = () => ({ status: 412 })
    await started()
    expect(state().error).toBe('Simkl didn’t accept this app’s Client ID. Check it in Settings → Account.')
    routes['GET /sync/playback'] = () => ({ status: 200, json: [] })
    routes['POST /sync/add-to-list'] = () => ({ status: 400 })
    m.library.toggleWatchlist(item('movie', 5))
    await m.syncTracker()
    // The refused change is dropped (resending it won't change the answer) and the sentence says it happened.
    expect(state().ops).toEqual([])
    expect(state().error).toBe('Simkl didn’t accept that update (400).')
    expect(state().lastSyncAt).toBeTruthy()
  })

  it('tells a refused MDBList key apart', async () => {
    m.settingsStore.set({ simklAccount: null, mdblistKey: 'bad', tracker: 'mdblist' })
    routes['GET /watchlist/items'] = () => ({ status: 401, json: { error: 'Invalid API key' } })
    await started('mdblist')
    expect(state('mdblist').error).toBe('MDBList didn’t accept this key. Check it in Settings → Account.')
    expect(JSON.stringify(state('mdblist'))).not.toContain('bad')
  })
})

describe('a list kept on a different service than tracking', () => {
  const split = () => m.settingsStore.set({ mdblistKey: 'key-123', tracker: 'simkl', watchlistDestination: 'mdblist' })
  /** Runs both services through their first sync. */
  async function startedBoth() {
    m.startTracking()
    await vi.waitFor(() => expect(state('simkl').lastSyncAt && state('mdblist').lastSyncAt).toBeTruthy())
  }
  const hosts = (method: string) => calls.filter((c) => c.method === method).map((c) => `${c.host}${c.path}`)

  it('asks each service only for what it does: Simkl for history and resume points, MDBList for the watchlist', async () => {
    split()
    await startedBoth()
    const asked = hosts('GET')
    expect(asked).toContain('api.mdblist.com/watchlist/items')
    expect(asked.filter((a) => a.startsWith('api.mdblist.com'))).not.toContain('api.mdblist.com/sync/playback')
    expect(asked.some((a) => a.startsWith('api.simkl.com/sync/all-items/') && a.includes('plantowatch'))).toBe(false)
    expect(asked.some((a) => a.startsWith('api.simkl.com/sync/playback'))).toBe(true)
  })

  it('sends a watchlist change to MDBList and a watched title to Simkl, and each only to its own', async () => {
    split()
    await startedBoth()
    calls.length = 0
    m.library.toggleWatchlist(item('movie', 5))
    m.library.markWatched(item('movie', 6))
    await quiet()
    const sent = calls.filter((c) => c.method === 'POST').map((c) => `${c.host}${c.path}`)
    expect(sent).toContain('api.mdblist.com/watchlist/items/add')
    expect(sent.some((p) => p.startsWith('api.simkl.com') && p.includes('add-to-list'))).toBe(false)
    expect(sent).toContain('api.simkl.com/sync/history')
    expect(sent.some((p) => p.startsWith('api.mdblist.com') && p.includes('history'))).toBe(false)
  })

  it('drops a watchlist change still queued for a service the watchlist has since left', async () => {
    split()
    await startedBoth()
    routes['POST /watchlist/items/add'] = () => 'offline'
    m.library.toggleWatchlist(item('movie', 5))
    await quiet()
    expect(state('mdblist').ops).toHaveLength(1)
    m.settingsStore.set({ watchlistDestination: 'local' })
    await m.syncTracker()
    expect(state('mdblist').ops).toEqual([])
  })

  it('merges a list afresh when it is given to a service, instead of reading its old baseline as removals', async () => {
    split()
    await startedBoth()
    m.setService('mdblist', { watchlistBaseline: ['movie:99'] })
    m.settingsStore.set({ watchlistDestination: 'local' })
    m.settingsStore.set({ watchlistDestination: 'mdblist' })
    await vi.waitFor(() => expect(state('mdblist').watchlistBaseline).not.toContain('movie:99'))
  })
})

describe('the Sync Interval', () => {
  const recently = () => new Date(Date.now() - 20 * 60_000).toISOString()

  it('leaves a recent sync alone when Flow opens, and syncs when the interval has passed', async () => {
    m.setService('simkl', { lastSyncAt: recently(), historyThrough: '2026-10-01T00:00:00Z' })
    m.settingsStore.set({ syncInterval: 3600 })
    m.startTracking()
    await quiet()
    expect(calls.filter((c) => c.method === 'GET' && c.path.includes('plantowatch'))).toEqual([])
  })

  it('syncs on every open when set to Every Launch', async () => {
    m.setService('simkl', { lastSyncAt: recently(), historyThrough: '2026-10-01T00:00:00Z' })
    m.settingsStore.set({ syncInterval: 0 })
    m.startTracking()
    await vi.waitFor(() => expect(calls.some((c) => c.path.includes('plantowatch'))).toBe(true))
  })

  it('still sends a change straight away however long the interval is', async () => {
    m.setService('simkl', { lastSyncAt: recently(), historyThrough: '2026-10-01T00:00:00Z' })
    m.settingsStore.set({ syncInterval: 86400 })
    m.startTracking()
    m.library.toggleWatchlist(item('movie', 5))
    await quiet()
    expect(posts('/sync/add-to-list')).toHaveLength(1)
  })
})
