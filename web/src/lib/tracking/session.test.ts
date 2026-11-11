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
