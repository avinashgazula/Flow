import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ServerConfig } from '../store/settings'
import addonStreams from './__fixtures__/addon-streams.json'
import jellyfinByTMDB from './__fixtures__/jellyfin-by-tmdb.json'
import jellyfinEpisodes from './__fixtures__/jellyfin-episodes.json'
import jellyfinItem from './__fixtures__/jellyfin-item.json'
import jellyfinSearch from './__fixtures__/jellyfin-search.json'
import plexLibraryAll from './__fixtures__/plex-library-all.json'
import plexMetadata from './__fixtures__/plex-metadata.json'
import plexResources from './__fixtures__/plex-resources.json'
import { addonBase, addonSources, mapStreams, normaliseManifestURL, servesStreams, slimManifest, stremioId } from './addons'
import { fixedCapabilities } from './capabilities'
import { demoSources, sampleStreams } from './demo'
import { findSources, searchSources, type Provider } from './index'
import { jellyfinSources, normaliseServerURL, pickItem } from './jellyfin'
import { describeSource, matchLastSource, pruned } from './lastSource'
import { guidIds, mapMetadata, mapResources, pickMetadata, plexSources, preferredConnections } from './plex'
import type { PlaybackRequest, Source } from './types'

const chrome = fixedCapabilities({})
const dune: PlaybackRequest = {
  type: 'movie',
  tmdbId: 693134,
  imdbId: 'tt15239678',
  item: { type: 'movie', id: 693134, title: 'Dune: Part Two', year: 2024, overview: '', genres: [] },
}
const got: PlaybackRequest = {
  type: 'show',
  tmdbId: 1399,
  imdbId: 'tt0944947',
  season: 1,
  episode: 2,
  item: { type: 'show', id: 1399, title: 'Game of Thrones', year: 2011, overview: '', genres: [] },
}

/** Answers fetches from a table of path → JSON, recording what was asked. */
function serve(routes: Record<string, unknown>) {
  const calls: { url: string; init?: RequestInit }[] = []
  const fetch = vi.fn(async (input: string | URL, init?: RequestInit) => {
    const url = String(input)
    calls.push({ url, init })
    const path = new URL(url).pathname
    const key = Object.keys(routes).find((k) => (k.includes('=') ? url.includes(k) : path === k || path.endsWith(k)))
    if (!key) return new Response('{}', { status: 404 })
    return new Response(JSON.stringify(routes[key]), { status: 200, headers: { 'Content-Type': 'application/json' } })
  })
  vi.stubGlobal('fetch', fetch)
  return calls
}

afterEach(() => vi.unstubAllGlobals())

