import { afterEach, describe, expect, it, vi } from 'vitest'
import worker from './worker.js'

const env = { ALLOWED_ORIGINS: 'https://flow.example.com', ALLOWED_HOSTS: 'play.example.com, *.files.example.net' }
const page = { Origin: 'https://flow.example.com' }

/** A request to the Worker for a file address. */
const ask = (target, { headers = {}, method = 'GET', token, extra = env } = {}) => {
  const url = new URL('https://proxy.example.com/')
  if (target !== undefined) url.searchParams.set('url', target)
  if (token !== undefined) url.searchParams.set('token', token)
  return worker.fetch(new Request(url, { method, headers }), extra)
}

/** Stands in for the network: each call takes the next answer, and the calls are kept for checking. */
function network(...answers) {
  const calls = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url, init) => {
      calls.push({ url: String(url), headers: init.headers, method: init.method, redirect: init.redirect })
      const next = answers.shift()
      return typeof next === 'function' ? next() : next
    }),
  )
  return calls
}

const file = (status = 206, headers = {}) =>
  new Response('bytes', { status, headers: { 'Content-Range': 'bytes 0-4/100', 'Content-Length': '5', 'Accept-Ranges': 'bytes', 'Content-Type': 'video/x-matroska', 'Set-Cookie': 'a=b', ...headers } })
const redirect = (to, status = 302) => new Response(null, { status, headers: { Location: to } })

afterEach(() => vi.unstubAllGlobals())

describe('the Worker', () => {
  it('answers a preflight for a listed page, and refuses any other', async () => {
    const ok = await worker.fetch(new Request('https://proxy.example.com/?url=x', { method: 'OPTIONS', headers: { ...page, 'Access-Control-Request-Headers': 'range' } }), env)
    expect(ok.status).toBe(204)
    expect(ok.headers.get('Access-Control-Allow-Origin')).toBe('https://flow.example.com')
    expect(ok.headers.get('Access-Control-Allow-Headers')).toBe('Range')
    const refused = await worker.fetch(new Request('https://proxy.example.com/?url=x', { method: 'OPTIONS', headers: { Origin: 'https://evil.example.org' } }), env)
    expect(refused.status).toBe(403)
    expect(refused.headers.get('Access-Control-Allow-Origin')).toBeNull()
  })

  it('streams a range of the file, with only the headers a player needs', async () => {
    const calls = network(file())
    const res = await ask('https://play.example.com/f.mkv', { headers: { ...page, Range: 'bytes=0-4', Cookie: 'sid=1', Authorization: 'Bearer x' } })
    expect(res.status).toBe(206)
    expect(await res.text()).toBe('bytes')
    expect(res.headers.get('Content-Range')).toBe('bytes 0-4/100')
    expect(res.headers.get('Accept-Ranges')).toBe('bytes')
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('https://flow.example.com')
    expect(res.headers.get('Access-Control-Expose-Headers')).toContain('Content-Range')
    expect(res.headers.get('Vary')).toBe('Origin')
    expect(res.headers.get('Set-Cookie')).toBeNull()
    const sent = new Headers(calls[0].headers)
    expect(sent.get('Range')).toBe('bytes=0-4')
    expect(sent.get('Cookie')).toBeNull()
    expect(sent.get('Authorization')).toBeNull()
    expect(sent.get('Origin')).toBeNull()
    expect(calls[0].redirect).toBe('manual')
  })

  it('keeps a 200 and a 416 as they are, and answers HEAD without a body', async () => {
    network(file(200), file(416, { 'Content-Range': 'bytes */100' }), file(200))
    expect((await ask('https://play.example.com/f.mkv')).status).toBe(200)
    const past = await ask('https://play.example.com/f.mkv', { headers: { Range: 'bytes=500-' } })
    expect(past.status).toBe(416)
    expect(past.headers.get('Content-Range')).toBe('bytes */100')
    const head = await ask('https://play.example.com/f.mkv', { method: 'HEAD' })
    expect(head.status).toBe(200)
    expect(await head.text()).toBe('')
  })

  it('adds no CORS headers for a page that isn’t listed', async () => {
    network(file())
    const res = await ask('https://play.example.com/f.mkv', { headers: { Origin: 'https://evil.example.org' } })
    expect(res.headers.get('Access-Control-Allow-Origin')).toBeNull()
    expect(res.headers.get('Vary')).toBe('Origin')
  })

  it('refuses hosts that aren’t listed, and addresses that aren’t plain https', async () => {
    const calls = network()
    expect((await ask('https://elsewhere.example.org/f.mkv')).status).toBe(403)
    expect((await ask('http://play.example.com/f.mkv')).status).toBe(400)
    expect((await ask(undefined)).status).toBe(400)
    expect((await ask('https://play.example.com/f.mkv', { extra: { ...env, ALLOWED_HOSTS: '' } })).status).toBe(403)
    expect((await ask('https://play.example.com/f.mkv', { method: 'POST' })).status).toBe(405)
    expect(calls).toHaveLength(0)
  })

  it('asks for the token when one is set', async () => {
    const secret = { ...env, TOKEN: 'abc123' }
    network(file())
    expect((await ask('https://play.example.com/f.mkv', { extra: secret })).status).toBe(401)
    expect((await ask('https://play.example.com/f.mkv', { extra: secret, token: 'nope' })).status).toBe(401)
    expect((await ask('https://play.example.com/f.mkv', { extra: secret, token: 'abc123' })).status).toBe(206)
  })

  it('follows a redirect to another allowed host, checking each hop', async () => {
    const calls = network(redirect('https://store-1.files.example.net/blob?x=1'), file())
    const res = await ask('https://play.example.com/resolve/1', { headers: { Range: 'bytes=0-4' } })
    expect(res.status).toBe(206)
    expect(calls.map((c) => c.url)).toEqual(['https://play.example.com/resolve/1', 'https://store-1.files.example.net/blob?x=1'])
    // The Range goes on to every hop.
    expect(new Headers(calls[1].headers).get('Range')).toBe('bytes=0-4')
  })

  it('refuses a redirect to a host nobody listed, unless ALLOWED_REDIRECT_HOSTS covers it', async () => {
    const calls = network(redirect('https://elsewhere.example.org/blob'))
    const refused = await ask('https://play.example.com/resolve/1')
    expect(refused.status).toBe(403)
    expect(await refused.text()).toContain('elsewhere.example.org')
    expect(calls).toHaveLength(1)

    network(redirect('https://elsewhere.example.org/blob'), file())
    const allowed = await ask('https://play.example.com/resolve/1', { extra: { ...env, ALLOWED_REDIRECT_HOSTS: 'elsewhere.example.org' } })
    expect(allowed.status).toBe(206)
  })

  it('does not follow a redirect to plain http, or one that never ends', async () => {
    network(redirect('http://play.example.com/blob'))
    expect((await ask('https://play.example.com/resolve/1')).status).toBe(502)
    network(...Array.from({ length: 10 }, () => redirect('https://play.example.com/again')))
    expect((await ask('https://play.example.com/resolve/1')).status).toBe(502)
  })

  it('passes on a status like 404 without the host’s page, and reports a host that can’t be reached', async () => {
    network(new Response('<html>nope</html>', { status: 404 }))
    const gone = await ask('https://play.example.com/f.mkv', { headers: page })
    expect(gone.status).toBe(404)
    expect(await gone.text()).not.toContain('html')
    expect(gone.headers.get('Access-Control-Allow-Origin')).toBe('https://flow.example.com')
    network(() => {
      throw new TypeError('fetch failed')
    })
    expect((await ask('https://play.example.com/f.mkv')).status).toBe(502)
  })
})
