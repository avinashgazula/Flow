import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PlaybackRequest, Source } from '../../lib/sources'
import type { ServerConfig } from '../../lib/store/settings'
import { forgetRefused, introDBSegments, introDBURL, lookupSegments, publicMetaDBSegments, publicMetaDBURL, serverSegments } from './segmentSources'

vi.mock('../../lib/sources/jellyfin', () => ({ mediaSegmentsFor: vi.fn(async () => ({ Items: [{ Type: 'Intro', StartTicks: 100_000_000, EndTicks: 600_000_000 }] })) }))
vi.mock('../../lib/sources/plex', () => ({ markersFor: vi.fn(async () => [{ type: 'credits', startTimeOffset: 2_400_000, endTimeOffset: 2_500_000 }]) }))

const episode: PlaybackRequest = {
  item: { type: 'show', id: 1399, title: 'Game of Thrones', overview: '', genres: [] },
  type: 'show',
  tmdbId: 1399,
  imdbId: 'tt0944947',
  season: 1,
  episode: 2,
}
const film: PlaybackRequest = { item: { type: 'movie', id: 693134, title: 'Dune: Part Two', overview: '', genres: [] }, type: 'movie', tmdbId: 693134, imdbId: 'tt15239678' }

const introAnswer = { intro: { start_sec: 437, end_sec: 531 }, recap: null, outro: { start_sec: 3631.5, end_sec: 3699.5 } }
const answer = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

