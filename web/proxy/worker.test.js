import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
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

let log
beforeEach(() => {
  log = vi.spyOn(console, 'log').mockImplementation(() => {})
})
afterEach(() => {
  vi.unstubAllGlobals()
  log.mockRestore()
})

const hopsOf = (res) => res.headers.get('X-Flow-Proxy-Hops')

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

  it('passes on a status like 404 without the host’s page, and says which host answered', async () => {
    network(new Response('<html>nope</html>', { status: 404, headers: { 'Content-Type': 'text/html' } }))
    const gone = await ask('https://play.example.com/f.mkv', { headers: page })
    expect(gone.status).toBe(404)
    const body = await gone.text()
    expect(body).toBe('The file’s host (play.example.com) answered 404.\n')
    expect(gone.headers.get('Access-Control-Allow-Origin')).toBe('https://flow.example.com')
    expect(hopsOf(gone)).toBe('play.example.com 404')
  })

  it('quotes a short text or JSON reason from the host, cleaned', async () => {
    network(new Response('  IP address\n not allowed  ', { status: 403, headers: { 'Content-Type': 'text/plain' } }))
    const banned = await ask('https://play.example.com/f.mkv', { headers: page })
    expect(banned.status).toBe(403)
    expect(await banned.text()).toBe('The file’s host (play.example.com) answered 403. It said: “IP address not allowed”\n')

    network(new Response('{"error":"ip_banned","link":"https://play.example.com/d/x?token=secret"}', { status: 403, headers: { 'Content-Type': 'application/json' } }))
    const json = await (await ask('https://play.example.com/f.mkv')).text()
    expect(json).toContain('ip_banned')
    expect(json).not.toContain('token=secret')
    expect(json).not.toContain('/d/x')

    network(new Response('x'.repeat(5000), { status: 503, headers: { 'Content-Type': 'text/plain' } }))
    const long = await (await ask('https://play.example.com/f.mkv')).text()
    expect(long.length).toBeLessThan(260)
    expect(long).toContain('…')
  })

  it('names the host that can’t be reached, and the one that wasn’t listed', async () => {
    network(() => {
      throw new TypeError('fetch failed')
    })
    const down = await ask('https://play.example.com/f.mkv')
    expect(down.status).toBe(502)
    expect(await down.text()).toBe('Couldn’t reach play.example.com.\n')
    expect(hopsOf(down)).toBe('play.example.com unreachable')

    network()
    const unlisted = await ask('https://elsewhere.example.org/f.mkv')
    expect(await unlisted.text()).toBe('elsewhere.example.org isn’t in ALLOWED_HOSTS.\n')
    expect(hopsOf(unlisted)).toBe('elsewhere.example.org not allowed')

    const wrong = await ask('https://play.example.com/f.mkv', { extra: { ...env, TOKEN: 'abc' } })
    expect(await wrong.text()).toBe('The token is missing or wrong.\n')
    expect(hopsOf(wrong)).toBeNull()
  })

  it('lists every host asked, on a refused redirect and on a failure after one', async () => {
    network(redirect('https://elsewhere.example.org/blob?token=secret'))
    const refused = await ask('https://play.example.com/resolve/1?key=secret')
    expect(await refused.text()).toBe('The file redirects to elsewhere.example.org, which isn’t in ALLOWED_HOSTS or ALLOWED_REDIRECT_HOSTS.\n')
    expect(hopsOf(refused)).toBe('play.example.com 302, elsewhere.example.org not allowed')

    network(redirect('https://store-1.files.example.net/blob'), new Response('Not permitted from this address', { status: 403, headers: { 'Content-Type': 'text/plain' } }))
    const res = await ask('https://play.example.com/resolve/1', { headers: page })
    expect(res.status).toBe(403)
    expect(await res.text()).toBe('The file’s host (store-1.files.example.net) answered 403. It said: “Not permitted from this address”\n')
    expect(hopsOf(res)).toBe('play.example.com 302, store-1.files.example.net 403')
  })

  it('adds the hops to a successful answer, and lets the page read them', async () => {
    network(redirect('https://store-1.files.example.net/blob'), file())
    const res = await ask('https://play.example.com/resolve/1', { headers: { ...page, Range: 'bytes=0-4' } })
    expect(res.status).toBe(206)
    expect(hopsOf(res)).toBe('play.example.com 302, store-1.files.example.net 206')
    expect(res.headers.get('Access-Control-Expose-Headers')).toContain('X-Flow-Proxy-Hops')
  })

  it('logs one line a request with hosts and statuses, and no path, query or token', async () => {
    network(redirect('https://store-1.files.example.net/blob?sig=secret'), file())
    await ask('https://play.example.com/resolve/1?key=secret', { headers: { Range: 'bytes=0-4' }, token: 'tok' })
    expect(log).toHaveBeenCalledTimes(1)
    const line = log.mock.calls[0][0]
    expect(line).toBe('GET bytes=0-4 -> 206 | play.example.com 302, store-1.files.example.net 206')
    for (const secret of ['secret', 'tok', 'resolve', 'blob']) expect(line).not.toContain(secret)

    await ask(undefined)
    expect(log.mock.calls[1][0]).toBe('GET no range -> 400 | no hops')
  })
})