describe('Stremio add-ons', () => {
  const manifest = slimManifest({ id: 'x', name: 'X', types: ['movie', 'series'], resources: ['catalog', { name: 'stream', types: ['movie', 'series'], idPrefixes: ['tt'] }] })

  it('builds ids the Stremio way', () => {
    expect(stremioId(dune)).toBe('tt15239678')
    expect(stremioId(got)).toBe('tt0944947:1:2')
    expect(stremioId({ ...got, episode: undefined })).toBeUndefined()
    expect(stremioId({ ...dune, imdbId: undefined })).toBeUndefined()
    expect(stremioId({ ...dune, imdbId: undefined }, slimManifest({ id: 't', resources: ['stream'], idPrefixes: ['tt', 'tmdb:'] }))).toBe('tmdb:693134')
  })

  it('matches the manifest’s resources (ServiceTests.testManifestResourceMatching)', () => {
    expect(servesStreams(manifest, 'movie', 'tt123')).toBe(true)
    expect(servesStreams(manifest, 'movie', 'kitsu:1')).toBe(false)
    expect(servesStreams(manifest, 'tv', 'tt123')).toBe(false)
    expect(servesStreams(undefined, 'movie', 'kitsu:1')).toBe(true)
  })

  it('accepts stremio:// links and bare addresses', () => {
    expect(normaliseManifestURL('stremio://aio.example/u/abc/manifest.json')).toBe('https://aio.example/u/abc/manifest.json')
    expect(normaliseManifestURL(' https://aio.example/u/abc ')).toBe('https://aio.example/u/abc/manifest.json')
    expect(normaliseManifestURL('torrentio.strem.fun')).toBe('https://torrentio.strem.fun/manifest.json')
    expect(addonBase('https://aio.example/u/abc/manifest.json')).toBe('https://aio.example/u/abc')
  })

  it('maps streams, counting torrents and dropping what isn’t playable video', () => {
    const { sources, torrents } = mapStreams(addonStreams.streams, { url: 'https://aio.example/manifest.json', name: 'AIOStreams' }, chrome)
    expect(torrents).toBe(2)
    expect(sources).toHaveLength(2)
    const [hd, uhd] = sources as [Source, Source]
    expect(hd.resolution).toBe('1080p')
    expect(hd.sizeBytes).toBe(4273492541)
    expect(hd.bingeGroup).toBe('aio|1080p')
    expect(hd.engine).toBe('remux')
    expect(hd.title).toBe('Show.S01E02.1080p.WEB-DL.AAC.H264.mkv')
    expect(hd.notWebReady).toBe(true)
    expect(hd.subtitles).toEqual([{ url: 'https://subs.example/en.vtt', language: 'eng', label: 'eng', format: 'vtt' }])
    expect(hd.unsupported).toBeUndefined()
    expect(uhd.title).toBe('Show.S01E02.2160p.WEB-DL.DV.HDR10.DDP5.1.Atmos.HEVC-FLUX.mp4')
    expect(uhd.headers).toEqual({ Referer: 'https://cdn.example/' })
    expect(uhd.hdr).toEqual(['DV', 'HDR10'])
    expect(uhd.seeders).toBe(210)
    expect(uhd.releaseGroup).toBe('flux')
    expect(uhd.unsupported).toBeDefined()
    // The same stream gets the same id on every search.
    expect(mapStreams(addonStreams.streams, { url: 'https://aio.example/manifest.json', name: 'AIOStreams' }, chrome).sources[0]!.id).toBe(hd.id)
  })

  it('asks /stream/{type}/{id}.json', async () => {
    const calls = serve({ '/stream/series/tt0944947:1:2.json': addonStreams })
    const result = await addonSources({ url: 'https://aio.example/u/abc/manifest.json', name: 'AIOStreams', enabled: true, manifest }, got, chrome)
    expect(calls[0]!.url).toBe('https://aio.example/u/abc/stream/series/tt0944947:1:2.json')
    expect(result.sources).toHaveLength(2)
    expect(result.torrents).toBe(2)
  })
})

const jellyfin: ServerConfig = { id: 'jellyfin:srv:user', kind: 'jellyfin', name: 'Living Room', url: 'https://jf.example', token: 'secret-token', userId: 'user', enabled: true }

