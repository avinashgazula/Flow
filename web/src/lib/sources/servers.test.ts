import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ServerConfig } from '../store/settings'
import jellyfinRecent from './__fixtures__/jellyfin-recent.json'
import jellyfinViews from './__fixtures__/jellyfin-views.json'
import plexHubs from './__fixtures__/plex-hubs-search.json'
import plexRecent from './__fixtures__/plex-recently-added.json'
import plexSections from './__fixtures__/plex-sections.json'
import * as jellyfin from './jellyfin'
import * as plex from './plex'
import { catalogueOf, librariesOf, merged, recentOf, recentTitles, reportTo } from './serverCatalogue'
import type { ServerTitle } from './types'

const jf: ServerConfig = { id: 'jellyfin:srv:u1', kind: 'jellyfin', name: 'Living Room', url: 'https://jf.example.com', token: 'tok', userId: 'u1', enabled: true }
const emby: ServerConfig = { ...jf, id: 'emby:srv:u1', kind: 'emby', name: 'Emby' }
const px: ServerConfig = { id: 'plex:m1', kind: 'plex', name: 'Den', url: 'https://1-2-3-4.abc.plex.direct:32400', token: 'plextok', enabled: true }

/** Answers fetches from path → body (JSON, unless it is a string), recording what was asked. */
function serve(routes: Record<string, unknown>) {
  const calls: { url: URL; init?: RequestInit }[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string | URL, init?: RequestInit) => {
      const url = new URL(String(input))
      calls.push({ url, init })
      const key = Object.keys(routes).find((k) => url.pathname === k || url.pathname.endsWith(k))
      if (!key) return new Response('{}', { status: 404 })
      const body = routes[key]
      return typeof body === 'function' ? (body as (u: URL) => Response)(url) : new Response(typeof body === 'string' ? body : JSON.stringify(body), { status: 200 })
    }),
  )
  return calls
}
afterEach(() => vi.unstubAllGlobals())

describe('Jellyfin and Emby: browsing', () => {
  it('lists movie and TV libraries with the server’s own covers, and leaves out music and sets', async () => {
    const calls = serve({ '/Users/u1/Views': jellyfinViews })
    const libraries = await jellyfin.libraries(jf)
    expect(libraries).toEqual([
      { id: 'view-movies', name: 'Movies', type: 'movie', image: 'https://jf.example.com/Items/view-movies/Images/Primary?maxWidth=640&tag=tagM&quality=90' },
      // No cover of its own: the backdrop stands in.
      { id: 'view-shows', name: 'Shows', type: 'show', image: 'https://jf.example.com/Items/view-shows/Images/Backdrop?maxWidth=640&tag=tagB&quality=90' },
      // Mixed and home-video libraries have no single kind of title.
      { id: 'view-home', name: 'Home Videos' },
      { id: 'view-plain', name: 'Library' },
    ])
    expect(new Headers(calls[0]!.init?.headers).get('X-Emby-Token')).toBe('tok')
    // The server's pictures need no sign-in, so no address carries the token.
    expect(JSON.stringify(libraries)).not.toContain('tok')
  })

  it('maps recently added to titles: ids, artwork, dates, a clean name for files, and no episodes or executables', async () => {
    const calls = serve({ '/Users/u1/Items': jellyfinRecent })
    const titles = await jellyfin.recentlyAdded(jf, 30)
    expect(titles.map((t) => t.title)).toEqual(['Dune: Part Two', 'Severance', 'Resident Evil'])
    expect(titles[0]).toEqual({
      serverId: jf.id,
      itemId: 'dune2',
      type: 'movie',
      title: 'Dune: Part Two',
      year: 2024,
      tmdb: 693134,
      imdb: 'tt15239678',
      poster: 'https://jf.example.com/Items/dune2/Images/Primary?maxWidth=500&tag=p-dune2&quality=90',
      backdrop: 'https://jf.example.com/Items/dune2/Images/Backdrop?maxWidth=1280&tag=b-dune2&quality=90',
      overview: 'Paul Atreides unites with the Fremen.',
      addedAt: Date.parse('2026-10-20T10:00:00Z'),
    })
    expect(titles[1]).toMatchObject({ type: 'show', tmdb: 95396, tvdb: 371980 })
    // A film the server named after its file: cleaned, with the year from the name, and nothing to open it by.
    expect(titles[2]).toMatchObject({ itemId: 'file1', year: 2026, tmdb: undefined })
    const asked = calls[0]!.url.searchParams
    expect(asked.get('SortBy')).toBe('DateCreated')
    expect(asked.get('SortOrder')).toBe('Descending')
    expect(asked.get('Limit')).toBe('30')
    expect(asked.get('IncludeItemTypes')).toBe('Movie,Series')
  })

  it('asks for one library’s titles, and for a search, by the same listing', async () => {
    const calls = serve({ '/Users/u1/Items': jellyfinRecent })
    await jellyfin.itemsIn(jf, 'view-movies', 60)
    expect(calls[0]!.url.searchParams.get('ParentId')).toBe('view-movies')
    expect(calls[0]!.url.searchParams.get('Limit')).toBe('60')
    await jellyfin.search(jf, 'dune')
    expect(calls[1]!.url.searchParams.get('SearchTerm')).toBe('dune')
  })

  it('reads the whole catalogue a page at a time, without images', async () => {
    const page = (n: number, start: number) => ({ Items: Array.from({ length: n }, (_, i) => ({ Id: `m${start + i}`, Name: `Film ${start + i}`, Type: 'Movie', ProviderIds: { Tmdb: String(1000 + start + i) } })), TotalRecordCount: 2500 })
    const calls = serve({
      '/Users/u1/Items': (url: URL) => {
        const start = Number(url.searchParams.get('StartIndex'))
        return new Response(JSON.stringify(page(start === 0 ? 2000 : 500, start)))
      },
    })
    const all = await jellyfin.catalogue(emby)
    expect(all).toHaveLength(2500)
    expect(calls.map((c) => c.url.searchParams.get('StartIndex'))).toEqual(['0', '2000'])
    expect(calls[0]!.url.searchParams.get('EnableImages')).toBe('false')
  })

  it('reports playback as Sessions/Playing, Progress and Stopped, with the position in ticks', async () => {
    const calls = serve({ '/Sessions/Playing': '', '/Sessions/Playing/Progress': '', '/Sessions/Playing/Stopped': '' })
    const base = { sourceId: `${jf.id}#item7#ms9`, position: 90.5, duration: 7200, sessionId: 'sess1' }
    await jellyfin.report(jf, { ...base, state: 'started' })
    await jellyfin.report(jf, { ...base, state: 'progress' })
    await jellyfin.report(jf, { ...base, state: 'paused' })
    await jellyfin.report(jf, { ...base, state: 'stopped' }, true)
    expect(calls.map((c) => c.url.pathname)).toEqual(['/Sessions/Playing', '/Sessions/Playing/Progress', '/Sessions/Playing/Progress', '/Sessions/Playing/Stopped'])
    expect(calls.every((c) => c.init?.method === 'POST')).toBe(true)
    expect(JSON.parse(String(calls[0]!.init?.body))).toEqual({ ItemId: 'item7', MediaSourceId: 'ms9', PositionTicks: 905_000_000, PlaySessionId: 'sess1', IsPaused: false, CanSeek: true })
    expect(JSON.parse(String(calls[2]!.init?.body)).IsPaused).toBe(true)
    // A stop at closing time must outlive the page.
    expect(calls[3]!.init?.keepalive).toBe(true)
    expect(new Headers(calls[0]!.init?.headers).get('X-Emby-Authorization')).toContain('Token="tok"')
  })

  it('never throws when the server won’t take a report, and ignores a source it can’t read', async () => {
    serve({})
    await expect(jellyfin.report(jf, { state: 'progress', sourceId: `${jf.id}#a#b`, position: 1, sessionId: 's' })).resolves.toBeUndefined()
    const calls = serve({ '/Sessions/Playing': '' })
    await jellyfin.report(jf, { state: 'started', sourceId: 'no-hashes', position: 1, sessionId: 's' })
    expect(calls).toHaveLength(0)
  })
})

