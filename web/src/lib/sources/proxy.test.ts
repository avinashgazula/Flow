import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { settingsStore } from '../store/settings'
import { blockedOriginsCap, forgetBlocked, isDebridHost, isKnownBlocked, isReadable, needsProxy, proxied, proxyProblem, rememberBlocked } from './proxy'

const file = 'https://cdn.example.net/a b/Movie (2024).mkv?sig=1&x=2'
const encoded = encodeURIComponent(file)

/** localStorage for a node test: a plain map, which can be made to throw. */
function stubStorage() {
  const data = new Map<string, string>()
  const storage = {
    fail: false,
    getItem: (k: string) => {
      if (storage.fail) throw new Error('blocked')
      return data.get(k) ?? null
    },
    setItem: (k: string, v: string) => {
      if (storage.fail) throw new Error('blocked')
      data.set(k, v)
    },
    removeItem: (k: string) => void data.delete(k),
  }
  vi.stubGlobal('localStorage', storage)
  return { data, storage }
}

beforeEach(() => {
  settingsStore.set({ streamProxy: '' })
  forgetBlocked()
})
afterEach(() => vi.unstubAllGlobals())

describe('proxied', () => {
  it('puts the encoded address where {url} is', () => {
    expect(proxied(file, 'https://proxy.example.com/?url={url}')).toBe(`https://proxy.example.com/?url=${encoded}`)
    expect(proxied(file, 'https://mediaflow.example.com/proxy/stream?d={url}&api_password=pw')).toBe(`https://mediaflow.example.com/proxy/stream?d=${encoded}&api_password=pw`)
    expect(proxied(file, 'https://proxy.example.com/{url}/play')).toBe(`https://proxy.example.com/${encoded}/play`)
  })

  it('appends url=<encoded> when the template has no {url}', () => {
    expect(proxied(file, 'https://proxy.example.com/')).toBe(`https://proxy.example.com/?url=${encoded}`)
    expect(proxied(file, 'https://proxy.example.com/stream?token=t')).toBe(`https://proxy.example.com/stream?token=t&url=${encoded}`)
    expect(proxied(file, 'https://proxy.example.com/?')).toBe(`https://proxy.example.com/?url=${encoded}`)
    expect(proxied(file, 'https://proxy.example.com/?token=t&')).toBe(`https://proxy.example.com/?token=t&url=${encoded}`)
  })

  it('reads the saved setting, and leaves the address alone without one', () => {
    expect(proxied(file)).toBe(file)
    settingsStore.set({ streamProxy: '  https://proxy.example.com/?url={url}  ' })
    expect(proxied(file)).toBe(`https://proxy.example.com/?url=${encoded}`)
  })

  it('round-trips through the address a proxy would read', () => {
    const out = new URL(proxied(file, 'https://proxy.example.com/?url={url}'))
    expect(out.searchParams.get('url')).toBe(file)
  })
})