describe('Jellyfin', () => {
  it('cleans up pasted addresses', () => {
    expect(normaliseServerURL('https://jf.example/web/index.html#!/home.html')).toBe('https://jf.example')
    expect(normaliseServerURL('jf.example/')).toBe('https://jf.example')
    expect(normaliseServerURL('192.168.1.20:8096')).toBe('http://192.168.1.20:8096')
    expect(normaliseServerURL('https://media.example/emby/')).toBe('https://media.example/emby')
  })

  it('matches by TMDB id before anything else', () => {
    expect(pickItem(jellyfinByTMDB.Items, dune)?.Id).toBe('f5c7')
  })

  it('falls back to title and year, cleaning up file-named items', () => {
    expect(pickItem(jellyfinSearch.Items, dune)?.Id).toBe('b2')
    expect(pickItem(jellyfinSearch.Items, { ...dune, item: { ...dune.item, title: 'Something Else' } })).toBeUndefined()
  })

  it('trusts an id lookup even when the server’s title is odd', () => {
    const odd = [{ Id: 'z', Name: 'tt15239678', Type: 'Movie', ProviderIds: { Imdb: 'tt15239678' } }]
    expect(pickItem(odd, dune, 'imdb.tt15239678')?.Id).toBe('z')
  })

  it('builds stream URLs this browser can play, with the resume position', async () => {
    const calls = serve({ 'AnyProviderIdEquals=tmdb.693134': jellyfinByTMDB, '/Users/user/Items/f5c7': jellyfinItem })
    const sources = await jellyfinSources(jellyfin, dune, chrome)
    expect(sources).toHaveLength(3)
    const [uhd, hd, mkv] = sources as [Source, Source, Source]
    // HEVC with TrueHD: Chrome decodes neither, so the server's HLS, asking only for what it can.
    expect(uhd.engine).toBe('hls')
    expect(uhd.url).toContain('https://jf.example/Videos/f5c7/master.m3u8?')
    expect(uhd.url).toContain('VideoCodec=h264%2Cav1')
    expect(uhd.url).toContain('AudioCodec=aac%2Cflac')
    expect(uhd.url).toContain('api_key=secret-token')
    expect(uhd.unsupported).toBeUndefined()
    expect(uhd.resolution).toBe('2160p')
    expect(uhd.hdr).toEqual(['DV', 'HDR10'])
    expect(uhd.audio?.[0]).toBe('TrueHD')
    expect(uhd.languages).toEqual(['English', 'Spanish'])
    expect(uhd.serverPosition).toBe(3800)
    expect(uhd.subtitles).toEqual([{ url: 'https://jf.example/Videos/f5c7/ms-mkv/Subtitles/3/0/Stream.vtt?api_key=secret-token', language: 'eng', label: 'English (SRT)', format: 'vtt' }])
    // MP4 with H.264 and AAC plays straight from the file.
    expect(hd.engine).toBe('native')
    expect(hd.url).toBe('https://jf.example/Videos/f5c7/stream?MediaSourceId=ms-mp4&static=true&api_key=secret-token')
    // Matroska with a playable track goes to the remuxer, not the transcoder.
    expect(mkv.engine).toBe('remux')
    expect(mkv.url).toContain('/Videos/f5c7/stream?MediaSourceId=ms-mkv-h264&static=true')
    expect(mkv.unsupported).toBeUndefined()
    // Every request carries the sign-in header.
    expect((calls[0]!.init!.headers as Record<string, string>)['X-Emby-Authorization']).toMatch(/^MediaBrowser Client="Flow", .*Token="secret-token"$/)
  })

  it('finds the episode by season and number', async () => {
    const show = { Items: [{ Id: 'show1', Name: 'Game of Thrones', Type: 'Series', ProductionYear: 2011, ProviderIds: { Tmdb: '1399' } }] }
    serve({ 'AnyProviderIdEquals=tmdb.1399': show, '/Shows/show1/Episodes': jellyfinEpisodes, '/Users/user/Items/ep-1-2': { ...jellyfinItem, Id: 'ep-1-2' } })
    const sources = await jellyfinSources(jellyfin, got, chrome)
    expect(sources[0]!.id).toBe('jellyfin:srv:user#ep-1-2#ms-mkv')
  })
})

const plex: ServerConfig = { id: 'plex:abc123machine', kind: 'plex', name: 'Living Room', url: 'https://192-168-1-20.abc123.plex.direct:32400', token: 'plex-token', enabled: true }

