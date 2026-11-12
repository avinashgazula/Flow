import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
// @ts-expect-error The Worker is plain JavaScript.
import worker from '../../../proxy/worker.js'
import type { MediaItem } from '../tmdb/types'

/* The account engine against the real Worker code, with an in-memory KV. Each "device" is a fresh load of the modules
   with its own localStorage, all talking to the same Worker and KV, the way two browsers (or a browser and an app) would. */

const server = 'https://accounts.example.com'
const addon = { url: 'https://a.example.com/manifest.json', name: 'A', enabled: true }
const item = (id: number, type: 'movie' | 'show' = 'movie'): MediaItem => ({ type, id, title: `Title ${id}`, overview: '', genres: [18], poster: `/p${id}.jpg` })

function memoryStorage() {
  const data = new Map<string, string>()
  return { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, String(v)), removeItem: (k: string) => void data.delete(k), clear: () => data.clear(), key: () => null, length: 0 }
}

function fakeKV() {
  const data = new Map<string, { value: string; metadata?: unknown }>()
  return {
    data,
    get: async (k: string) => data.get(k)?.value ?? null,
    put: async (k: string, value: string, options: { metadata?: unknown } = {}) => void data.set(k, { value, metadata: options.metadata }),
    delete: async (k: string) => void data.delete(k),
    list: async ({ prefix = '' }: { prefix?: string } = {}) => ({ keys: [...data.entries()].filter(([k]) => k.startsWith(prefix)).map(([name, v]) => ({ name, metadata: v.metadata })), list_complete: true }),
  }
}

type Device = Awaited<ReturnType<typeof boot>>
/** A fresh browser: new modules, empty storage. */
async function boot() {
  vi.resetModules()
  vi.stubGlobal('localStorage', memoryStorage())
  const settings = await import('../store/settings')
  const library = await import('../store/library')
  const sources = await import('../sources/lastSource')
  const engine = await import('./engine')
  const config = await import('./config')
  return { ...settings, ...library, ...sources, ...engine, ...config, storage: localStorage }
}

/** Gives the page's modules back their own storage, for the device that is acting now. */
const use = (d: Device) => vi.stubGlobal('localStorage', d.storage)

let kv: ReturnType<typeof fakeKV>
let log: ReturnType<typeof vi.spyOn>
beforeEach(() => {
  vi.stubEnv('VITE_ACCOUNT_SERVER', server)
  vi.stubGlobal('document', { addEventListener() {}, visibilityState: 'visible' })
  kv = fakeKV()
  log = vi.spyOn(console, 'log').mockImplementation(() => {})
  vi.stubGlobal('fetch', async (url: string, init: RequestInit) => worker.fetch(new Request(url, init), { ALLOWED_ORIGINS: 'https://flow.example.com', SYNC: kv }))
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
  log.mockRestore()
})

const names = () => [...kv.data.keys()].filter((k) => k.startsWith('acct:') && k.length > 38).map((k) => k.slice(38))

