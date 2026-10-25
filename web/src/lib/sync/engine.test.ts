import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
// @ts-expect-error The Worker is plain JavaScript.
import worker from '../../../proxy/worker.js'
import type { Payload } from './payload'

/* The engine against the real Worker code, with an in-memory KV and an in-memory localStorage. A second
   device is played by writing to the KV directly, the way the Apple apps would. */

const origin = 'https://sync.example.com'
const addon = { url: 'https://a.example.com/manifest.json', name: 'A', enabled: true }

function memoryStorage() {
  const data = new Map<string, string>()
  return { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, String(v)), removeItem: (k: string) => void data.delete(k), clear: () => data.clear(), key: () => null, length: 0 }
}

function fakeKV() {
  const data = new Map<string, string>()
  return { data, get: async (k: string) => data.get(k) ?? null, put: async (k: string, v: string) => void data.set(k, v), delete: async (k: string) => void data.delete(k) }
}

type Modules = Awaited<ReturnType<typeof load>>
async function load() {
  vi.resetModules()
  const settings = await import('../store/settings')
  const engine = await import('./engine')
  const config = await import('./config')
  const crypto = await import('./crypto')
  return { ...settings, ...engine, ...config, ...crypto }
}

let m: Modules
let kv: ReturnType<typeof fakeKV>
let env: Record<string, unknown>
let calls: string[]
/** Runs before a request reaches the Worker: the other device getting in first. */
let beforeRequest: ((method: string) => Promise<void>) | undefined
let log: ReturnType<typeof vi.spyOn>

beforeEach(async () => {
  vi.stubGlobal('localStorage', memoryStorage())
  vi.stubGlobal('document', { addEventListener() {}, visibilityState: 'visible' })
  kv = fakeKV()
  env = { ALLOWED_ORIGINS: 'https://flow.example.com', SYNC: kv, TOKEN: 's3cret' }
  calls = []
  beforeRequest = undefined
  log = vi.spyOn(console, 'log').mockImplementation(() => {})
  vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
    const method = init.method ?? 'GET'
    calls.push(method)
    await beforeRequest?.(method)
    return worker.fetch(new Request(url, init), env)
  })
  m = await load()
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  log.mockRestore()
})

/** What a record holds, decrypted. */
async function readRecord(): Promise<Payload | null> {
  const bytes = m.parseKey(m.loadConfig()!.key)!
  const keys = await m.deriveKeys(bytes)
  const raw = kv.data.get(keys.id)
  return raw ? JSON.parse(await m.decrypt(keys, JSON.parse(raw).blob)) : null
}

/** Another device changes the record. */
async function otherDevice(change: (payload: Payload) => void, minutes = 30) {
  const keys = await m.deriveKeys(m.parseKey(m.loadConfig()!.key)!)
  const stored = JSON.parse(kv.data.get(keys.id)!)
  const payload = JSON.parse(await m.decrypt(keys, stored.blob)) as Payload
  change(payload)
  for (const s of Object.values(payload.sections)) if (!s.updatedAt) s.updatedAt = new Date(Date.UTC(2099, 0, 1, 0, minutes)).toISOString()
  kv.data.set(keys.id, JSON.stringify({ ...stored, rev: stored.rev + 1, blob: await m.encrypt(keys, JSON.stringify(payload)) }))
}
const future = (minutes: number) => new Date(Date.UTC(2099, 0, 1, 0, minutes)).toISOString().replace('.000Z', 'Z')
const puts = () => calls.filter((c) => c === 'PUT').length

