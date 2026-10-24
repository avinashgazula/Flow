import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import worker from './worker.js'
import { maxBlob } from './sync.js'

// The test vector in docs/SYNC.md.
const id = '625ee37823f4fad87a1591ef9038d5c6'
const auth = 'MF8YRcz1DFlJqMdCJgMOrexYxSLXV50cYLJsfg2ts50'
const authHash = '4c921fbf5d2aa65f33ff2423208ef4628a74ddb6f96196e2ff212c073cbd02b0'
const blob = 'AAECAwQFBgcICQoLGAP4YCx3YYoDIGnxPMRrrawbsS-rAxRzm-9OU5yZM8MHg9rlLg'
const page = { Origin: 'https://flow.example.com' }

/** A stand-in for a KV namespace: strings in a map, the calls that sync uses. */
function fakeKV(initial = {}) {
  const data = new Map(Object.entries(initial))
  return {
    data,
    get: vi.fn(async (key) => data.get(key) ?? null),
    put: vi.fn(async (key, value) => void data.set(key, value)),
    delete: vi.fn(async (key) => void data.delete(key)),
  }
}

const baseEnv = (extra = {}) => ({ ALLOWED_ORIGINS: 'https://flow.example.com', ALLOWED_HOSTS: 'play.example.com', SYNC: fakeKV(), ...extra })

/** A request to a sync route, signed in with the vector's auth unless told otherwise. */
const call = (method, env, { path = `/sync/${id}`, headers = {}, body, bearer = auth, token } = {}) => {
  const h = { ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}), ...headers }
  if (body !== undefined) h['Content-Type'] = 'application/json'
  return worker.fetch(new Request(`https://proxy.example.com${path}`, { method, headers: h, body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body) }), env)
}
const put = (env, rev, text = blob, extra = {}) => call('PUT', env, { body: { rev, blob: text }, ...extra })
const stored = (env) => JSON.parse(env.SYNC.data.get(id))

let log
beforeEach(() => {
  log = vi.spyOn(console, 'log').mockImplementation(() => {})
})
afterEach(() => log.mockRestore())

describe('Flow Sync: the record', () => {
  it('has nothing until the first write, then stores it with rev 1 and the hash of the auth', async () => {
    const env = baseEnv()
    expect((await call('GET', env)).status).toBe(404)
    const res = await put(env, 0)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ rev: 1 })
    const record = stored(env)
    expect(record).toMatchObject({ authHash, rev: 1, blob })
    // ISO 8601 to the second, so strict parsers on the Apple side read it.
    expect(record.updatedAt).toMatch(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/)
  })

  it('reads back rev, blob and updatedAt, and never the hash', async () => {
    const env = baseEnv()
    await put(env, 0)
    const res = await call('GET', env)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(Object.keys(body).sort()).toEqual(['blob', 'rev', 'updatedAt'])
    expect(body).toMatchObject({ rev: 1, blob })
  })

  it('goes up by one per write based on the current rev', async () => {
    const env = baseEnv()
    await put(env, 0)
    expect(await (await put(env, 1, 'second')).json()).toEqual({ rev: 2 })
    expect(await (await put(env, 2, 'third')).json()).toEqual({ rev: 3 })
    expect((await (await call('GET', env)).json()).blob).toBe('third')
    expect(stored(env).authHash).toBe(authHash)
  })

  it('answers 409 with what is stored when the write was based on another rev', async () => {
    const env = baseEnv()
    await put(env, 0)
    await put(env, 1, 'newer')
    const stale = await put(env, 1, 'mine')
    expect(stale.status).toBe(409)
    const body = await stale.json()
    expect(body).toMatchObject({ rev: 2, blob: 'newer' })
    expect(body.updatedAt).toBeTruthy()
    expect(stored(env).blob).toBe('newer')
    // Writing again on top of the returned rev works.
    expect((await put(env, body.rev, 'merged')).status).toBe(200)
    expect(stored(env)).toMatchObject({ rev: 3, blob: 'merged' })
  })

  it('answers 409 when a second device starts a record that already exists', async () => {
    const env = baseEnv()
    await put(env, 0)
    expect((await put(env, 0, 'other')).status).toBe(409)
  })

  it('removes the record on DELETE, and a second DELETE is still 204', async () => {
    const env = baseEnv()
    await put(env, 0)
    expect((await call('DELETE', env)).status).toBe(204)
    expect(env.SYNC.data.size).toBe(0)
    expect((await call('GET', env)).status).toBe(404)
    expect((await call('DELETE', env)).status).toBe(204)
  })

  it('does not bring back an erased record for a device that still holds an old rev', async () => {
    const env = baseEnv()
    await put(env, 0)
    await call('DELETE', env)
    const res = await put(env, 1)
    expect(res.status).toBe(404)
    expect(env.SYNC.data.size).toBe(0)
    // Starting again, at rev 0, is allowed.
    expect((await put(env, 0)).status).toBe(200)
  })

  it('refuses a body that is not {rev, blob}', async () => {
    const env = baseEnv()
    expect((await call('PUT', env, { body: 'not json' })).status).toBe(400)
    expect((await call('PUT', env, { body: { blob } })).status).toBe(400)
    expect((await call('PUT', env, { body: { rev: 'one', blob } })).status).toBe(400)
    expect((await call('PUT', env, { body: { rev: -1, blob } })).status).toBe(400)
    expect((await call('PUT', env, { body: { rev: 0, blob: 12 } })).status).toBe(400)
    expect(env.SYNC.data.size).toBe(0)
  })
})

