import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import worker from './worker.js'
import { createWindow, failWindow, maxBlob, maxCreates, maxFailures } from './account.js'

// The test vector in docs/SYNC.md (account number 0123 4567 8901 2345).
const id = '6b91a0a5eaaedba1be38e16c44719d9d'
const auth = 'krsalCjaziq29vmpL5N-9mFSKKxHw9Gh6kBIXzMtEVs'
const authHash = '7f8e801ad50486dc6ae701363fceaa06c36f4a2eacb469cecddee05a82bf9a59'
const blob = 'AAECAwQFBgcICQoL-YJfmbY_Yl_9mwPbJ5J_OFZ4fU5zMJZ57StJ4zawwoqNrv-vcg'
const page = { Origin: 'https://flow.example.com' }

/** A stand-in for a KV namespace: strings and metadata in a map, with list and expiry. */
function fakeKV() {
  const data = new Map()
  return {
    data,
    get: vi.fn(async (key) => data.get(key)?.value ?? null),
    put: vi.fn(async (key, value, options = {}) => void data.set(key, { value, metadata: options.metadata, ttl: options.expirationTtl })),
    delete: vi.fn(async (key) => void data.delete(key)),
    list: vi.fn(async ({ prefix = '' } = {}) => ({ keys: [...data.entries()].filter(([k]) => k.startsWith(prefix)).map(([name, v]) => ({ name, metadata: v.metadata })), list_complete: true })),
  }
}

const baseEnv = (extra = {}) => ({ ALLOWED_ORIGINS: 'https://flow.example.com', SYNC: fakeKV(), ...extra })

/** A request to an account route, signed in with the vector's auth unless told otherwise. */
const call = (method, env, { path = `/account/${id}`, headers = {}, body, bearer = auth, ip = '203.0.113.7' } = {}) => {
  const h = { 'CF-Connecting-IP': ip, ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}), ...headers }
  if (body !== undefined) h['Content-Type'] = 'application/json'
  return worker.fetch(new Request(`https://proxy.example.com${path}`, { method, headers: h, body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body) }), env)
}
const create = (env, extra) => call('POST', env, extra)
const put = (env, section, rev, text = blob, extra = {}) => call('PUT', env, { path: `/account/${id}/${section}`, body: { rev, blob: text }, ...extra })
const get = (env, section, extra = {}) => call('GET', env, { path: `/account/${id}${section ? `/${section}` : ''}`, ...extra })
const wrong = 'x'.repeat(43)

let log
beforeEach(() => {
  log = vi.spyOn(console, 'log').mockImplementation(() => {})
})
afterEach(() => {
  log.mockRestore()
  vi.useRealTimers()
})

describe('Marquee Accounts: creating and reading', () => {
  it('creates an account that stores only the hash of the auth key', async () => {
    const env = baseEnv()
    const res = await create(env)
    expect(res.status).toBe(201)
    expect((await res.json()).createdAt).toMatch(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/)
    expect(JSON.parse(env.SYNC.data.get(`acct:${id}`).value)).toMatchObject({ authHash })
    expect(JSON.stringify([...env.SYNC.data.values()])).not.toContain(auth)
  })

  it('answers 409 when the account exists and the caller holds its key, so Create Account picks another number', async () => {
    const env = baseEnv()
    await create(env)
    expect((await create(env)).status).toBe(409)
  })

  it('needs no token: the account routes take only the auth key', async () => {
    const env = baseEnv({ TOKEN: 'secret' })
    expect((await create(env)).status).toBe(201)
    expect((await get(env)).status).toBe(200)
  })

  it('lists sections with their rev, time and size, and nothing else', async () => {
    const env = baseEnv()
    await create(env)
    await put(env, 'settings', 0)
    await put(env, 'history-2026-10', 0, 'abc')
    const body = await (await get(env)).json()
    expect(Object.keys(body).sort()).toEqual(['createdAt', 'sections'])
    expect(body.sections.settings).toMatchObject({ rev: 1, size: blob.length })
    expect(body.sections['history-2026-10']).toMatchObject({ rev: 1, size: 3 })
    expect(body.sections.settings.updatedAt).toMatch(/Z$/)
  })

  it('has an empty section list for a new account, and 204 for a section nobody wrote', async () => {
    const env = baseEnv()
    await create(env)
    expect((await (await get(env)).json()).sections).toEqual({})
    expect((await get(env, 'lists')).status).toBe(204)
  })
})