describe('proxyProblem', () => {
  it('accepts nothing, and addresses with or without {url}', () => {
    expect(proxyProblem('')).toBeUndefined()
    expect(proxyProblem('   ')).toBeUndefined()
    expect(proxyProblem('https://proxy.example.com/?url={url}')).toBeUndefined()
    expect(proxyProblem('https://proxy.example.com')).toBeUndefined()
    expect(proxyProblem('http://localhost:8787/', 'https:')).toBeUndefined()
  })

  it('says what to fix', () => {
    expect(proxyProblem('proxy.example.com/?url={url}')).toMatch(/https:\/\//)
    expect(proxyProblem('ftp://proxy.example.com/?url={url}')).toMatch(/https:\/\//)
    expect(proxyProblem('http://proxy.example.com/?url={url}', 'https:')).toMatch(/HTTPS/)
    expect(proxyProblem('http://proxy.example.com/?url={url}', 'http:')).toBeUndefined()
  })
})

describe('learned blocked origins', () => {
  it('keys on the origin of the address Flow was given', () => {
    rememberBlocked('https://aio.example.com/playback/abc/file.mkv?x=1')
    expect(isKnownBlocked('https://aio.example.com/other/path.mkv')).toBe(true)
    expect(isKnownBlocked('https://aio.example.com:8443/other')).toBe(false)
    expect(isKnownBlocked('http://aio.example.com/other')).toBe(false)
    expect(isKnownBlocked('https://other.example.com/x')).toBe(false)
    expect(isKnownBlocked('not a url')).toBe(false)
  })

  it('ignores addresses that aren’t web addresses', () => {
    rememberBlocked('blob:https://example.com/1')
    rememberBlocked('garbage')
    expect(isKnownBlocked('blob:https://example.com/1')).toBe(false)
  })

  it('keeps the newest origins when the list is full', () => {
    for (let i = 0; i < blockedOriginsCap + 5; i++) rememberBlocked(`https://host${i}.example.com/f`)
    expect(isKnownBlocked('https://host0.example.com/f')).toBe(false)
    expect(isKnownBlocked('https://host4.example.com/f')).toBe(false)
    expect(isKnownBlocked('https://host5.example.com/f')).toBe(true)
    expect(isKnownBlocked(`https://host${blockedOriginsCap + 4}.example.com/f`)).toBe(true)
  })

  it('counts an origin seen again as new', () => {
    rememberBlocked('https://first.example.com/f')
    for (let i = 0; i < blockedOriginsCap - 1; i++) rememberBlocked(`https://host${i}.example.com/f`)
    rememberBlocked('https://first.example.com/f')
    rememberBlocked('https://last.example.com/f')
    expect(isKnownBlocked('https://first.example.com/f')).toBe(true)
    expect(isKnownBlocked('https://host0.example.com/f')).toBe(false)
  })

  it('persists to localStorage under flow.blockedOrigins', () => {
    const { data } = stubStorage()
    rememberBlocked('https://aio.example.com/f')
    expect(JSON.parse(data.get('flow.blockedOrigins')!)).toEqual(['https://aio.example.com'])
  })

  it('reads what an earlier visit saved', async () => {
    const { data } = stubStorage()
    data.set('flow.blockedOrigins', JSON.stringify(['https://aio.example.com', 7]))
    vi.resetModules()
    const fresh = await import('./proxy')
    expect(fresh.isKnownBlocked('https://aio.example.com/f')).toBe(true)
    expect(fresh.isKnownBlocked('https://else.example.com/f')).toBe(false)
  })

  it('works for the session when storage throws or holds junk', async () => {
    const { storage } = stubStorage()
    storage.fail = true
    expect(() => rememberBlocked('https://aio.example.com/f')).not.toThrow()
    expect(isKnownBlocked('https://aio.example.com/f')).toBe(true)

    const { data } = stubStorage()
    data.set('flow.blockedOrigins', '{not json')
    vi.resetModules()
    const fresh = await import('./proxy')
    expect(fresh.isKnownBlocked('https://aio.example.com/f')).toBe(false)
  })
})

describe('which hosts need the proxy', () => {
  const template = 'https://proxy.example.com/?url={url}'

  it('knows the debrid download hosts and their subdomains', () => {
    for (const host of ['real-debrid.com', '42-4.download.real-debrid.com', 'a.alldebrid.com', 'cdn.premiumize.me', 'store.torbox.app', 'dl.debrid-link.com', 'x.offcloud.com']) {
      expect(isDebridHost(`https://${host}/d/file.mkv`), host).toBe(true)
    }
    expect(isDebridHost('https://notreal-debrid.com/f')).toBe(false)
    expect(isDebridHost('https://real-debrid.com.example.net/f')).toBe(false)
    expect(isDebridHost('https://aio.example.com/f')).toBe(false)
    expect(isDebridHost('garbage')).toBe(false)
  })

  it('needs a proxy to be set before anything needs one', () => {
    expect(needsProxy('https://a.download.real-debrid.com/f')).toBe(false)
    expect(needsProxy('https://a.download.real-debrid.com/f', template)).toBe(true)
    settingsStore.set({ streamProxy: template })
    expect(needsProxy('https://a.download.real-debrid.com/f')).toBe(true)
  })

  it('needs one for a learned origin, but not for an unknown host', () => {
    expect(needsProxy('https://aio.example.com/f', template)).toBe(false)
    rememberBlocked('https://aio.example.com/play/1')
    expect(needsProxy('https://aio.example.com/f', template)).toBe(true)
    expect(needsProxy('https://aio.example.com/f', '')).toBe(false)
  })

  it('calls a file readable unless its host is known to block pages and nothing can get round that', () => {
    expect(isReadable('https://plain.example.com/f')).toBe(true)
    expect(isReadable('https://a.download.real-debrid.com/f')).toBe(false)
    expect(isReadable('https://a.download.real-debrid.com/f', template)).toBe(true)
    rememberBlocked('https://aio.example.com/play/1')
    expect(isReadable('https://aio.example.com/play/2')).toBe(false)
    expect(isReadable('https://aio.example.com/play/2', template)).toBe(true)
  })
})