let fetchMock: ReturnType<typeof vi.fn>
beforeEach(() => {
  forgetRefused()
  fetchMock = vi.fn()
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => vi.unstubAllGlobals())

describe('the addresses', () => {
  it('asks IntroDB by IMDb id, with the season and episode, or as a film', () => {
    expect(introDBURL(episode)).toBe('https://api.introdb.app/segments?imdb_id=tt0944947&season=1&episode=2')
    expect(introDBURL(film)).toBe('https://api.introdb.app/segments?imdb_id=tt15239678&is_movie=true')
  })

  it('does not ask IntroDB without an IMDb id, or for an episode without numbers', () => {
    expect(introDBURL({ ...episode, imdbId: undefined })).toBeUndefined()
    expect(introDBURL({ ...episode, season: undefined })).toBeUndefined()
  })

  it('asks PublicMetaDB by TMDB id', () => {
    expect(publicMetaDBURL(episode)).toBe('https://publicmetadb.com/api/external/skips?tmdb_id=1399&media_type=tv&season=1&episode=2')
    expect(publicMetaDBURL(film)).toBe('https://publicmetadb.com/api/external/skips?tmdb_id=693134&media_type=movie')
    expect(publicMetaDBURL({ ...episode, episode: undefined })).toBeUndefined()
  })
})

describe('IntroDB', () => {
  it('goes through the stream proxy when there is one, with no key header', async () => {
    fetchMock.mockResolvedValue(answer(introAnswer))
    const segments = await introDBSegments(episode, 'idb_key', undefined, 'https://proxy.example.com/?url={url}')
    expect(segments).toEqual([
      { kind: 'intro', start: 437, end: 531 },
      { kind: 'credits', start: 3631.5, end: 3699.5 },
    ])
    const [url, init] = fetchMock.mock.calls[0]!
    expect(url).toBe(`https://proxy.example.com/?url=${encodeURIComponent('https://api.introdb.app/segments?imdb_id=tt0944947&season=1&episode=2')}`)
    expect(init.headers).toEqual({})
  })

  it('asks directly without a proxy, with the key', async () => {
    fetchMock.mockResolvedValue(answer(introAnswer))
    await introDBSegments(episode, 'idb_key', undefined, '')
    const [url, init] = fetchMock.mock.calls[0]!
    expect(url).toBe('https://api.introdb.app/segments?imdb_id=tt0944947&season=1&episode=2')
    expect(init.headers).toEqual({ 'X-API-Key': 'idb_key' })
  })

  it('gives up quietly when the browser refuses the page, and does not ask again this visit', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'))
    expect(await introDBSegments(episode, 'k', undefined, '')).toEqual([])
    expect(await introDBSegments(episode, 'k', undefined, '')).toEqual([])
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('treats an episode IntroDB does not know as no segments, and asks again next time', async () => {
    fetchMock.mockResolvedValue(answer({ error: 'Not found' }, 404))
    expect(await introDBSegments(episode, 'k', undefined, '')).toEqual([])
    expect(await introDBSegments(episode, 'k', undefined, '')).toEqual([])
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('treats an answer that is not JSON as no segments', async () => {
    fetchMock.mockResolvedValue(new Response('<html>nope</html>', { status: 200 }))
    expect(await introDBSegments(episode, 'k', undefined, '')).toEqual([])
  })

  it('does not ask for a title without an IMDb id', async () => {
    expect(await introDBSegments({ ...episode, imdbId: undefined }, 'k', undefined, '')).toEqual([])
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('PublicMetaDB', () => {
  it('sends the key as a Bearer token and reads its flat records', async () => {
    fetchMock.mockResolvedValue(answer({ items: [{ source: 'streaming', intro_start_ms: 0, intro_end_ms: 62000, credits_start_ms: 3180000, credits_end_ms: 3240000 }] }))
    const segments = await publicMetaDBSegments(episode, 'pm-key')
    expect(segments).toEqual([
      { kind: 'intro', start: 0, end: 62 },
      { kind: 'credits', start: 3180, end: 3240 },
    ])
    const [url, init] = fetchMock.mock.calls[0]!
    expect(url).toContain('https://publicmetadb.com/api/external/skips?')
    expect(init.headers).toEqual({ Authorization: 'Bearer pm-key' })
  })

  it('is not asked again after the browser refuses it', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'))
    await publicMetaDBSegments(episode, 'pm-key')
    await publicMetaDBSegments(episode, 'pm-key')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})

describe('servers', () => {
  const jellyfin: ServerConfig = { id: 'jellyfin:abc:u1', kind: 'jellyfin', name: 'Den', url: 'https://jf.example.com', token: 't', enabled: true }
  const plex: ServerConfig = { id: 'plex:m1', kind: 'plex', name: 'Plex', url: 'https://plex.example.com', token: 't', enabled: true }
  const emby: ServerConfig = { id: 'emby:e1:u1', kind: 'emby', name: 'Emby', url: 'https://emby.example.com', token: 't', enabled: true }
  const from = (config: ServerConfig, origin: Source['origin']): Source => ({ id: `${config.id}#item42#ms1`, origin, provider: config.name, providerId: config.id, title: 'x', url: 'https://x', engine: 'native' })

  it('reads Jellyfin’s media segments for the item in the source’s id', async () => {
    expect(await serverSegments(from(jellyfin, 'jellyfin'), [jellyfin])).toEqual([{ kind: 'intro', start: 10, end: 60 }])
    const { mediaSegmentsFor } = await import('../../lib/sources/jellyfin')
    expect(mediaSegmentsFor).toHaveBeenCalledWith(jellyfin, 'item42', expect.any(AbortSignal))
  })

  it('reads Plex’s markers', async () => {
    expect(await serverSegments(from(plex, 'plex'), [plex])).toEqual([{ kind: 'credits', start: 2400, end: 2500 }])
  })

  it('has nothing for Emby, an add-on, the sample data, or a server that is gone', async () => {
    expect(await serverSegments(from(emby, 'emby'), [emby])).toEqual([])
    expect(await serverSegments({ ...from(jellyfin, 'jellyfin'), origin: 'addon' }, [jellyfin])).toEqual([])
    expect(await serverSegments(from(jellyfin, 'jellyfin'), [])).toEqual([])
  })

  it('has nothing when the server fails (an older Jellyfin answers 404)', async () => {
    const { mediaSegmentsFor } = await import('../../lib/sources/jellyfin')
    vi.mocked(mediaSegmentsFor).mockRejectedValueOnce(new Error('404'))
    expect(await serverSegments(from(jellyfin, 'jellyfin'), [jellyfin])).toEqual([])
  })
})

describe('the first answer wins', () => {
  const jellyfin: ServerConfig = { id: 'jellyfin:abc:u1', kind: 'jellyfin', name: 'Den', url: 'https://jf.example.com', token: 't', enabled: true }
  const source: Source = { id: `${jellyfin.id}#item42#ms1`, origin: 'jellyfin', provider: 'Den', providerId: jellyfin.id, title: 'x', url: 'https://x', engine: 'native' }
  const base = { request: episode, servers: [jellyfin], introDBKey: '', publicMetaDBKey: '' }

  it('prefers the server, and asks no service when it has an answer', async () => {
    const segments = await lookupSegments({ ...base, source, introDBKey: 'k', publicMetaDBKey: 'k' })
    expect(segments).toEqual([{ kind: 'intro', start: 10, end: 60 }])
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('asks no service without a key', async () => {
    expect(await lookupSegments({ ...base, source: null })).toEqual([])
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('goes on to PublicMetaDB when IntroDB has nothing', async () => {
    fetchMock.mockImplementation(async (url: string) => (url.includes('introdb') ? answer({ error: 'none' }, 404) : answer({ items: [{ intro_start_ms: 1000, intro_end_ms: 31000 }] })))
    const segments = await lookupSegments({ ...base, source: null, introDBKey: 'a', publicMetaDBKey: 'b' })
    expect(segments).toEqual([{ kind: 'intro', start: 1, end: 31 }])
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('does not stop on a service that throws', async () => {
    fetchMock.mockRejectedValue(new Error('boom'))
    expect(await lookupSegments({ ...base, source: null, introDBKey: 'a', publicMetaDBKey: 'b' })).toEqual([])
  })
})