describe('Marquee Accounts: sections', () => {
  it('writes with rev 0, goes up by one per write, and reads back rev, blob and updatedAt', async () => {
    const env = baseEnv()
    await create(env)
    expect(await (await put(env, 'lists', 0)).json()).toEqual({ rev: 1 })
    expect(await (await put(env, 'lists', 1, 'second')).json()).toEqual({ rev: 2 })
    const body = await (await get(env, 'lists')).json()
    expect(Object.keys(body).sort()).toEqual(['blob', 'rev', 'updatedAt'])
    expect(body).toMatchObject({ rev: 2, blob: 'second' })
  })

  it('keeps sections apart: a write to one leaves the others as they were', async () => {
    const env = baseEnv()
    await create(env)
    await put(env, 'lists', 0, 'one')
    await put(env, 'progress', 0, 'two')
    await put(env, 'lists', 1, 'three')
    expect((await (await get(env, 'progress')).json()).blob).toBe('two')
    expect((await (await get(env, 'progress')).json()).rev).toBe(1)
  })

  it('answers 409 with what is stored when the write was based on another rev', async () => {
    const env = baseEnv()
    await create(env)
    await put(env, 'lists', 0)
    await put(env, 'lists', 1, 'newer')
    const stale = await put(env, 'lists', 1, 'mine')
    expect(stale.status).toBe(409)
    expect(await stale.json()).toMatchObject({ rev: 2, blob: 'newer' })
    // A write for a section that doesn't exist, quoting a rev, is also a conflict with nothing stored.
    const missing = await put(env, 'progress', 3)
    expect(missing.status).toBe(409)
    expect(await missing.json()).toEqual({ rev: 0, blob: null, updatedAt: null })
  })

  it('refuses a malformed body, a value over 256 KB and bad section names', async () => {
    const env = baseEnv()
    await create(env)
    expect((await call('PUT', env, { path: `/account/${id}/lists`, body: '{nope' })).status).toBe(400)
    expect((await call('PUT', env, { path: `/account/${id}/lists`, body: { rev: -1, blob } })).status).toBe(400)
    expect((await put(env, 'lists', 0, 'a'.repeat(maxBlob + 1))).status).toBe(413)
    expect((await put(env, 'lists', 0, 'a'.repeat(maxBlob))).status).toBe(200)
    expect((await put(env, 'Has Spaces', 0)).status).toBe(404)
    expect((await put(env, '-lead', 0)).status).toBe(404)
    expect((await call('GET', env, { path: `/account/${id}/lists/extra` })).status).toBe(404)
    expect((await call('GET', env, { path: '/account/not-an-id' })).status).toBe(404)
  })

  it('deletes one section', async () => {
    const env = baseEnv()
    await create(env)
    await put(env, 'lists', 0)
    expect((await call('DELETE', env, { path: `/account/${id}/lists` })).status).toBe(204)
    expect((await get(env, 'lists')).status).toBe(204)
  })
})

describe('Marquee Accounts: deleting', () => {
  it('removes the account and every value', async () => {
    const env = baseEnv()
    await create(env)
    await put(env, 'settings', 0)
    await put(env, 'history-2026-10', 0)
    expect((await call('DELETE', env)).status).toBe(204)
    expect([...env.SYNC.data.keys()].filter((k) => k.startsWith('acct:'))).toEqual([])
    expect((await get(env)).status).toBe(404)
    // Another device that still holds the number finds nothing, and a stale write doesn't bring the account back.
    expect((await put(env, 'settings', 1)).status).toBe(404)
  })
})

describe('Marquee Accounts: who may ask', () => {
  it('answers a wrong key and an unknown account with the same 404', async () => {
    const env = baseEnv()
    await create(env)
    const wrongKey = await get(env, undefined, { bearer: wrong })
    const unknown = await call('GET', env, { path: `/account/${'0'.repeat(32)}` })
    expect(wrongKey.status).toBe(404)
    expect(unknown.status).toBe(404)
    expect(await wrongKey.text()).toBe(await unknown.text())
    expect((await put(env, 'lists', 0, blob, { bearer: wrong })).status).toBe(404)
    expect((await call('DELETE', env, { bearer: wrong })).status).toBe(404)
    expect(env.SYNC.data.has(`acct:${id}`)).toBe(true)
  })

  it('answers 401 without an Authorization header', async () => {
    const env = baseEnv()
    await create(env)
    expect((await get(env, undefined, { bearer: null })).status).toBe(401)
  })

  it('answers 501 without a KV namespace, and still answers OPTIONS', async () => {
    const env = { ALLOWED_ORIGINS: 'https://flow.example.com' }
    expect((await create(env)).status).toBe(501)
    expect((await call('OPTIONS', env, { headers: page })).status).toBe(204)
  })
})