describe('Marquee Accounts on the web', () => {
  it('creates an account: a 16-digit number, and everything this browser holds uploaded, encrypted', async () => {
    const a = await boot()
    a.settingsStore.set({ tmdbKey: 'MY-TMDB-KEY', onboarded: true, addons: [addon] })
    a.libraryStore.set({ watchlist: [{ key: 'movie:1', item: item(1), addedAt: Date.now() - 1000 }], ratings: { 'movie:1': 9 } })
    const made = await a.createAccount()
    expect(made.ok).toBe(true)
    const number = made.ok ? (made.number ?? '') : ''
    expect(number).toMatch(/^\d{16}$/)
    expect(a.currentNumber()).toBe(number)
    expect(names().sort()).toEqual(['items-1', 'lists', 'settings'])
    // The Worker holds nothing readable: not the number, not the key, not a title.
    const stored = JSON.stringify([...kv.data.values()])
    expect(stored).not.toContain(number)
    expect(stored).not.toContain('MY-TMDB-KEY')
    expect(stored).not.toContain('Title 1')
    expect(a.accountStatus.get().phase).toBe('idle')
  })

  it('logs in on another device with only the number: settings and library arrive, and what that device had is kept and merged', async () => {
    const a = await boot()
    a.settingsStore.set({ tmdbKey: 'MY-TMDB-KEY', onboarded: true, addons: [addon] })
    a.libraryStore.set({
      watchlist: [{ key: 'movie:1', item: item(1), addedAt: Date.now() - 1000 }],
      progress: { 'show:5': { key: 'show:5', item: item(5, 'show'), episode: { season: 2, episode: 3 }, position: 600, duration: 3000, updatedAt: Date.now() - 500 } },
      history: [{ key: 'movie:1', item: item(1), watchedAt: Date.now() - 4000 }],
    })
    a.lastSourceStore.set({ byTitle: { 'movie:1': { providerId: 'p', filename: 'x.mkv', resolution: '1080p', date: Date.now() - 800 } } })
    const made = await a.createAccount()
    const number = made.ok ? (made.number ?? '') : ''

    const b = await boot()
    b.libraryStore.set({ watchlist: [{ key: 'movie:2', item: item(2), addedAt: Date.now() - 2000 }] })
    const wrong = await b.logIn('0000 0000 0000 0000')
    expect(wrong).toEqual({ ok: false, error: expect.stringContaining('No account matches') })
    expect(b.accountIsOn()).toBe(false)
    expect((await b.logIn('1234')).ok).toBe(false)

    // Typed the way a person would: grouped, with spaces.
    const joined = await b.logIn(`${number.slice(0, 4)} ${number.slice(4, 8)} ${number.slice(8, 12)} ${number.slice(12)}`)
    expect(joined.ok).toBe(true)
    expect(b.settingsStore.get().tmdbKey).toBe('MY-TMDB-KEY')
    expect(b.settingsStore.get().addons[0]?.url).toBe(addon.url)
    expect(b.libraryStore.get().watchlist.map((e) => e.key).sort()).toEqual(['movie:1', 'movie:2'])
    expect(b.libraryStore.get().watchlist.find((e) => e.key === 'movie:1')?.item.title).toBe('Title 1')
    expect(b.libraryStore.get().progress['show:5']).toMatchObject({ position: 600, duration: 3000, episode: { season: 2, episode: 3 } })
    expect(b.libraryStore.get().history).toHaveLength(1)
    expect(b.lastSourceStore.get().byTitle['movie:1']).toMatchObject({ providerId: 'p', filename: 'x.mkv', resolution: '1080p' })

    // The first device picks up what the second brought.
    use(a)
    await a.syncNow()
    expect(a.libraryStore.get().watchlist.map((e) => e.key).sort()).toEqual(['movie:1', 'movie:2'])
  })

  it('carries a removal to the other device, and not back again', async () => {
    const a = await boot()
    a.libraryStore.set({ watchlist: [{ key: 'movie:1', item: item(1), addedAt: Date.now() - 5000 }] })
    const made = await a.createAccount()
    const number = made.ok ? (made.number ?? '') : ''
    const b = await boot()
    await b.logIn(number)
    expect(b.libraryStore.get().watchlist).toHaveLength(1)
    b.libraryStore.set({ watchlist: [] })
    await b.syncNow()
    use(a)
    await a.syncNow()
    expect(a.libraryStore.get().watchlist).toEqual([])
    use(b)
    await b.syncNow()
    expect(b.libraryStore.get().watchlist).toEqual([])
  })

  it('writes only the value that changed', async () => {
    const a = await boot()
    a.libraryStore.set({ watchlist: [{ key: 'movie:1', item: item(1), addedAt: Date.now() - 5000 }] })
    await a.createAccount()
    const before = new Map([...kv.data].map(([k, v]) => [k, v.value]))
    a.libraryStore.set({ ratings: { 'movie:1': 7 } })
    await a.syncNow()
    const changed = [...kv.data].filter(([k, v]) => before.get(k) !== v.value).map(([k]) => k.slice(38))
    expect(changed).toEqual(['lists'])
  })

  it('merges with a change another device makes while this one writes', async () => {
    const a = await boot()
    a.libraryStore.set({ watchlist: [{ key: 'movie:1', item: item(1), addedAt: Date.now() - 5000 }] })
    const made = await a.createAccount()
    const number = made.ok ? (made.number ?? '') : ''
    const b = await boot()
    await b.logIn(number)
    b.libraryStore.set({ favourites: [{ key: 'movie:2', item: item(2), addedAt: Date.now() - 100 }] })
    await b.syncNow()
    // Device a, still on the older revision, adds to the same value.
    use(a)
    a.libraryStore.set({ watchlist: [...a.libraryStore.get().watchlist, { key: 'movie:3', item: item(3), addedAt: Date.now() - 50 }] })
    await a.syncNow()
    expect(a.accountStatus.get().phase).toBe('idle')
    expect(a.libraryStore.get().favourites.map((e) => e.key)).toEqual(['movie:2'])
    use(b)
    await b.syncNow()
    expect(b.libraryStore.get().watchlist.map((e) => e.key).sort()).toEqual(['movie:1', 'movie:3'])
  })

  it('logs out keeping the data, or clearing it', async () => {
    const a = await boot()
    a.settingsStore.set({ tmdbKey: 'KEY', onboarded: true })
    a.libraryStore.set({ watchlist: [{ key: 'movie:1', item: item(1), addedAt: Date.now() - 5000 }] })
    await a.createAccount()
    a.logOut(true)
    expect(a.accountIsOn()).toBe(false)
    expect(a.accountStatus.get().phase).toBe('off')
    expect(a.libraryStore.get().watchlist).toHaveLength(1)
    expect(a.settingsStore.get().tmdbKey).toBe('KEY')
    expect(names().length).toBeGreaterThan(0)

    const b = await boot()
    b.settingsStore.set({ tmdbKey: 'KEY', onboarded: true })
    b.libraryStore.set({ watchlist: [{ key: 'movie:1', item: item(1), addedAt: Date.now() - 5000 }] })
    await b.createAccount()
    b.logOut(false)
    expect(b.libraryStore.get().watchlist).toEqual([])
    expect(b.settingsStore.get().tmdbKey).toBe('')
    expect(b.settingsStore.get().onboarded).toBe(false)
    // Clearing here doesn't delete anything from the account.
    expect(names()).toContain('lists')
  })

  it('deletes the account and every value, and tells another device it is gone', async () => {
    const a = await boot()
    a.libraryStore.set({ watchlist: [{ key: 'movie:1', item: item(1), addedAt: Date.now() - 5000 }] })
    const made = await a.createAccount()
    const number = made.ok ? (made.number ?? '') : ''
    const b = await boot()
    await b.logIn(number)
    use(a)
    expect(await a.deleteAccount()).toEqual({ ok: true })
    expect([...kv.data.keys()].filter((k) => k.startsWith('acct:'))).toEqual([])
    expect(a.accountIsOn()).toBe(false)
    expect(a.libraryStore.get().watchlist).toHaveLength(1)
    use(b)
    await b.syncNow()
    expect(b.accountStatus.get()).toMatchObject({ phase: 'error', error: expect.stringContaining('no longer exists') })
    expect(b.libraryStore.get().watchlist).toHaveLength(1)
  })

  it('says what to do when the server has no KV namespace or is out of reach', async () => {
    const a = await boot()
    vi.stubGlobal('fetch', async (url: string, init: RequestInit) => worker.fetch(new Request(url, init), { ALLOWED_ORIGINS: 'https://flow.example.com' }))
    expect(await a.createAccount()).toEqual({ ok: false, error: expect.stringContaining('KV namespace') })
    vi.stubGlobal('fetch', async () => {
      throw new TypeError('offline')
    })
    expect(await a.createAccount()).toEqual({ ok: false, error: expect.stringContaining('Couldn’t reach') })
    expect(a.accountIsOn()).toBe(false)
  })

  it('needs a server: none in the build, none in the stream proxy', async () => {
    vi.stubEnv('VITE_ACCOUNT_SERVER', '')
    const a = await boot()
    expect(await a.createAccount()).toEqual({ ok: false, error: expect.stringContaining('no account server') })
    a.settingsStore.set({ streamProxy: 'https://proxy.example.com/?url={url}' })
    expect(a.accountServer()).toEqual({ server: 'https://proxy.example.com', source: 'proxy' })
  })

  it('moves an older Marquee Sync pairing to an account', async () => {
    const a = await boot()
    a.settingsStore.set({ tmdbKey: 'KEY', onboarded: true })
    // A pairing as Marquee Sync keeps it.
    a.storage.setItem('flow.sync.v1', JSON.stringify({ key: '000G40R40M30E209185GR38E1W', server: 'https://old.example.com', token: '', metas: {} }))
    const moved = await a.moveToAccount()
    expect(moved.ok).toBe(true)
    expect(a.storage.getItem('flow.sync.v1')).toBeNull()
    expect(a.accountIsOn()).toBe(true)
    expect(names()).toContain('settings')
  })
})
