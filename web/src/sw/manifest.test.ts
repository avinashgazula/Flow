import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { isLibraryPage, libraryLists } from '../features/library/logic'
import { openSearchDescriptor, siteAddress } from './openSearch'

const web = new URL('../../', import.meta.url)
const read = (path: string) => readFileSync(new URL(path, web), 'utf8')
const manifest = JSON.parse(read('public/manifest.webmanifest')) as {
  name: string
  short_name: string
  description: string
  start_url: string
  scope: string
  display: string
  background_color: string
  theme_color: string
  icons: { src: string; sizes: string; type: string; purpose?: string }[]
  shortcuts: { name: string; short_name?: string; url: string; icons?: { src: string }[] }[]
}

/** Width and height from a PNG's header, so an icon's declared size is checked against the file. */
function pngSize(path: string) {
  const bytes = readFileSync(new URL(`public/${path}`, web))
  expect(bytes.subarray(1, 4).toString()).toBe('PNG')
  return `${bytes.readUInt32BE(16)}x${bytes.readUInt32BE(20)}`
}

describe('the web app manifest', () => {
  it('names the app and opens it in its own window', () => {
    expect(manifest.name).toBe('Flow')
    expect(manifest.short_name).toBe('Flow')
    expect(manifest.short_name.length).toBeLessThanOrEqual(12)
    expect(manifest.display).toBe('standalone')
    expect(manifest.description.length).toBeGreaterThan(0)
  })

  it('takes its colours from the design’s film base, so the window frame and splash screen match the page', () => {
    const base = /--base:\s*(#[0-9a-f]{6})/i.exec(read('src/styles/tokens.css'))?.[1]
    expect(base).toBe('#15120f')
    expect(manifest.theme_color).toBe(base)
    expect(manifest.background_color).toBe(base)
    // index.html's theme-color is what the browser uses before the manifest loads.
    expect(read('index.html')).toContain(`<meta name="theme-color" content="${base}"`)
  })

  it('starts and stays inside the site’s own base path', () => {
    expect(manifest.start_url).toBe('.')
    expect(manifest.scope).toBe('.')
    expect(read('index.html')).toContain('<link rel="manifest" href="%BASE_URL%manifest.webmanifest"')
  })

  it('has real icons at the sizes it declares, with maskable ones of their own', () => {
    for (const icon of manifest.icons) {
      expect(existsSync(new URL(`public/${icon.src}`, web)), icon.src).toBe(true)
      expect(pngSize(icon.src), icon.src).toBe(icon.sizes)
      expect(icon.type).toBe('image/png')
      // "any maskable" in one file is discouraged: the art is cropped to a circle on some launchers.
      expect(icon.purpose).not.toBe('any maskable')
    }
    const has = (purpose: string, sizes: string) => manifest.icons.some((i) => (i.purpose ?? 'any') === purpose && i.sizes === sizes)
    for (const sizes of ['192x192', '512x512']) {
      expect(has('any', sizes), `any ${sizes}`).toBe(true)
      expect(has('maskable', sizes), `maskable ${sizes}`).toBe(true)
    }
  })

  it('offers Continue Watching, Upcoming and Search, each to a place that exists', () => {
    expect(manifest.shortcuts.map((s) => s.name)).toEqual(['Continue Watching', 'Upcoming', 'Search'])
    const origin = 'https://flow.example'
    const scope = `${origin}/Flow/`
    for (const shortcut of manifest.shortcuts) {
      // Relative to the manifest, as a browser reads them: inside the scope, on the same origin.
      const url = new URL(shortcut.url, `${scope}manifest.webmanifest`)
      expect(url.href.startsWith(scope), shortcut.url).toBe(true)
      const route = url.pathname.slice('/Flow/'.length)
      expect(existsSync(new URL(`src/routes/${route}.tsx`, web)), `${route} is a route`).toBe(true)
      for (const icon of shortcut.icons ?? []) expect(existsSync(new URL(`public/${icon.src}`, web)), icon.src).toBe(true)
    }
    const continueWatching = new URL(manifest.shortcuts[0]!.url, 'https://flow.example/Flow/manifest.webmanifest')
    expect(continueWatching.searchParams.get('list')).toBe('continue')
    expect(libraryLists as readonly string[]).toContain('continue')
    // Upcoming is a page of Library, reached by ?list=, so the shortcut has to name one that exists and opens it.
    const upcoming = new URL(manifest.shortcuts[1]!.url, 'https://flow.example/Flow/manifest.webmanifest')
    expect(upcoming.pathname).toBe('/Flow/library')
    expect(upcoming.searchParams.get('list')).toBe('upcoming')
    expect(libraryLists as readonly string[]).toContain('upcoming')
    expect(isLibraryPage('upcoming')).toBe(true)
  })
})

describe('the OpenSearch descriptor', () => {
  it('sends the address bar’s words to the search page, with absolute addresses', () => {
    const xml = openSearchDescriptor('https://flow.example/Flow/')
    expect(xml).toContain('<ShortName>Flow</ShortName>')
    expect(xml).toContain('<Url type="text/html" method="get" template="https://flow.example/Flow/search?q={searchTerms}"/>')
    expect(xml).toContain('https://flow.example/Flow/icon-192.png')
    expect(xml).toContain('xmlns="http://a9.com/-/spec/opensearch/1.1/"')
    // The route reads `q`, so the address the browser builds opens a search.
    expect(existsSync(new URL('src/routes/search.tsx', web))).toBe(true)
    expect(read('src/routes/search.tsx')).toContain('q?: string')
  })

  it('still reads as a descriptor on a local build, with no site to point at', () => {
    expect(openSearchDescriptor(undefined)).toContain('template="search?q={searchTerms}"')
  })

  it('escapes what could break the XML', () => {
    expect(openSearchDescriptor('https://flow.example/a&b/')).toContain('a&amp;b')
  })

  it('finds where the site is served from, as CI builds it', () => {
    expect(siteAddress('/', { PAGES_DOMAIN: 'media.example.dev' })).toBe('https://media.example.dev/')
    expect(siteAddress('/Flow/', { GITHUB_REPOSITORY: 'Someone/Flow' })).toBe('https://someone.github.io/Flow/')
    expect(siteAddress('/Flow/', { FLOW_SITE_URL: 'https://flow.example' })).toBe('https://flow.example/Flow/')
    expect(siteAddress('/', {})).toBeUndefined()
  })
})