describe('Marquee Accounts: rate limits', () => {
  it('answers 429 after 20 failed requests from one address, with Retry-After, and counts no success', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-11-01T10:00:00Z'))
    const env = baseEnv()
    await create(env)
    for (let i = 0; i < 50; i++) expect((await get(env)).status).toBe(200)
    for (let i = 0; i < maxFailures; i++) expect((await get(env, undefined, { bearer: wrong })).status).toBe(404)
    const limited = await get(env, undefined, { bearer: wrong })
    expect(limited.status).toBe(429)
    expect(Number(limited.headers.get('Retry-After'))).toBeGreaterThan(0)
    // Even the right key waits: the brake is on the address.
    expect((await get(env)).status).toBe(429)
    // Another address is untouched.
    expect((await get(env, undefined, { ip: '198.51.100.9' })).status).toBe(200)
  })

  it('lets the address in again once the window has passed', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-11-01T10:00:00Z'))
    const env = baseEnv()
    await create(env)
    for (let i = 0; i < maxFailures; i++) await get(env, undefined, { bearer: wrong })
    expect((await get(env)).status).toBe(429)
    vi.setSystemTime(Date.now() + failWindow * 1000 + 1000)
    expect((await get(env)).status).toBe(200)
  })

  it('stores counters with an expiry and no address', async () => {
    const env = baseEnv()
    await get(env, undefined, { bearer: wrong })
    const counter = [...env.SYNC.data.entries()].find(([k]) => k.startsWith('rl:fail:'))
    expect(counter[1].ttl).toBeGreaterThanOrEqual(60)
    expect(counter[1].ttl).toBeLessThanOrEqual(failWindow)
    expect(counter[0]).not.toContain('203.0.113.7')
  })

  it('counts a missing key and an unknown account as failures too', async () => {
    const env = baseEnv()
    for (let i = 0; i < maxFailures; i++) await call('GET', env, { path: `/account/${'1'.repeat(32)}` })
    expect((await call('GET', env, { path: `/account/${'1'.repeat(32)}` })).status).toBe(429)
  })

  it('limits new accounts to 10 an hour from one address', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-11-01T10:00:00Z'))
    const env = baseEnv()
    for (let i = 0; i < maxCreates; i++) expect((await call('POST', env, { path: `/account/${i.toString(16).padStart(32, '0')}` })).status).toBe(201)
    const more = await call('POST', env, { path: `/account/${'f'.repeat(32)}` })
    expect(more.status).toBe(429)
    vi.setSystemTime(Date.now() + createWindow * 1000 + 1000)
    expect((await call('POST', env, { path: `/account/${'f'.repeat(32)}` })).status).toBe(201)
  })

  it('uses the Cloudflare Rate Limiting binding too when there is one', async () => {
    const limit = vi.fn(async () => ({ success: false }))
    const env = baseEnv({ ACCOUNT_LIMITER: { limit } })
    expect((await create(env)).status).toBe(429)
    expect(limit).toHaveBeenCalledOnce()
    expect(JSON.stringify(limit.mock.calls)).not.toContain('203.0.113.7')
  })
})

describe('Marquee Accounts: CORS', () => {
  it('answers a preflight for a listed page with the methods and headers accounts use, and no token header', async () => {
    const res = await call('OPTIONS', baseEnv(), { headers: page, bearer: null })
    expect(res.status).toBe(204)
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('https://flow.example.com')
    expect(res.headers.get('Access-Control-Allow-Methods')).toBe('GET, POST, PUT, DELETE, OPTIONS')
    expect(res.headers.get('Access-Control-Allow-Headers')).toBe('Authorization, Content-Type')
  })

  it('refuses a page that is not listed, even for a request that has the right key', async () => {
    const env = baseEnv()
    await create(env)
    const other = { Origin: 'https://evil.example.com' }
    const res = await get(env, undefined, { headers: other })
    expect(res.status).toBe(403)
    expect(res.headers.get('Access-Control-Allow-Origin')).toBeNull()
    expect((await call('OPTIONS', env, { headers: other, bearer: null })).status).toBe(403)
  })

  it('lets the apps in: they send no Origin', async () => {
    const env = baseEnv()
    expect((await create(env)).status).toBe(201)
  })

  it('puts the allowed origin on every answer, errors included', async () => {
    const env = baseEnv()
    const res = await get(env, undefined, { headers: page, bearer: wrong })
    expect(res.status).toBe(404)
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('https://flow.example.com')
  })
})

describe('Marquee Accounts: the sync routes are untouched', () => {
  it('still answers /sync with the token rule', async () => {
    const env = baseEnv({ TOKEN: 'secret' })
    const res = await worker.fetch(new Request(`https://proxy.example.com/sync/${id}`, { headers: { Authorization: `Bearer ${auth}` } }), env)
    expect(res.status).toBe(401)
  })
})