describe('Plex', () => {
  it('reads ids from guids', () => {
    expect(guidIds({ Guid: [{ id: 'imdb://tt15239678' }, { id: 'tmdb://693134' }, { id: 'tvdb://5678' }] })).toEqual({ imdb: 'tt15239678', tmdb: 693134, tvdb: 5678 })
  })

  it('matches by guid, not by the first result', () => {
    expect(pickMetadata(plexLibraryAll.MediaContainer.Metadata, dune)?.ratingKey).toBe('202')
    expect(pickMetadata(plexLibraryAll.MediaContainer.Metadata, { ...dune, tmdbId: 1, imdbId: 'tt1160419' })?.ratingKey).toBe('101')
  })

  it('keeps servers only, and tries https connections first', () => {
    const [server, ...rest] = mapResources(plexResources, 'user-token')
    expect(rest).toHaveLength(0)
    expect(server!.accessToken).toBe('server-token')
    expect(preferredConnections(server!, true).map((c) => c.uri)).toEqual([
      'https://192-168-1-20.abc123.plex.direct:32400',
      'https://203-0-113-5.abc123.plex.direct:32400',
      'https://relay.abc123.plex.direct:8443',
    ])
    expect(preferredConnections(server!, false).at(-1)!.uri).toBe('http://192.168.1.20:32400')
  })

  it('plays MP4 and Matroska directly, the rest through Plex’s HLS', () => {
    const [uhd, hd, avi] = mapMetadata(plex, plexMetadata.MediaContainer.Metadata[0]!, fixedCapabilities({ video: ['H264', 'HEVC'], audio: ['AAC', 'DD+'] })) as [Source, Source, Source]
    expect(uhd.engine).toBe('remux')
    expect(uhd.url).toBe('https://192-168-1-20.abc123.plex.direct:32400/library/parts/9001/1700000000/file.mkv?X-Plex-Token=plex-token')
    expect(uhd.serverPosition).toBe(3800)
    expect(hd.engine).toBe('native')
    expect(hd.resolution).toBe('1080p')
    expect(avi.engine).toBe('hls')
    expect(avi.url).toContain('/video/:/transcode/universal/start.m3u8?')
    expect(avi.unsupported).toBeUndefined()
  })

  it('finds the title by its TMDB guid', async () => {
    const calls = serve({ 'guid=tmdb%3A%2F%2F693134': plexLibraryAll, '/library/metadata/202': plexMetadata })
    const sources = await plexSources(plex, dune, chrome)
    expect(sources.map((s) => s.id)).toEqual(['plex:abc123machine#202#9001', 'plex:abc123machine#202#9002', 'plex:abc123machine#202#9003'])
    expect((calls[0]!.init!.headers as Record<string, string>)['X-Plex-Token']).toBe('plex-token')
  })
})

describe('last source (LastSourceTests)', () => {
  const s = (id: string, extra: Partial<Source> = {}): Source => ({ id, origin: 'addon', provider: 'aio', providerId: 'aio', title: id, url: `https://debrid.test/${id}`, engine: 'native', resolution: '1080p', quality: 'WEB-DL', ...extra })

  it('wins with the same file even when it moved down the list', () => {
    const last = describeSource(s('old', { filename: 'Dune.2160p.DV.mkv', resolution: '2160p' }))
    expect(matchLastSource(last, [s('a', { filename: 'Dune.1080p.mkv' }), s('b', { filename: 'Dune.2160p.DV.mkv' })])?.id).toBe('b')
  })

  it('takes the next episode from the same binge group', () => {
    const last = describeSource(s('e1', { filename: 'Show.S01E01.mkv', bingeGroup: 'aio|2160p|DV' }))
    expect(matchLastSource(last, [s('x', { filename: 'Show.S01E02.1080p.mkv', bingeGroup: 'aio|1080p' }), s('y', { filename: 'Show.S01E02.2160p.mkv', bingeGroup: 'aio|2160p|DV' })])?.id).toBe('y')
  })

  it('or else the same release', () => {
    const last = describeSource(s('e1', { filename: 'Show.S01E01.mkv', releaseGroup: 'NTb', resolution: '2160p', hdr: ['DV'] }))
    expect(matchLastSource(last, [s('x', { releaseGroup: 'NTb' }), s('y', { releaseGroup: 'ntb', resolution: '2160p', hdr: ['DV'] })])?.id).toBe('y')
  })

  it('leaves the ranking alone when nothing is close enough', () => {
    const last = describeSource(s('old', { filename: 'a.mkv', releaseGroup: 'NTb' }))
    expect(matchLastSource(last, [s('x', { filename: 'b.mkv', releaseGroup: 'FLUX' })])).toBeUndefined()
    expect(matchLastSource(last, [s('y', { providerId: 'torrentio', filename: 'a.mkv' })])).toBeUndefined()
    expect(matchLastSource(last, [s('z', { filename: 'a.mkv', unsupported: 'DTS audio can’t play in a browser' })])).toBeUndefined()
  })

  it('keeps no link, and prunes to the most recent', () => {
    expect(JSON.stringify(describeSource(s('x', { filename: 'a.mkv' })))).not.toContain('debrid.test')
    const all = Object.fromEntries([0, 1, 2, 3, 4].map((i) => [`movie:${i}`, { ...describeSource(s(`s${i}`)), date: i }]))
    expect(Object.keys(pruned(all, 2)).sort()).toEqual(['movie:3', 'movie:4'])
  })
})