describe('turning sync on', () => {
  it('makes a key, stores this browser’s settings encrypted, and remembers the setup', async () => {
    m.settingsStore.set({ tmdbKey: 'abc', addons: [addon] })
    expect(await m.turnOn(origin, 's3cret')).toEqual({ ok: true })
    const config = m.loadConfig()!
    expect(config).toMatchObject({ server: origin, token: 's3cret' })
    expect(m.parseKey(config.key)).not.toBeNull()
    const record = (await readRecord())!
    expect(record.v).toBe(1)
    expect(Object.keys(record.sections).sort()).toEqual(['addons', 'keys'])
    expect(record.sections.keys!.data).toEqual({ tmdbAPIKey: 'abc' })
    // Nothing readable is on the server.
    expect(JSON.stringify([...kv.data.values()])).not.toContain('tmdb')
    expect(m.syncStatus.get()).toMatchObject({ phase: 'idle' })
    expect(m.syncStatus.get().lastSyncAt).toBeTruthy()
  })

  it('starts an empty record for a browser with nothing set up, so the other devices have something to join', async () => {
    expect(await m.turnOn(origin, 's3cret')).toEqual({ ok: true })
    expect(await readRecord()).toEqual({ v: 1, sections: {} })
  })

  it('writes nothing again when nothing changed', async () => {
    m.settingsStore.set({ tmdbKey: 'abc' })
    await m.turnOn(origin, 's3cret')
    expect(puts()).toBe(1)
    await m.syncNow()
    await m.syncNow()
    expect(puts()).toBe(1)
    expect(calls.filter((c) => c === 'GET').length).toBeGreaterThanOrEqual(3)
  })

  it('does not keep the setup when the server cannot be reached', async () => {
    vi.stubGlobal('fetch', async () => {
      throw new TypeError('Failed to fetch')
    })
    const out = await m.turnOn(origin, 's3cret')
    expect(out).toEqual({ ok: false, error: expect.stringContaining('Couldn’t reach your sync server. Check its address and token') })
    expect(m.loadConfig()).toBeNull()
    expect(m.syncStatus.get().phase).toBe('off')
  })

  it('says what to do when the Worker has no KV namespace, or the token is wrong', async () => {
    env.SYNC = undefined
    expect(await m.turnOn(origin, 's3cret')).toEqual({ ok: false, error: expect.stringContaining('Sync needs a KV namespace') })
    env.SYNC = kv
    expect(await m.turnOn(origin, 'wrong')).toEqual({ ok: false, error: expect.stringContaining('didn’t accept the token') })
    expect(m.loadConfig()).toBeNull()
  })
})

