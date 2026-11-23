import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/* Signing in to Simkl with a code, against a fake Simkl, a fake Sync engine and in-memory storage. */

const sync = vi.hoisted(() => ({ syncNow: vi.fn(async () => {}), pushNow: vi.fn(async () => {}) }))
vi.mock('../sync/engine', () => sync)

function memoryStorage() {
  const data = new Map<string, string>()
  return { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, String(v)), removeItem: (k: string) => void data.delete(k), clear: () => data.clear(), key: () => null, length: 0 }
}

type Modules = Awaited<ReturnType<typeof load>>
async function load() {
  vi.resetModules()
  const settings = await import('../store/settings')
  const store = await import('./store')
  const session = await import('./session')
  return { ...settings, ...store, ...session }
}

let m: Modules
let polls: number
let answers: Record<string, () => { status: number; json?: unknown }>

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
  vi.stubGlobal('localStorage', memoryStorage())
  vi.stubGlobal('sessionStorage', memoryStorage())
  polls = 0
  answers = {
    '/oauth/pin': () => ({ status: 200, json: { result: 'OK', user_code: 'AB12C', verification_url: 'https://simkl.com/pin', expires_in: 60, interval: 5 } }),
    '/users/settings': () => ({ status: 200, json: { user: { name: 'avi' } } }),
  }
  vi.stubGlobal('fetch', async (url: string) => {
    const path = new URL(url).pathname
    if (path.startsWith('/oauth/pin/')) {
      polls++
      return new Response(JSON.stringify(polls < 3 ? { result: 'KO', message: 'Authorization pending' } : { result: 'OK', access_token: 'sk-token' }), { status: 200 })
    }
    const a = answers[path]?.() ?? { status: 404 }
    return new Response(a.json === undefined ? null : JSON.stringify(a.json), { status: a.status })
  })
  sync.pushNow.mockReset().mockImplementation(async () => {})
  m = await load()
  m.settingsStore.set({ simklClientID: 'cid' })
})

/** Marquee Sync is on in this browser, so a sign-in or sign-out is pushed. */
const syncOn = () => localStorage.setItem('flow.sync.v1', JSON.stringify({ key: 'K', server: 'https://sync.example.com', token: '', metas: {} }))

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('the code sign-in', () => {
  it('waits for approval, then keeps the token in the apps’ shape, chooses Simkl and tells the other devices', async () => {
    syncOn()
    m.settingsStore.set({ traktAccount: { accessToken: 't', refreshToken: null, expiresAt: null, redirectURI: null } })
    const pin = await m.startPin()
    expect(pin).toEqual({ code: 'AB12C', url: 'https://simkl.com/pin', expiresIn: 60, interval: 5 })
    const done = m.finishPin(pin, new AbortController().signal)
    await vi.advanceTimersByTimeAsync(5000 * 3)
    expect(await done).toEqual({ ok: true })
    expect(polls).toBe(3)
    expect(m.settingsStore.get().simklAccount).toEqual({ accessToken: 'sk-token', refreshToken: null, expiresAt: null, redirectURI: null })
    expect(m.settingsStore.get().tracker).toBe('simkl')
    expect(sync.pushNow).toHaveBeenCalled()
    await vi.waitFor(() => expect(m.serviceState('simkl').username).toBe('avi'))
  })

  it('stops when the viewer cancels, leaving nothing signed in', async () => {
    const pin = await m.startPin()
    const controller = new AbortController()
    const done = m.finishPin(pin, controller.signal)
    await vi.advanceTimersByTimeAsync(5000)
    controller.abort()
    await vi.advanceTimersByTimeAsync(1)
    expect(await done).toMatchObject({ ok: false, cancelled: true })
    expect(m.settingsStore.get().simklAccount).toBeNull()
  })

  it('says the code expired when it is never approved', async () => {
    vi.stubGlobal('fetch', async (url: string) => new Response(JSON.stringify(new URL(url).pathname === '/oauth/pin' ? { user_code: 'X', expires_in: 10, interval: 5 } : { result: 'KO' }), { status: 200 }))
    const pin = await m.startPin()
    const done = m.finishPin(pin, new AbortController().signal)
    await vi.advanceTimersByTimeAsync(11_000)
    expect(await done).toEqual({ ok: false, error: 'That code expired before it was approved. Start again from Settings → Account.' })
  })

  it('waits out a moment offline, but gives up on a refused Client ID', async () => {
    const pin = await m.startPin()
    let n = 0
    vi.stubGlobal('fetch', async () => {
      n++
      if (n === 1) throw new TypeError('Failed to fetch')
      return n === 2 ? new Response(JSON.stringify({ result: 'OK', access_token: 'later' }), { status: 200 }) : new Response('{}', { status: 412 })
    })
    const done = m.finishPin(pin, new AbortController().signal)
    await vi.advanceTimersByTimeAsync(10_000)
    expect(await done).toEqual({ ok: true })
    expect(m.settingsStore.get().simklAccount?.accessToken).toBe('later')

    m.settingsStore.set({ simklAccount: null })
    n = 2
    const refused = m.finishPin(pin, new AbortController().signal)
    await vi.advanceTimersByTimeAsync(5000)
    expect(await refused).toEqual({ ok: false, error: 'Simkl didn’t accept this app’s Client ID. Check it in Settings → Account.' })
  })

  it('checks a Client ID by asking for a code', async () => {
    expect(await m.checkSimklClientID('good')).toBeUndefined()
    vi.stubGlobal('fetch', async () => new Response('{}', { status: 412 }))
    expect(await m.checkSimklClientID('bad')).toBe('Simkl didn’t accept this app’s Client ID. Check it in Settings → Account.')
    vi.stubGlobal('fetch', async () => {
      throw new TypeError('Failed to fetch')
    })
    expect(await m.checkSimklClientID('x')).toBe('Couldn’t reach Simkl. Check your connection.')
  })
})

