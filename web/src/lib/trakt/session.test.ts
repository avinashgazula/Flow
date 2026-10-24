import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { TraktToken } from '../store/settings'

/* The sign-in and the token, against a fake Trakt, a fake Sync engine and in-memory storage. */

const sync = vi.hoisted(() => ({ syncNow: vi.fn(async () => {}), pushNow: vi.fn(async () => {}) }))
vi.mock('../sync/engine', () => sync)

const origin = 'https://flow.example.com'
const site = `${origin}/settings/trakt-callback`

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

interface Call {
  method: string
  path: string
  body: Record<string, unknown> | undefined
  auth: string | undefined
}
let m: Modules
let calls: Call[]
/** What the fake Trakt answers for each path; a function can look at the request. */
let answers: Record<string, (call: Call) => { status: number; json?: unknown } | 'offline'>
let location: { assign: ReturnType<typeof vi.fn>; origin: string }

const stale: TraktToken = { accessToken: 'stale', refreshToken: 'stale-r', expiresAt: '2020-01-01T00:00:00Z', redirectURI: site }
const good: TraktToken = { accessToken: 'good', refreshToken: 'good-r', expiresAt: '2099-01-01T00:00:00Z', redirectURI: site }

beforeEach(async () => {
  vi.stubGlobal('localStorage', memoryStorage())
  vi.stubGlobal('sessionStorage', memoryStorage())
  location = { assign: vi.fn(), origin }
  vi.stubGlobal('location', location)
  calls = []
  answers = {}
  sync.syncNow.mockReset().mockImplementation(async () => {})
  sync.pushNow.mockReset().mockImplementation(async () => {})
  vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
    const path = new URL(url).pathname
    const headers = (init.headers ?? {}) as Record<string, string>
    const call: Call = { method: init.method ?? 'GET', path, body: init.body ? JSON.parse(String(init.body)) : undefined, auth: headers.Authorization }
    calls.push(call)
    const answer = answers[path]?.(call) ?? { status: 404 }
    if (answer === 'offline') throw new TypeError('Failed to fetch')
    return new Response(answer.json === undefined ? null : JSON.stringify(answer.json), { status: answer.status })
  })
  m = await load()
  m.settingsStore.set({ traktClientID: 'cid' })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

const syncOn = () => localStorage.setItem('flow.sync.v1', JSON.stringify({ key: 'K', server: 'https://sync.example.com', token: '', metas: {} }))
const tokenAnswer = (access: string) => () => ({ status: 200, json: { access_token: access, refresh_token: `${access}-r`, expires_in: 7_776_000, created_at: Math.floor(Date.now() / 1000) } })