describe('Flow Sync: who may use a record', () => {
  it('turns away a different sync key with 403 on every route', async () => {
    const env = baseEnv()
    await put(env, 0)
    for (const res of [await call('GET', env, { bearer: 'other' }), await put(env, 1, 'x', { bearer: 'other' }), await call('DELETE', env, { bearer: 'other' })]) {
      expect(res.status).toBe(403)
      expect(await res.text()).toBe("This sync key doesn't match.")
    }
    expect(stored(env)).toMatchObject({ rev: 1, blob })
  })

  it('asks for the Authorization header when there is none', async () => {
    const env = baseEnv()
    await put(env, 0)
    expect((await call('GET', env, { bearer: null })).status).toBe(401)
    expect((await put(env, 1, 'x', { bearer: null })).status).toBe(401)
    expect((await call('DELETE', env, { bearer: null })).status).toBe(401)
    expect((await put(baseEnv(), 0, blob, { bearer: null })).status).toBe(401)
  })

  it('says 404 for a record that is not there whatever the auth', async () => {
    const env = baseEnv()
    expect((await call('GET', env, { bearer: 'anything' })).status).toBe(404)
    expect((await call('GET', env, { bearer: null })).status).toBe(404)
  })

  it('checks the TOKEN from the header or the address, like the proxy', async () => {
    const env = baseEnv({ TOKEN: 's3cret' })
    expect((await call('GET', env)).status).toBe(401)
    expect((await call('GET', env, { headers: { 'X-Flow-Token': 'nope' } })).status).toBe(401)
    expect((await put(env, 0, blob, { headers: { 'X-Flow-Token': 's3cret' } })).status).toBe(200)
    expect((await call('GET', env, { headers: { 'X-Flow-Token': 's3cret' } })).status).toBe(200)
    expect((await call('GET', env, { path: `/sync/${id}?token=s3cret` })).status).toBe(200)
    expect((await call('GET', env, { path: `/sync/${id}?token=wrong` })).status).toBe(401)
    expect(stored(env).blob).toBe(blob)
  })

  it('does not tell a caller without the token whether the record exists', async () => {
    const env = baseEnv({ TOKEN: 's3cret' })
    expect((await call('GET', env, { bearer: null })).status).toBe(401)
    expect((await call('DELETE', env)).status).toBe(401)
  })
})