describe('pulling', () => {
  it('applies what another device wrote, and leaves the times alone so nothing is written back', async () => {
    await m.turnOn(origin, 's3cret')
    await otherDevice((p) => {
      p.sections.keys = { updatedAt: future(1), device: 'iPhone', data: { tmdbAPIKey: 'from-phone', tvdbAPIKey: 'tvdb' } }
      p.sections.playback = { updatedAt: future(2), device: 'iPhone', data: { audioLanguages: ['fr'], subtitleLanguages: ['fr'], subtitleStyle: { color: 'yellow', fontScale: 1.4 } } }
    })
    const before = puts()
    await m.syncNow()
    const s = m.settingsStore.get()
    expect(s.tmdbKey).toBe('from-phone')
    expect(s.onboarded).toBe(true)
    expect(s.audioLanguages).toEqual(['fr'])
    expect(s.subtitleStyle).toMatchObject({ color: 'yellow', fontScale: 1.4 })
    expect(puts()).toBe(before)
    expect(m.loadConfig()!.metas.keys).toMatchObject({ updatedAt: future(1), device: 'iPhone' })
  })

  it('keeps what the web does not use when it writes later', async () => {
    await m.turnOn(origin, 's3cret')
    await otherDevice((p) => {
      p.sections.accounts = { updatedAt: future(1), device: 'iPhone', data: { trakt: { accessToken: 'a', refreshToken: 'r', expiresAt: null, redirectURI: 'flow://trakt' }, simkl: null } }
      p.sections.keys = { updatedAt: future(1), device: 'iPhone', data: { tmdbAPIKey: 'k', tvdbAPIKey: 'tvdb' } }
      p.sections.mystery = { updatedAt: future(1), device: 'iPhone', data: [1, 2] }
    })
    await m.syncNow()
    m.settingsStore.set({ addons: [addon] })
    await m.syncNow()
    const record = (await readRecord())!
    expect(record.sections.accounts!.data).toMatchObject({ trakt: { accessToken: 'a' } })
    expect(record.sections.mystery!.data).toEqual([1, 2])
    expect(record.sections.keys!.data).toEqual({ tmdbAPIKey: 'k', tvdbAPIKey: 'tvdb' })
    expect(record.sections.addons!.data).toEqual([addon])
  })

  it('reports a record it cannot read, or one from a newer format', async () => {
    await m.turnOn(origin, 's3cret')
    const keys = await m.deriveKeys(m.parseKey(m.loadConfig()!.key)!)
    const stored = JSON.parse(kv.data.get(keys.id)!)
    kv.data.set(keys.id, JSON.stringify({ ...stored, rev: 2, blob: await m.encrypt(keys, '{"v":2,"sections":{}}') }))
    await m.syncNow()
    expect(m.syncStatus.get()).toMatchObject({ phase: 'error', error: expect.stringContaining('newer version of Flow Sync') })
    kv.data.set(keys.id, JSON.stringify({ ...stored, rev: 3, blob: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' }))
    await m.syncNow()
    expect(m.syncStatus.get()).toMatchObject({ phase: 'error', error: expect.stringContaining('Couldn’t read the synced data') })
  })

  it('says the record is gone when another device erased it, and does not bring it back', async () => {
    await m.turnOn(origin, 's3cret')
    kv.data.clear()
    await m.syncNow()
    expect(m.syncStatus.get()).toMatchObject({ phase: 'error', error: expect.stringContaining('Nothing is stored for this sync key any more') })
    expect(kv.data.size).toBe(0)
    m.settingsStore.set({ tmdbKey: 'typed-after' })
    await m.syncNow()
    expect(kv.data.size).toBe(0)
  })
})

describe('pushing', () => {
  it('writes about three seconds after the last change, once, however many changes', async () => {
    m.settingsStore.set({ tmdbKey: 'abc' })
    await m.turnOn(origin, 's3cret')
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const before = puts()
    for (const typed of ['t', 'tm', 'tmd', 'tmdb']) {
      m.settingsStore.set({ tmdbKey: typed })
      await vi.advanceTimersByTimeAsync(500)
    }
    expect(puts()).toBe(before)
    await vi.advanceTimersByTimeAsync(m.pushDelay - 500 - 1)
    expect(puts()).toBe(before)
    await vi.advanceTimersByTimeAsync(1)
    await vi.waitFor(() => expect(puts()).toBe(before + 1))
    expect(((await readRecord())!.sections.keys!.data as Record<string, unknown>).tmdbAPIKey).toBe('tmdb')
  })

  it('pushes a Trakt sign-in at once, in the apps’ shape, without waiting for the delay', async () => {
    await m.turnOn(origin, 's3cret')
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const redirectURI = 'https://flow.example.com/settings/trakt-callback'
    m.settingsStore.set({ traktClientID: 'cid', traktAccount: { accessToken: 'a', refreshToken: 'r', expiresAt: '2030-01-01T00:00:00Z', redirectURI } })
    await m.pushNow()
    const record = (await readRecord())!
    expect(record.sections.accounts!.data).toEqual({ trakt: { accessToken: 'a', refreshToken: 'r', expiresAt: '2030-01-01T00:00:00Z', redirectURI } })
    expect(record.sections.keys!.data).toMatchObject({ traktClientID: 'cid' })
    // The delayed push that the change scheduled has nothing left to send.
    const before = puts()
    await vi.advanceTimersByTimeAsync(m.pushDelay * 2)
    expect(puts()).toBe(before)
  })

  it('signs the website in to Trakt from a token another device pushed, with no prompt', async () => {
    await m.turnOn(origin, 's3cret')
    await otherDevice((p) => {
      p.sections.keys = { updatedAt: future(1), device: 'iPhone', data: { tmdbAPIKey: 'k', traktClientID: 'phone-cid', traktClientSecret: 'secret' } }
      p.sections.accounts = { updatedAt: future(1), device: 'iPhone', data: { trakt: { accessToken: 'phone-a', refreshToken: 'phone-r', expiresAt: '2030-01-01T00:00:00Z', redirectURI: 'flow://trakt-callback' }, simkl: { accessToken: 'sk' } } }
    })
    await m.syncNow()
    expect(m.settingsStore.get().traktClientID).toBe('phone-cid')
    expect(m.settingsStore.get().traktAccount).toEqual({ accessToken: 'phone-a', refreshToken: 'phone-r', expiresAt: '2030-01-01T00:00:00Z', redirectURI: 'flow://trakt-callback' })
    // Signing out here travels too, and the client secret and Simkl are not touched.
    m.settingsStore.set({ traktAccount: null })
    await m.pushNow()
    const record = (await readRecord())!
    expect(record.sections.accounts!.data).toEqual({ trakt: null, simkl: { accessToken: 'sk' } })
    expect(record.sections.keys!.data).toMatchObject({ traktClientSecret: 'secret' })
  })

  it('stamps the time of the change, not of the upload', async () => {
    await m.turnOn(origin, 's3cret')
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
    vi.setSystemTime(new Date('2030-01-01T10:00:00Z'))
    m.settingsStore.set({ streamProxy: `${origin}/?url={url}` })
    vi.setSystemTime(new Date('2030-01-01T10:00:03Z'))
    await vi.advanceTimersByTimeAsync(m.pushDelay)
    await vi.waitFor(async () => expect((await readRecord())!.sections.streamProxy).toBeTruthy())
    expect((await readRecord())!.sections.streamProxy!.updatedAt).toBe('2030-01-01T10:00:00Z')
  })

  it('does not write when only a setting that never syncs changed', async () => {
    await m.turnOn(origin, 's3cret')
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const before = puts()
    m.settingsStore.set({ font: 'inter', autoplayNext: false })
    await vi.advanceTimersByTimeAsync(m.pushDelay * 2)
    expect(puts()).toBe(before)
  })

  it('merges and writes again when another device wrote first', async () => {
    m.settingsStore.set({ tmdbKey: 'abc' })
    await m.turnOn(origin, 's3cret')
    await m.syncNow()
    m.settingsStore.set({ tmdbKey: 'abcd' })
    let once = false
    beforeRequest = async (method) => {
      if (method !== 'PUT' || once) return
      once = true
      await otherDevice((p) => {
        p.sections.addons = { updatedAt: future(5), device: 'iPad', data: [addon] }
      })
    }
    const before = puts()
    await m.syncNow()
    expect(puts() - before).toBe(2)
    const record = (await readRecord())!
    expect(record.sections.keys!.data).toEqual({ tmdbAPIKey: 'abcd' })
    expect(record.sections.addons!.data).toEqual([addon])
    expect(m.settingsStore.get().addons).toEqual([addon])
    expect(m.syncStatus.get().phase).toBe('idle')
  })

  it('gives up after three tries and says so', async () => {
    await m.turnOn(origin, 's3cret')
    let n = 0
    beforeRequest = async (method) => {
      if (method !== 'PUT') return
      const at = ++n
      await otherDevice((p) => {
        p.sections.streamProxy = { updatedAt: future(at), device: 'iPad', data: { template: `${origin}/?n=${at}&url={url}` } }
      })
    }
    m.settingsStore.set({ tmdbKey: 'abc' })
    await m.syncNow()
    expect(m.syncStatus.get()).toMatchObject({ phase: 'error', error: expect.stringContaining('Another device kept changing your settings') })
    expect(n).toBe(4)
  })
})

describe('joining', () => {
  it('takes the other device’s settings, and keeps what it has that they lack', async () => {
    await m.turnOn(origin, 's3cret')
    m.settingsStore.set({ tmdbKey: 'shared', addons: [addon] })
    await m.syncNow()
    const key = m.parseKey(m.loadConfig()!.key)!

    // A second browser, with a key and a proxy of its own.
    const first = JSON.parse(localStorage.getItem('flow.settings.v1') ?? '{}')
    expect(first.tmdbKey).toBe('shared')
    m.turnOff()
    m.settingsStore.set({ tmdbKey: 'mine', addons: [], streamProxy: `${origin}/?url={url}`, onboarded: false })
    const out = await m.joinSync({ key, server: origin, token: 's3cret' })
    expect(out).toEqual({ ok: true })
    const s = m.settingsStore.get()
    expect(s.tmdbKey).toBe('shared')
    expect(s.addons).toEqual([addon])
    expect(s.streamProxy).toBe(`${origin}/?url={url}`)
    const record = (await readRecord())!
    expect(record.sections.keys!.data).toEqual({ tmdbAPIKey: 'shared' })
    expect((record.sections.streamProxy!.data as { template: string }).template).toBe(`${origin}/?url={url}`)
  })

  it('refuses a key nobody has started a record for, and keeps nothing', async () => {
    const key = m.makeKeyBytes()
    const out = await m.joinSync({ key, server: origin, token: 's3cret' })
    expect(out).toEqual({ ok: false, error: expect.stringContaining('Nothing is stored for that sync key yet') })
    expect(m.loadConfig()).toBeNull()
    expect(kv.data.size).toBe(0)
  })

  it('refuses a key that belongs to a different record owner', async () => {
    await m.turnOn(origin, 's3cret')
    const keys = await m.deriveKeys(m.parseKey(m.loadConfig()!.key)!)
    // Somebody holding the record's name but not its key.
    const stored = JSON.parse(kv.data.get(keys.id)!)
    kv.data.set(keys.id, JSON.stringify({ ...stored, authHash: 'f'.repeat(64) }))
    await m.syncNow()
    expect(m.syncStatus.get()).toMatchObject({ phase: 'error', error: 'This sync key doesn’t match.' })
  })
})

describe('turning off', () => {
  it('Turn Off forgets the key and keeps the settings and the record', async () => {
    m.settingsStore.set({ tmdbKey: 'abc' })
    await m.turnOn(origin, 's3cret')
    m.turnOff()
    expect(m.loadConfig()).toBeNull()
    expect(m.settingsStore.get().tmdbKey).toBe('abc')
    expect(kv.data.size).toBe(1)
    expect(m.syncStatus.get().phase).toBe('off')
    const before = calls.length
    await m.syncNow()
    expect(calls.length).toBe(before)
  })

  it('Turn Off and Erase also deletes the record', async () => {
    m.settingsStore.set({ tmdbKey: 'abc' })
    await m.turnOn(origin, 's3cret')
    expect(await m.turnOffAndErase()).toEqual({ ok: true })
    expect(kv.data.size).toBe(0)
    expect(m.loadConfig()).toBeNull()
    expect(m.settingsStore.get().tmdbKey).toBe('abc')
  })

  it('stays on, and says why, when the erase did not go through', async () => {
    await m.turnOn(origin, 's3cret')
    env.TOKEN = 'changed'
    const out = await m.turnOffAndErase()
    expect(out).toEqual({ ok: false, error: expect.stringContaining('Couldn’t erase it.') })
    expect(m.loadConfig()).not.toBeNull()
    expect(kv.data.size).toBe(1)
  })

  it('gives the pairing link for the key', async () => {
    vi.stubGlobal('location', { origin: 'https://flow.example.com' })
    await m.turnOn(origin, 's3cret')
    const config = m.loadConfig()!
    expect(m.pairingLink()).toBe(`https://flow.example.com/settings#sync=k=${config.key}&s=${encodeURIComponent(origin)}&t=s3cret`)
  })
})