describe('Plex: browsing', () => {
  it('lists movie and TV libraries, with covers through the photo transcoder', async () => {
    serve({ '/library/sections': plexSections })
    const libraries = await plex.libraries(px)
    expect(libraries.map((l) => [l.id, l.name, l.type])).toEqual([
      ['1', 'Movies', 'movie'],
      ['2', 'TV Shows', 'show'],
    ])
    const cover = new URL(libraries[0]!.image!)
    expect(cover.pathname).toBe('/photo/:/transcode')
    expect(cover.searchParams.get('url')).toBe('/:/resources/movie-fanart.jpg')
    expect(cover.searchParams.get('X-Plex-Token')).toBe('plextok')
    // No art falls back to the thumbnail.
    expect(new URL(libraries[1]!.image!).searchParams.get('url')).toBe('/:/resources/show.png')
  })

  it('keeps films and series from recently added, drops seasons and episodes, and reads the guids', async () => {
    const calls = serve({ '/library/recentlyAdded': plexRecent })
    const titles = await plex.recentlyAdded(px, 30)
    expect(titles.map((t) => [t.itemId, t.title, t.type, t.tmdb])).toEqual([
      ['202', 'Dune: Part Two', 'movie', 693134],
      ['300', 'Severance', 'show', 95396],
      ['101', 'Dune', 'movie', 438631],
    ])
    expect(titles[0]).toMatchObject({ imdb: 'tt15239678', tvdb: 5678, addedAt: 1729425000 * 1000, overview: 'Paul Atreides unites with the Fremen.' })
    // Asks for twice as many, since seasons and episodes come back among them.
    expect(calls[0]!.url.searchParams.get('X-Plex-Container-Size')).toBe('60')
    expect(calls[0]!.url.searchParams.get('includeGuids')).toBe('1')
    expect(new Headers(calls[0]!.init?.headers).get('X-Plex-Token')).toBe('plextok')
  })

  it('flattens a search’s hubs into films and series', async () => {
    const calls = serve({ '/hubs/search': plexHubs })
    const titles = await plex.search(px, 'dune')
    expect(titles.map((t) => t.title)).toEqual(['Dune: Part Two', 'Dune: Prophecy'])
    expect(calls[0]!.url.searchParams.get('query')).toBe('dune')
  })

  it('lists a library newest first, and reads every library for the catalogue', async () => {
    const calls = serve({
      '/library/sections': plexSections,
      '/library/sections/1/all': { MediaContainer: { Metadata: [{ ratingKey: '1', type: 'movie', title: 'A', Guid: [{ id: 'tmdb://1' }] }] } },
      '/library/sections/2/all': { MediaContainer: { Metadata: [{ ratingKey: '2', type: 'show', title: 'B', Guid: [{ id: 'tmdb://2' }] }] } },
    })
    const all = await plex.catalogue(px)
    expect(all.map((t) => t.tmdb)).toEqual([1, 2])
    await plex.itemsIn(px, '1', 60)
    const last = calls.at(-1)!.url
    expect(last.pathname).toBe('/library/sections/1/all')
    expect(last.searchParams.get('sort')).toBe('addedAt:desc')
    expect(last.searchParams.get('X-Plex-Container-Size')).toBe('60')
  })

  it('reports on the timeline, and scrobbles a stop at 90 % or more', async () => {
    const calls = serve({ '/:/timeline': '', '/:/scrobble': '' })
    const base = { sourceId: `${px.id}#202#1`, sessionId: 's', duration: 1000 }
    await plex.report(px, { ...base, state: 'started', position: 10 })
    await plex.report(px, { ...base, state: 'paused', position: 20 })
    await plex.report(px, { ...base, state: 'stopped', position: 500 })
    expect(calls.map((c) => c.url.pathname)).toEqual(['/:/timeline', '/:/timeline', '/:/timeline'])
    expect(calls.map((c) => c.url.searchParams.get('state'))).toEqual(['playing', 'paused', 'stopped'])
    expect(calls[0]!.url.searchParams.get('time')).toBe('10000')
    expect(calls[0]!.url.searchParams.get('duration')).toBe('1000000')
    expect(calls[0]!.url.searchParams.get('key')).toBe('/library/metadata/202')
    await plex.report(px, { ...base, state: 'stopped', position: 950 })
    expect(calls.slice(3).map((c) => c.url.pathname)).toEqual(['/:/timeline', '/:/scrobble'])
    expect(calls[4]!.url.searchParams.get('key')).toBe('202')
    expect(calls[4]!.url.searchParams.get('identifier')).toBe('com.plexapp.plugins.library')
  })

  it('does not scrobble a pause late in the film, or a stop with no length to judge by', async () => {
    const calls = serve({ '/:/timeline': '', '/:/scrobble': '' })
    await plex.report(px, { state: 'paused', sourceId: `${px.id}#202#1`, position: 990, duration: 1000, sessionId: 's' })
    await plex.report(px, { state: 'stopped', sourceId: `${px.id}#202#1`, position: 990, sessionId: 's' })
    expect(calls.some((c) => c.url.pathname === '/:/scrobble')).toBe(false)
  })
})