describe('signing in', () => {
  it('goes to Trakt with a challenge for a verifier it keeps, and this site’s callback as the redirect', async () => {
    await m.beginSignIn()
    const url = new URL(location.assign.mock.calls[0]![0] as string)
    expect(`${url.origin}${url.pathname}`).toBe('https://trakt.tv/oauth/authorize')
    expect(url.searchParams.get('redirect_uri')).toBe(site)
    expect(url.searchParams.get('client_id')).toBe('cid')
    expect(url.searchParams.get('code_challenge_method')).toBe('S256')
    const pending = JSON.parse(sessionStorage.getItem('flow.trakt.pending')!)
    expect(url.searchParams.get('state')).toBe(pending.state)
    expect(pending.verifier).toHaveLength(43)
    // Only the hash leaves the page.
    expect(url.toString()).not.toContain(pending.verifier)
  })

  it('will not start without a client id', async () => {
    m.settingsStore.set({ traktClientID: ' ' })
    await expect(m.beginSignIn()).rejects.toMatchObject({ kind: 'client-id' })
    expect(location.assign).not.toHaveBeenCalled()
  })

  it('finishes with the code and verifier, signs in, tells Sync at once and learns the name', async () => {
    syncOn()
    answers['/oauth/token'] = tokenAnswer('first')
    answers['/users/settings'] = () => ({ status: 200, json: { user: { username: 'avi' } } })
    await m.beginSignIn()
    const pending = JSON.parse(sessionStorage.getItem('flow.trakt.pending')!)
    const result = await m.finishSignIn(`?code=CODE&state=${pending.state}`)
    expect(result).toEqual({ ok: true })
    expect(calls[0]!.body).toEqual({ code: 'CODE', client_id: 'cid', code_verifier: pending.verifier, redirect_uri: site, grant_type: 'authorization_code' })
    expect(m.settingsStore.get().traktAccount).toMatchObject({ accessToken: 'first', refreshToken: 'first-r', redirectURI: site })
    expect(sync.pushNow).toHaveBeenCalledTimes(1)
    expect(m.traktStore.get().username).toBe('avi')
    expect(calls.find((c) => c.path === '/users/settings')!.auth).toBe('Bearer first')
    // The same return can't be used twice.
    expect(await m.finishSignIn(`?code=CODE&state=${pending.state}`)).toMatchObject({ ok: false })
  })

  it('does not touch Sync when it is off', async () => {
    answers['/oauth/token'] = tokenAnswer('first')
    answers['/users/settings'] = () => ({ status: 200, json: { user: { username: 'avi' } } })
    await m.beginSignIn()
    await m.finishSignIn(`?code=C&state=${JSON.parse(sessionStorage.getItem('flow.trakt.pending')!).state}`)
    expect(sync.pushNow).not.toHaveBeenCalled()
    expect(sync.syncNow).not.toHaveBeenCalled()
  })

  it('refuses a return with the wrong state, a sign-in nobody started, and a denied approval', async () => {
    await m.beginSignIn()
    expect(await m.finishSignIn('?code=C&state=wrong')).toMatchObject({ ok: false, error: expect.stringContaining('didn’t match') })
    expect(m.settingsStore.get().traktAccount).toBeNull()
    expect(await m.finishSignIn('?code=C&state=x')).toMatchObject({ ok: false, error: expect.stringContaining('expired') })
    await m.beginSignIn()
    expect(await m.finishSignIn('?error=access_denied')).toMatchObject({ ok: false, cancelled: true })
    expect(calls).toEqual([])
  })

  it('names the redirect address when Trakt will not take the code', async () => {
    answers['/oauth/token'] = () => ({ status: 400, json: { error: 'invalid_grant' } })
    await m.beginSignIn()
    const result = await m.finishSignIn(`?code=C&state=${JSON.parse(sessionStorage.getItem('flow.trakt.pending')!).state}`)
    expect(result).toMatchObject({ ok: false, error: expect.stringContaining(`exactly ${site}`) })
    expect(m.settingsStore.get().traktAccount).toBeNull()
  })
})

describe('finishing from the address', () => {
  it('says what went wrong for Settings to show, and says nothing for a refused approval', async () => {
    answers['/oauth/token'] = () => ({ status: 400, json: { error: 'invalid_grant' } })
    await m.beginSignIn()
    const state = JSON.parse(sessionStorage.getItem('flow.trakt.pending')!).state
    const seen: boolean[] = []
    m.finishingSignIn.subscribe(() => seen.push(m.finishingSignIn.get()))
    await m.finishSignInFromAddress(`?code=C&state=${state}`)
    expect(seen).toEqual([true, false])
    expect(m.traktStore.get().error).toContain(`exactly ${site}`)
    m.traktStore.set({ error: null })
    await m.beginSignIn()
    await m.finishSignInFromAddress('?error=access_denied')
    expect(m.traktStore.get().error).toBeNull()
  })
})

