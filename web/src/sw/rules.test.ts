import { describe, expect, it } from 'vitest'
import { assetsIn, cacheName, handlingFor, isStorable, precacheList, staleCaches, type RequestInfo } from './rules'

const scope = 'https://flow.example/Flow/'
const get = (url: string, extra: Partial<RequestInfo> = {}): RequestInfo => ({ url, method: 'GET', mode: 'cors', destination: '', ranged: false, ...extra })
const precached = new Set(['icon-192.png', 'manifest.webmanifest', 'offline.html'])
const how = (url: string, extra: Partial<RequestInfo> = {}) => handlingFor(get(url, extra), scope, precached)

describe('what the service worker answers', () => {
  it('opens a page load from the saved shell when the network fails', () => {
    expect(how('https://flow.example/Flow/', { mode: 'navigate', destination: 'document' })).toBe('navigate')
    expect(how('https://flow.example/Flow/title/movie/693134', { mode: 'navigate', destination: 'document' })).toBe('navigate')
    expect(how('https://flow.example/Flow/search?q=dune', { mode: 'navigate' })).toBe('navigate')
  })

  it('keeps Flow’s own code, styles and fonts', () => {
    expect(how('https://flow.example/Flow/assets/index-Kti2dh4E.js', { destination: 'script' })).toBe('static')
    expect(how('https://flow.example/Flow/assets/index-Biyj5n91.css', { destination: 'style' })).toBe('static')
    expect(how('https://flow.example/Flow/fonts/inter-latin-wght-normal.woff2', { destination: 'font' })).toBe('static')
    expect(how('https://flow.example/Flow/assets/flow_remux_bg-abc.wasm')).toBe('static')
  })

  it('keeps the precached unhashed files, and no other unhashed one', () => {
    expect(how('https://flow.example/Flow/icon-192.png', { destination: 'image' })).toBe('static')
    expect(how('https://flow.example/Flow/manifest.webmanifest')).toBe('static')
    expect(how('https://flow.example/Flow/icon-512.png')).toBe('network')
    expect(how('https://flow.example/Flow/opensearch.xml')).toBe('network')
  })

  it('never touches another origin: TMDB, add-ons, servers, the stream proxy, artwork', () => {
    for (const url of [
      'https://api.themoviedb.org/3/movie/693134?language=en-US',
      'https://image.tmdb.org/t/p/w780/abc.jpg',
      'https://v3-cinemeta.strem.io/manifest.json',
      'https://torrentio.strem.fun/stream/movie/tt1160419.json',
      'https://jellyfin.example/Items?api_key=secret',
      'https://proxy.example.workers.dev/?url=https%3A%2F%2Fhost%2Ffile.mkv',
      'https://flow.example/assets/index-Kti2dh4E.js', // the same host, but outside Flow’s own path
      'https://cdn.example/Flow/assets/index-Kti2dh4E.js', // Flow’s path on somebody else’s host
    ]) {
      expect(how(url), url).toBe('network')
    }
    // Not even a page load of someone else's site, or an asset path on it.
    expect(how('https://other.example/Flow/', { mode: 'navigate' })).toBe('network')
  })

  it('never touches a stream: media files, ranges, media elements, the sample file', () => {
    expect(how('https://flow.example/Flow/samples/flow-sample.mkv')).toBe('network')
    expect(how('https://flow.example/Flow/assets/clip.mp4')).toBe('network')
    expect(how('https://flow.example/Flow/assets/live/index.m3u8')).toBe('network')
    expect(how('https://flow.example/Flow/assets/seg-1.m4s')).toBe('network')
    expect(how('https://flow.example/Flow/assets/index-Kti2dh4E.js', { ranged: true })).toBe('network')
    expect(how('https://flow.example/Flow/watch/movie/1', { destination: 'video' })).toBe('network')
    expect(how('https://flow.example/Flow/subs.vtt', { destination: 'track' })).toBe('network')
  })

  it('never touches anything but a GET', () => {
    expect(how('https://flow.example/Flow/assets/index-Kti2dh4E.js', { method: 'POST' })).toBe('network')
    expect(how('https://flow.example/Flow/', { method: 'POST', mode: 'navigate' })).toBe('network')
    expect(how('https://flow.example/Flow/assets/index-Kti2dh4E.js', { method: 'HEAD' })).toBe('network')
  })

  it('leaves the worker itself and source maps to the network', () => {
    expect(how('https://flow.example/Flow/sw.js')).toBe('network')
    expect(how('https://flow.example/Flow/assets/index-Kti2dh4E.js.map')).toBe('network')
  })

  it('works at the root of a host as well as under a path', () => {
    const rootScope = 'https://flow.example/'
    expect(handlingFor(get('https://flow.example/assets/a-1.js'), rootScope)).toBe('static')
    expect(handlingFor(get('https://flow.example/library?list=continue', { mode: 'navigate' }), rootScope)).toBe('navigate')
    expect(handlingFor(get('https://api.themoviedb.org/3/trending'), rootScope)).toBe('network')
  })

  it('doesn’t throw on an address it can’t read', () => {
    expect(handlingFor(get('not a url'), scope)).toBe('network')
    expect(handlingFor(get('https://flow.example/Flow/a.js'), 'nonsense')).toBe('network')
  })
})