describe('sample sources', () => {
  it('name and rank like the apps’ demo provider, and play Apple’s HLS samples and the bundled MKV', async () => {
    const list = await demoSources(dune, chrome)
    expect(list.map((s) => s.id)).toEqual(['demo#0', 'demo#1', 'demo#2', 'demo#3', 'demo#mkv'])
    expect(list[0]!.title).toBe('Dune.Part.Two.1080p.WEB-DL.AAC.H264.mkv')
    expect(list[0]!.url).toBe(sampleStreams[0])
    expect(list[0]!.engine).toBe('hls')
    expect(list[1]!.unsupported).toBeUndefined()
    expect(list[2]!.unsupported).toBe('DTS-HD MA audio can’t play in a browser')
    expect(list[4]!.engine).toBe('remux')
    expect(list[4]!.url).toMatch(/samples\/flow-sample\.mkv$/)
    expect((await demoSources(got, chrome))[0]!.title).toBe('Game.of.Thrones.S01E02.1080p.WEB-DL.AAC.H264.mkv')
  })
})

describe('findSources', () => {
  const hang = (signal: AbortSignal) => new Promise<Source[]>((_, reject) => (signal.aborted ? reject(signal.reason) : signal.addEventListener('abort', () => reject(signal.reason))))
  const fake = (id: string, run: (signal: AbortSignal) => Promise<Source[]>, torrents = 0): Provider => ({
    id,
    name: id,
    kind: 'addon',
    search: async (_r, _c, signal) => ({ sources: await run(signal), torrents }),
  })
  const src = (id: string, provider: string, resolution: Source['resolution'], url = `https://x.test/${id}.mp4`): Source => ({ id, origin: 'addon', provider, providerId: provider, title: id, url, engine: 'native', resolution })

  it('streams each provider’s results, dedupes, ranks, and gives up on slow ones', async () => {
    const updates: string[] = []
    const result = await searchSources(dune, {
      capabilities: chrome,
      timeoutMs: 50,
      providers: [
        fake('fast', async () => [src('a', 'fast', '720p'), src('dup', 'fast', '1080p', 'https://x.test/same.mp4')]),
        fake('second', async () => [src('b', 'second', '1080p'), src('dup2', 'second', '1080p', 'https://x.test/same.mp4')], 3),
        fake('slow', hang),
      ],
      onUpdate: (u) => updates.push(u.providers.map((p) => `${p.id}:${p.state}`).join(',')),
    })
    expect(result.finished).toBe(true)
    expect(result.sources.map((s) => s.id)).toEqual(['dup', 'b', 'a'])
    expect(result.torrents).toBe(3)
    expect(result.providers.find((p) => p.id === 'slow')).toMatchObject({ state: 'failed', error: 'Didn’t answer in time.' })
    expect(updates[0]).toBe('fast:loading,second:loading,slow:loading')
  })

  it('stops when the picker closes', async () => {
    const controller = new AbortController()
    const pending = searchSources(dune, { capabilities: chrome, signal: controller.signal, providers: [fake('slow', hang)] })
    controller.abort()
    await expect(pending).rejects.toBeDefined()
  })

  it('reports per provider through the contract’s onResults', async () => {
    const { settingsStore } = await import('../store/settings')
    settingsStore.set({ demo: true, addons: [], servers: [] })
    const seen: string[] = []
    const all = await findSources(dune, { onResults: (sources, provider) => seen.push(`${provider}:${sources.length}`) })
    expect(seen).toEqual(['AIOStreams:5'])
    expect(all[0]!.id).toBe('demo#0')
    expect(all.find((s) => s.id === 'demo#2')!.unsupported).toBeDefined()
    expect(all.find((s) => s.id === 'demo#mkv')!.engine).toBe('remux')
    // Outside a browser there's no Media Source Extensions, so the MKV is explained, not offered.
    expect(all.slice(-2).every((s) => s.unsupported)).toBe(true)
  })
})