describe('Flow Sync: limits and setup', () => {
  it('accepts a blob of 256 KB and refuses one byte more with 413', async () => {
    const env = baseEnv()
    expect((await put(env, 0, 'a'.repeat(maxBlob))).status).toBe(200)
    const over = await put(env, 1, 'a'.repeat(maxBlob + 1))
    expect(over.status).toBe(413)
    expect(stored(env).rev).toBe(1)
    expect((await put(baseEnv(), 0, 'a'.repeat(maxBlob * 2))).status).toBe(413)
  })

  it('answers 501 for every sync route without a KV binding called SYNC', async () => {
    const env = baseEnv({ SYNC: undefined })
    for (const res of [await call('GET', env), await put(env, 0), await call('DELETE', env)]) {
      expect(res.status).toBe(501)
      expect(await res.text()).toBe('Sync needs a KV namespace bound as SYNC. See web/proxy/README.md.')
    }
    // The browser's preflight still works, so the page can read the message.
    expect((await call('OPTIONS', env, { headers: { ...page, 'Access-Control-Request-Method': 'PUT' } })).status).toBe(204)
  })

  it('answers 404 for a name that is not 32 lowercase hex characters', async () => {
    const env = baseEnv()
    for (const path of ['/sync/', '/sync', '/sync/abc', `/sync/${id.toUpperCase()}`, `/sync/${id}0`, `/sync/${id}/more`, '/sync/zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz']) {
      expect((await call('GET', env, { path })).status, path).toBe(404)
    }
  })

  it('refuses other methods', async () => {
    const res = await call('POST', baseEnv(), { body: {} })
    expect(res.status).toBe(405)
    expect(res.headers.get('Allow')).toBe('GET, PUT, DELETE, OPTIONS')
  })
})

describe('Flow Sync: CORS', () => {
  it('answers a preflight for an allowed page with the sync methods and headers', async () => {
    const res = await call('OPTIONS', baseEnv(), { headers: { ...page, 'Access-Control-Request-Method': 'PUT', 'Access-Control-Request-Headers': 'authorization,content-type,x-flow-token' }, bearer: null })
    expect(res.status).toBe(204)
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('https://flow.example.com')
    expect(res.headers.get('Access-Control-Allow-Methods')).toBe('GET, PUT, DELETE, OPTIONS')
    expect(res.headers.get('Access-Control-Allow-Headers')).toBe('Authorization, Content-Type, X-Flow-Token')
    expect(res.headers.get('Vary')).toBe('Origin')
  })

  it('refuses a preflight from a page that is not listed, with no CORS headers', async () => {
    const res = await call('OPTIONS', baseEnv(), { headers: { Origin: 'https://evil.example.com' }, bearer: null })
    expect(res.status).toBe(403)
    expect(res.headers.get('Access-Control-Allow-Origin')).toBeNull()
  })

  it('adds CORS headers to answers (errors too) only for an allowed page', async () => {
    const env = baseEnv()
    const ok = await put(env, 0, blob, { headers: page })
    expect(ok.headers.get('Access-Control-Allow-Origin')).toBe('https://flow.example.com')
    const wrong = await call('GET', env, { headers: page, bearer: 'other' })
    expect(wrong.status).toBe(403)
    expect(wrong.headers.get('Access-Control-Allow-Origin')).toBe('https://flow.example.com')
    const stranger = await call('GET', env, { headers: { Origin: 'https://evil.example.com' } })
    expect(stranger.headers.get('Access-Control-Allow-Origin')).toBeNull()
  })

  it('lets requests without an Origin through, as the proxy does for the apps', async () => {
    const env = baseEnv()
    expect((await put(env, 0)).status).toBe(200)
    const res = await call('GET', env)
    expect(res.status).toBe(200)
    expect(res.headers.get('Access-Control-Allow-Origin')).toBeNull()
  })

  it('keeps answers out of caches', async () => {
    const env = baseEnv()
    await put(env, 0)
    expect((await call('GET', env)).headers.get('Cache-Control')).toBe('no-store')
  })
})

describe('Flow Sync: next to the proxy', () => {
  it('leaves the proxy route alone, and logs no record name', async () => {
    const env = baseEnv()
    await put(env, 0)
    const lines = log.mock.calls.map((c) => c.join(' '))
    expect(lines.join('\n')).not.toContain(id)
    const res = await worker.fetch(new Request('https://proxy.example.com/?url=http%3A%2F%2Fplay.example.com%2Ff.mkv'), env)
    expect(res.status).toBe(400)
  })
})