describe('signing out', () => {
  it('forgets the token, goes back to this device when Simkl was tracking, and tells the other devices', async () => {
    syncOn()
    m.settingsStore.set({ simklAccount: { accessToken: 'sk', refreshToken: null, expiresAt: null, redirectURI: null }, tracker: 'simkl' })
    m.setService('simkl', { username: 'avi', ops: [{ kind: 'watchlist', type: 'movie', id: 1, on: true }] })
    await m.signOutOfSimkl()
    expect(m.settingsStore.get()).toMatchObject({ simklAccount: null, tracker: 'local' })
    expect(m.serviceState('simkl')).toMatchObject({ username: null, ops: [] })
    expect(sync.pushNow).toHaveBeenCalled()
  })

  it('leaves the choice alone when another service was tracking', async () => {
    m.settingsStore.set({ simklAccount: { accessToken: 'sk', refreshToken: null, expiresAt: null, redirectURI: null }, tracker: 'mdblist', mdblistKey: 'k' })
    await m.signOutOfSimkl()
    expect(m.settingsStore.get().tracker).toBe('mdblist')
  })
})

describe('an OAuth 2.0 app’s sign-in and refresh', () => {
  const calls: { path: string; body: any }[] = []
  let token: () => { status: number; json: unknown }

  beforeEach(() => {
    calls.length = 0
    vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
      const path = new URL(url).pathname
      calls.push({ path, body: init?.body ? JSON.parse(String(init.body)) : undefined })
      if (path === '/oauth/pin') return new Response(JSON.stringify({ error: 'unauthorized_client', message: 'use POST /oauth2/device' }), { status: 400 })
      if (path === '/oauth2/device') return new Response(JSON.stringify({ device_code: 'dc', user_code: 'AB12-CD34', verification_uri: 'https://simkl.com/pin', expires_in: 60, interval: 5 }), { status: 200 })
      if (path === '/oauth2/token') {
        const t = token()
        return new Response(JSON.stringify(t.json), { status: t.status })
      }
      if (path === '/users/settings') return new Response(JSON.stringify({ user: { name: 'avi' } }), { status: 200 })
      return new Response('[]', { status: 200 })
    })
  })

  it('signs in, waiting out pending and slow_down, and keeps the refresh token and expiry', async () => {
    const answers = [{ status: 400, json: { error: 'authorization_pending' } }, { status: 400, json: { error: 'slow_down' } }, { status: 200, json: { access_token: 'at', refresh_token: 'rt', expires_in: 3600 } }]
    token = () => answers.shift()!
    const pin = await m.startPin()
    expect(pin.deviceCode).toBe('dc')
    const done = m.finishPin(pin, new AbortController().signal)
    await vi.advanceTimersByTimeAsync(5000 * 2)
    // slow_down was answered at the second look, so the third is ten seconds after it.
    await vi.advanceTimersByTimeAsync(5000)
    expect(calls.filter((c) => c.path === '/oauth2/token')).toHaveLength(2)
    await vi.advanceTimersByTimeAsync(5000)
    expect(await done).toEqual({ ok: true })
    const account = m.settingsStore.get().simklAccount!
    expect(account).toMatchObject({ accessToken: 'at', refreshToken: 'rt', redirectURI: null })
    expect(Date.parse(account.expiresAt!)).toBeGreaterThan(Date.now() + 3500_000)
    expect(m.settingsStore.get().tracker).toBe('simkl')
  })

  it('gives up with a sentence when the code expires on Simkl’s side', async () => {
    token = () => ({ status: 400, json: { error: 'expired_token' } })
    const done = m.finishPin(await m.startPin(), new AbortController().signal)
    await vi.advanceTimersByTimeAsync(5000)
    expect(await done).toEqual({ ok: false, error: 'That code expired before it was approved. Start again from Settings → Account.' })
  })

  it('accepts an OAuth 2.0 Client ID when it checks one', async () => {
    expect(await m.checkSimklClientID('oauth2-id')).toBeUndefined()
  })

  const signedIn = (expiresAt: string | null, refreshToken: string | null = 'rt') => m.settingsStore.set({ tracker: 'simkl', simklAccount: { accessToken: 'old', refreshToken, expiresAt, redirectURI: null } })
  const lookup = () => m.backendFor('simkl').username()

  it('refreshes an expired token before the request, saves the new one and tells the other devices', async () => {
    syncOn()
    signedIn(new Date(Date.now() - 1000).toISOString())
    token = () => ({ status: 200, json: { access_token: 'new', refresh_token: 'rt2', expires_in: 3600 } })
    expect(await lookup()).toBe('avi')
    expect(calls.map((c) => c.path)).toEqual(['/oauth2/token', '/users/settings'])
    expect(m.settingsStore.get().simklAccount).toMatchObject({ accessToken: 'new', refreshToken: 'rt2' })
    expect(sync.pushNow).toHaveBeenCalled()
  })

  it('shares one refresh between requests made together', async () => {
    signedIn(new Date(Date.now() + 10_000).toISOString())
    token = () => ({ status: 200, json: { access_token: 'new' } })
    await Promise.all([lookup(), lookup()])
    expect(calls.filter((c) => c.path === '/oauth2/token')).toHaveLength(1)
  })

  it('does not refresh a token that is still good, or one with no refresh token', async () => {
    signedIn(new Date(Date.now() + 3600_000).toISOString())
    await lookup()
    signedIn(new Date(Date.now() - 1000).toISOString(), null)
    await lookup()
    signedIn(null)
    await lookup()
    expect(calls.map((c) => c.path)).toEqual(['/users/settings', '/users/settings', '/users/settings'])
  })

  it('says the person is signed out when the refresh is refused', async () => {
    signedIn(new Date(Date.now() - 1000).toISOString())
    token = () => ({ status: 400, json: { error: 'invalid_grant' } })
    await expect(lookup()).rejects.toMatchObject({ kind: 'signed-out', message: 'Simkl ended this sign-in. Sign in again.' })
    expect(calls.map((c) => c.path)).toEqual(['/oauth2/token'])
  })
})