describe('what gets stored', () => {
  it('stores only whole, successful answers from Flow’s own origin', () => {
    expect(isStorable({ status: 200, type: 'basic' })).toBe(true)
    expect(isStorable({ status: 206, type: 'basic' })).toBe(false)
    expect(isStorable({ status: 404, type: 'basic' })).toBe(false)
    expect(isStorable({ status: 500, type: 'basic' })).toBe(false)
    expect(isStorable({ status: 0, type: 'opaque' })).toBe(false)
    expect(isStorable({ status: 200, type: 'cors' })).toBe(false)
  })

  it('clears only Flow’s caches from other versions', () => {
    const names = ['flow-aaa', 'flow-bbb', 'flow-ccc', 'workbox-precache', 'other-flow-x']
    expect(staleCaches(names, 'bbb')).toEqual(['flow-aaa', 'flow-ccc'])
    expect(staleCaches(['flow-bbb'], 'bbb')).toEqual([])
    expect(cacheName('bbb')).toBe('flow-bbb')
  })
})

describe('what is saved on install', () => {
  const files = [
    { path: 'assets/index-a.js', bytes: 328_000 },
    { path: 'assets/index-a.css', bytes: 13_000 },
    { path: 'assets/library-b.js', bytes: 16_000 },
    { path: 'assets/hls-c.js', bytes: 575_000 },
    { path: 'assets/index-a.js.map', bytes: 1_500_000 },
    { path: 'assets/flow_remux_bg-d.wasm', bytes: 130_000 },
  ]

  it('keeps the hashed code and styles, and leaves out the video engine, maps and wasm', () => {
    const list = precacheList(files, ['', 'offline.html'], 400_000)
    expect(list).toEqual(['', 'assets/index-a.css', 'assets/index-a.js', 'assets/library-b.js', 'offline.html'])
  })

  it('always keeps what the page itself names, however big', () => {
    const list = precacheList(files, assetsIn('<script type="module" src="/Flow/assets/index-a.js"></script><link rel="stylesheet" href="/Flow/assets/index-a.css">'), 100_000)
    expect(list).toContain('assets/index-a.js')
    expect(list).toContain('assets/index-a.css')
    expect(list).not.toContain('assets/hls-c.js')
  })

  it('reads a page’s own assets out of its tags', () => {
    const html = '<script type="module" crossorigin src="/assets/index-a.js"></script><link rel="modulepreload" href="/assets/createStore-x.js"><link rel="icon" href="/icon-192.png">'
    expect(assetsIn(html)).toEqual(['assets/index-a.js', 'assets/createStore-x.js'])
  })

  it('lists a file once', () => {
    expect(precacheList(files, ['assets/library-b.js'], 400_000).filter((p) => p === 'assets/library-b.js')).toHaveLength(1)
  })
})