describe('the token', () => {
  it('is used as it is while it is good, with no request and no sync', async () => {
    syncOn()
    m.settingsStore.set({ traktAccount: good })
    expect(await m.accessToken()).toBe('good')
    expect(calls).toEqual([])
    expect(sync.syncNow).not.toHaveBeenCalled()
  })

  it('is null when nobody is signed in', async () => {
    expect(await m.accessToken()).toBeNull()
  })

  it('pulls from Sync before refreshing, and uses what another device already rotated', async () => {
    syncOn()
    m.settingsStore.set({ traktAccount: stale })
    sync.syncNow.mockImplementation(async () => void m.settingsStore.set({ traktAccount: { ...good, accessToken: 'from-phone' } }))
    expect(await m.accessToken()).toBe('from-phone')
    expect(sync.syncNow).toHaveBeenCalledTimes(1)
    expect(calls).toEqual([])
    expect(m.traktStore.get().signInAgain).toBe(false)
  })

  it('refreshes when the pull brings nothing newer, quotes the token’s own redirect, and pushes at once', async () => {
    syncOn()
    answers['/oauth/token'] = tokenAnswer('rotated')
    m.settingsStore.set({ traktAccount: { ...stale, redirectURI: 'flow://trakt-callback' } })
    const order: string[] = []
    sync.syncNow.mockImplementation(async () => void order.push('pull'))
    sync.pushNow.mockImplementation(async () => void order.push(`push:${m.settingsStore.get().traktAccount?.accessToken}`))
    expect(await m.accessToken()).toBe('rotated')
    expect(calls[0]!.body).toEqual({ refresh_token: 'stale-r', client_id: 'cid', redirect_uri: 'flow://trakt-callback', grant_type: 'refresh_token' })
    expect(m.settingsStore.get().traktAccount).toMatchObject({ accessToken: 'rotated', refreshToken: 'rotated-r', redirectURI: 'flow://trakt-callback' })
    // Pull, then refresh, then the new pair goes out before anything else is asked of Trakt.
    expect(order).toEqual(['pull', 'push:rotated'])
  })

  it('refreshes once however many requests are waiting on it', async () => {
    answers['/oauth/token'] = tokenAnswer('rotated')
    m.settingsStore.set({ traktAccount: stale })
    const tokens = await Promise.all([m.accessToken(), m.accessToken(), m.accessToken()])
    expect(tokens).toEqual(['rotated', 'rotated', 'rotated'])
    expect(calls.filter((c) => c.path === '/oauth/token')).toHaveLength(1)
  })

  it('refreshes at once after Trakt refused the token, even though it looked good', async () => {
    answers['/oauth/token'] = tokenAnswer('rotated')
    m.settingsStore.set({ traktAccount: good })
    expect(await m.accessToken(true)).toBe('rotated')
  })

  it('pulls again when the refresh is refused, in case another device won the race, and keeps going if it did', async () => {
    syncOn()
    answers['/oauth/token'] = () => ({ status: 400, json: { error: 'invalid_grant' } })
    m.settingsStore.set({ traktAccount: stale })
    let pulls = 0
    sync.syncNow.mockImplementation(async () => {
      if (++pulls === 2) m.settingsStore.set({ traktAccount: { ...good, accessToken: 'raced-and-won' } })
    })
    expect(await m.accessToken()).toBe('raced-and-won')
    expect(m.traktStore.get().signInAgain).toBe(false)
  })

  it('says to sign in again when nothing else has a newer token, and keeps the stored token for the record', async () => {
    answers['/oauth/token'] = () => ({ status: 400, json: { error: 'invalid_grant' } })
    m.settingsStore.set({ traktAccount: stale })
    expect(await m.accessToken()).toBeNull()
    expect(m.traktStore.get()).toMatchObject({ signInAgain: true, error: 'Trakt ended this sign-in. Sign in again.' })
  })

  it('does not call it a sign-out when Trakt is down or the connection is', async () => {
    m.settingsStore.set({ traktAccount: stale })
    answers['/oauth/token'] = () => ({ status: 503 })
    await expect(m.accessToken()).rejects.toMatchObject({ kind: 'server' })
    answers['/oauth/token'] = () => 'offline'
    await expect(m.accessToken()).rejects.toMatchObject({ kind: 'network' })
    expect(m.traktStore.get().signInAgain).toBe(false)
    expect(m.settingsStore.get().traktAccount).toEqual(stale)
  })
})

describe('signing out', () => {
  it('clears the sign-in and what was kept for it, revokes the token and tells the other devices', async () => {
    syncOn()
    answers['/oauth/revoke'] = () => ({ status: 200 })
    m.settingsStore.set({ traktAccount: good })
    m.traktStore.set({ username: 'avi', lastSyncAt: '2026-10-24T10:00:00Z', ops: [{ kind: 'watchlist', type: 'movie', id: 1, on: true }], watchlistBaseline: ['movie:1'] })
    await m.signOut()
    expect(m.settingsStore.get().traktAccount).toBeNull()
    expect(m.traktStore.get()).toEqual(m.emptyState)
    expect(calls).toEqual([{ method: 'POST', path: '/oauth/revoke', body: { token: 'good', client_id: 'cid' }, auth: undefined }])
    expect(sync.pushNow).toHaveBeenCalledTimes(1)
  })

  it('still signs out when Trakt cannot be reached', async () => {
    answers['/oauth/revoke'] = () => 'offline'
    m.settingsStore.set({ traktAccount: good })
    await m.signOut()
    expect(m.settingsStore.get().traktAccount).toBeNull()
  })
})

describe('checking a client id', () => {
  it('passes when Trakt accepts it and says what to do when it does not', async () => {
    answers['/genres/movies'] = () => ({ status: 200, json: [] })
    expect(await m.checkClientID(' cid ')).toBeUndefined()
    expect(calls[0]).toMatchObject({ auth: undefined })
    answers['/genres/movies'] = () => ({ status: 403 })
    expect(await m.checkClientID('bad')).toBe('Trakt didn’t accept this app’s client ID. Check it in Settings → Account.')
  })
})