describe('the servers together', () => {
  it('sends each call to the client for the server’s kind', async () => {
    const calls = serve({ '/Users/u1/Views': jellyfinViews, '/library/sections': plexSections, '/Sessions/Playing': '', '/:/timeline': '' })
    expect((await librariesOf(jf)).length).toBe(4)
    expect((await librariesOf(px)).length).toBe(2)
    await reportTo(jf, { state: 'started', sourceId: `${jf.id}#a#b`, position: 0, sessionId: 's' })
    await reportTo(px, { state: 'started', sourceId: `${px.id}#a#b`, position: 0, sessionId: 's' })
    expect(calls.map((c) => c.url.pathname).slice(2)).toEqual(['/Sessions/Playing', '/:/timeline'])
  })

  it('merges servers’ newest titles, newest first, each title once', () => {
    const t = (serverId: string, itemId: string, tmdb: number | undefined, addedAt: number): ServerTitle => ({ serverId, itemId, type: 'movie', title: itemId, tmdb, addedAt })
    const out = merged([[t('a', '1', 10, 100), t('a', '2', 11, 300)], [t('b', '3', 10, 200), t('b', '4', undefined, 50)]])
    expect(out.map((x) => x.itemId)).toEqual(['2', '3', '4'])
  })

  it('a server that fails adds nothing to Recently Added, and the rest still show', async () => {
    serve({
      '/Users/u1/Items': jellyfinRecent,
      '/library/recentlyAdded': () => new Response('nope', { status: 500 }),
    })
    const titles = await recentTitles([jf, px])
    expect(titles.length).toBe(3)
    expect(await recentOf(jf, 1)).toHaveLength(3)
  })

  it('reads a catalogue from a server whose listing is empty without error', async () => {
    serve({ '/Users/u1/Items': { Items: [], TotalRecordCount: 0 }, '/Users/u1/Views': { Items: [] } })
    expect(await catalogueOf(jf)).toEqual([])
  })
})
