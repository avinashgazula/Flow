/* Plex, as FlowKit's PlexClient: sign-in with a plex.tv PIN, server discovery, matching by guid
   (tmdb://, imdb://) and direct play with X-Plex-Token. A browser plays MP4 itself and Matroska
   through the remuxer; anything else is Plex's own HLS. */

import type { ServerConfig } from '../store/settings'
import type { Capabilities } from './capabilities'
import { deviceId, deviceName, request, requestJSON, SourceError, uuid } from './http'
import { bestMatch, type ServerCandidate } from './match'
import { parseStream, type ResolutionClass } from './parser'
import { buildSource } from './rank'
import type { PlaybackReport, PlaybackRequest, ServerLibrary, ServerTitle, Source } from './types'

export function plexHeaders(token?: string): Record<string, string> {
  const h: Record<string, string> = {
    'X-Plex-Product': 'Flow',
    'X-Plex-Version': '1.0',
    'X-Plex-Client-Identifier': deviceId(),
    'X-Plex-Platform': 'Web',
    'X-Plex-Device-Name': deviceName(),
    Accept: 'application/json',
  }
  if (token) h['X-Plex-Token'] = token
  return h
}

// MARK: Linking

export interface PlexPin {
  id: number
  code: string
  /** Where the viewer approves Flow, in a new window. */
  authURL: string
  expiresAt: number
}

/** A strong PIN: approved on app.plex.tv in another window, no code to type. */
export async function createPin(signal?: AbortSignal): Promise<PlexPin> {
  const r = await requestJSON<{ id: number; code: string; expiresIn?: number }>('https://plex.tv/api/v2/pins?strong=true', { method: 'POST', headers: plexHeaders(), signal, timeoutMs: 15_000 })
  const params = new URLSearchParams({ clientID: deviceId(), code: r.code, 'context[device][product]': 'Flow' })
  return { id: r.id, code: r.code, authURL: `https://app.plex.tv/auth#?${params}`, expiresAt: Date.now() + (r.expiresIn ?? 1800) * 1000 }
}

/** Waits for the PIN to be approved and answers with the account's token. */
export async function pollPin(pin: PlexPin, signal: AbortSignal): Promise<string> {
  while (Date.now() < pin.expiresAt) {
    signal.throwIfAborted()
    const r = await requestJSON<{ authToken?: string | null }>(`https://plex.tv/api/v2/pins/${pin.id}`, { headers: plexHeaders(), signal, timeoutMs: 15_000 })
    if (r?.authToken) return r.authToken
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(resolve, 2000)
      signal.addEventListener('abort', () => (clearTimeout(timer), reject(signal.reason)), { once: true })
    })
  }
  throw new SourceError('The Plex sign-in expired. Start again.')
}

export interface PlexConnection {
  uri: string
  local: boolean
  relay: boolean
  protocol: string
}

export interface DiscoveredServer {
  name: string
  machineId: string
  accessToken: string
  connections: PlexConnection[]
}

interface ResourceDTO {
  name: string
  clientIdentifier: string
  provides: string
  accessToken?: string
  connections?: { uri: string; local?: boolean; relay?: boolean; protocol?: string }[]
}

export function mapResources(resources: ResourceDTO[], userToken: string): DiscoveredServer[] {
  return (resources ?? [])
    .filter((r) => r.provides?.split(',').includes('server'))
    .map((r) => ({
      name: r.name,
      machineId: r.clientIdentifier,
      accessToken: r.accessToken ?? userToken,
      connections: (r.connections ?? []).map((c) => ({ uri: c.uri.replace(/\/+$/, ''), local: !!c.local, relay: !!c.relay, protocol: c.protocol ?? new URL(c.uri).protocol.replace(':', '') })),
    }))
}

/** Connections worth trying, best first. An HTTPS page can only use https ones (plex.direct
 *  addresses carry a certificate); among those, direct before relay, local before remote. */
export function preferredConnections(server: DiscoveredServer, pageIsHttps = typeof location !== 'undefined' && location.protocol === 'https:'): PlexConnection[] {
  const rank = (c: PlexConnection) => (c.protocol === 'https' ? 0 : 10) + (c.relay ? 4 : 0) + (c.local ? 0 : 1)
  return server.connections.filter((c) => !pageIsHttps || c.protocol === 'https').sort((a, b) => rank(a) - rank(b))
}

export async function discoverServers(userToken: string, signal?: AbortSignal): Promise<DiscoveredServer[]> {
  const resources = await requestJSON<ResourceDTO[]>('https://plex.tv/api/v2/resources?includeHttps=1&includeRelay=1', { headers: plexHeaders(userToken), signal, timeoutMs: 15_000 })
  return mapResources(resources, userToken)
}

/** The first connection that answers, as a server ready to save. */
export async function connectServer(server: DiscoveredServer, signal?: AbortSignal): Promise<ServerConfig> {
  for (const connection of preferredConnections(server)) {
    try {
      await request(`${connection.uri}/identity`, { headers: plexHeaders(server.accessToken), signal, timeoutMs: 5000 })
      return { id: `plex:${server.machineId}`, kind: 'plex', name: server.name, url: connection.uri, token: server.accessToken, machineId: server.machineId, enabled: true }
    } catch (error) {
      if ((error as Error)?.name === 'AbortError') throw error
    }
  }
  throw new SourceError(`Couldn’t reach ${server.name} on any of its addresses. Check that Remote Access is on in its Plex settings.`)
}

export async function testServer(config: ServerConfig, signal?: AbortSignal): Promise<string> {
  const r = await get(config, 'identity', {}, signal)
  return r.version ? `Plex ${r.version.split('-')[0]}` : 'Plex'
}

// MARK: Requests

interface MediaContainer {
  Metadata?: Metadata[]
  /** `library/sections`: the libraries. */
  Directory?: { key: string; title: string; type: string; art?: string; thumb?: string }[]
  /** `hubs/search`: results grouped by kind. */
  Hub?: { type?: string; Metadata?: Metadata[] }[]
  totalSize?: number
  version?: string
}

interface Metadata {
  ratingKey: string
  title?: string
  type?: string
  year?: number
  summary?: string
  thumb?: string
  art?: string
  /** Seconds since 1970. */
  addedAt?: number
  index?: number
  parentIndex?: number
  viewOffset?: number
  Guid?: { id: string }[]
  guid?: string
  Media?: MediaDTO[]
  /** With `includeMarkers=1`: intro and credits markers, in milliseconds. */
  Marker?: { type: string; startTimeOffset: number; endTimeOffset: number }[]
}

interface MediaDTO {
  id?: number
  videoResolution?: string
  videoCodec?: string
  audioCodec?: string
  audioChannels?: number
  container?: string
  Part?: { key: string; size?: number; file?: string; container?: string }[]
}

async function get(config: ServerConfig, path: string, query: Record<string, string> = {}, signal?: AbortSignal): Promise<MediaContainer> {
  const qs = new URLSearchParams(query).toString()
  const r = await requestJSON<{ MediaContainer?: MediaContainer }>(`${config.url}/${path}${qs ? `?${qs}` : ''}`, { headers: plexHeaders(config.token), signal })
  return r?.MediaContainer ?? {}
}

/** TMDB, IMDb and TVDB ids from Plex's guids ("tmdb://693134", "imdb://tt15239678"). */
export function guidIds(m: Pick<Metadata, 'Guid'>): { tmdb?: number; imdb?: string; tvdb?: number } {
  const ids: { tmdb?: number; imdb?: string; tvdb?: number } = {}
  for (const g of m.Guid ?? []) {
    if (g.id.startsWith('tmdb://')) ids.tmdb = Number(g.id.slice(7)) || undefined
    else if (g.id.startsWith('imdb://')) ids.imdb = g.id.slice(7)
    else if (g.id.startsWith('tvdb://')) ids.tvdb = Number(g.id.slice(7)) || undefined
  }
  return ids
}

export function plexCandidate(m: Metadata): (ServerCandidate & { meta: Metadata }) | undefined {
  const type = m.type === 'movie' ? 'movie' : m.type === 'show' ? 'show' : undefined
  if (!type) return undefined
  const ids = guidIds(m)
  return { itemId: m.ratingKey, type, title: m.title ?? '', year: m.year, tmdb: ids.tmdb, imdb: ids.imdb, meta: m }
}

export function pickMetadata(list: Metadata[], request: PlaybackRequest): Metadata | undefined {
  const candidates = list.map(plexCandidate).filter((c): c is NonNullable<typeof c> => !!c)
  return bestMatch(candidates, { type: request.type, title: request.item.title, year: request.item.year, tmdb: request.tmdbId, imdb: request.imdbId })?.meta
}

export async function plexSources(config: ServerConfig, request: PlaybackRequest, caps: Capabilities, signal?: AbortSignal): Promise<Source[]> {
  const type = request.type === 'movie' ? '1' : '2'
  let candidates = (await get(config, 'library/all', { guid: `tmdb://${request.tmdbId}`, type, includeGuids: '1' }, signal).catch(() => ({}) as MediaContainer)).Metadata ?? []
  if (candidates.length === 0 && request.imdbId) {
    candidates = (await get(config, 'library/all', { guid: `imdb://${request.imdbId}`, type, includeGuids: '1' }, signal).catch(() => ({}) as MediaContainer)).Metadata ?? []
  }
  if (candidates.length === 0) {
    const found = await get(config, 'library/search', { query: request.item.title, searchTypes: request.type === 'movie' ? 'movies' : 'tv', includeGuids: '1' }, signal)
    candidates = found.Metadata ?? []
  }
  const match = pickMetadata(candidates, request)
  if (!match) return []
  let ratingKey = match.ratingKey
  if (request.type === 'show') {
    const season = request.season ?? 1
    const number = request.episode ?? 1
    const leaves = await get(config, `library/metadata/${ratingKey}/allLeaves`, {}, signal)
    const episode = leaves.Metadata?.find((e) => e.parentIndex === season && e.index === number)
    if (!episode) return []
    ratingKey = episode.ratingKey
  }
  const full = (await get(config, `library/metadata/${ratingKey}`, {}, signal)).Metadata?.[0]
  if (!full) return []
  return mapMetadata(config, full, caps)
}

// MARK: Browsing: Home's server rows, the library index and Search (FlowKit's PlexClient)

/** A server's picture through its photo transcoder. It needs the token, so these addresses are made when a shelf
 *  is asked for and never kept in the saved cache. */
function photoURL(config: ServerConfig, path: string | undefined, width: number, height: number): string | undefined {
  if (!path) return undefined
  return `${config.url}/photo/:/transcode?${new URLSearchParams({ width: String(width), height: String(height), minSize: '1', url: path, 'X-Plex-Token': config.token })}`
}

/** A film or series on this server, or undefined for a season, an episode or anything else Plex lists. */
export function serverTitle(config: ServerConfig, m: Metadata): ServerTitle | undefined {
  const c = plexCandidate(m)
  if (!c) return undefined
  const ids = guidIds(m)
  const poster = photoURL(config, m.thumb, 500, 750)
  const backdrop = photoURL(config, m.art, 1280, 720)
  return {
    serverId: config.id,
    itemId: m.ratingKey,
    type: c.type,
    title: c.title,
    year: m.year,
    tmdb: ids.tmdb,
    imdb: ids.imdb,
    ...(ids.tvdb ? { tvdb: ids.tvdb } : {}),
    ...(poster ? { poster } : {}),
    ...(backdrop ? { backdrop } : {}),
    ...(m.summary ? { overview: m.summary } : {}),
    ...(m.addedAt ? { addedAt: m.addedAt * 1000 } : {}),
  }
}

const titlesOf = (config: ServerConfig, list: Metadata[] | undefined) => (list ?? []).flatMap((m) => serverTitle(config, m) ?? [])

/** Movie and TV libraries, in the order Plex lists them. */
export async function libraries(config: ServerConfig, signal?: AbortSignal): Promise<ServerLibrary[]> {
  const sections = (await get(config, 'library/sections', {}, signal)).Directory ?? []
  return sections.flatMap((d): ServerLibrary[] => {
    if (d.type !== 'movie' && d.type !== 'show') return []
    const image = photoURL(config, d.art ?? d.thumb, 640, 360)
    return [{ id: d.key, name: d.title, type: d.type === 'movie' ? 'movie' : 'show', ...(image ? { image } : {}) }]
  })
}

/** Every film and series in every library, with their guids. */
export async function catalogue(config: ServerConfig, signal?: AbortSignal): Promise<ServerTitle[]> {
  const all: ServerTitle[] = []
  const pageSize = 2000
  for (const library of await libraries(config, signal)) {
    for (let start = 0; ; start += pageSize) {
      const page = await get(config, `library/sections/${library.id}/all`, { includeGuids: '1', 'X-Plex-Container-Start': String(start), 'X-Plex-Container-Size': String(pageSize) }, signal)
      all.push(...titlesOf(config, page.Metadata))
      if ((page.Metadata?.length ?? 0) < pageSize) break
    }
  }
  return all
}

export async function itemsIn(config: ServerConfig, libraryId: string, limit: number, signal?: AbortSignal): Promise<ServerTitle[]> {
  const page = await get(config, `library/sections/${encodeURIComponent(libraryId)}/all`, { includeGuids: '1', sort: 'addedAt:desc', 'X-Plex-Container-Start': '0', 'X-Plex-Container-Size': String(limit) }, signal)
  return titlesOf(config, page.Metadata)
}

export async function recentlyAdded(config: ServerConfig, limit: number, signal?: AbortSignal): Promise<ServerTitle[]> {
  // Seasons and episodes come back too; only films and series are kept, so twice as many are asked for.
  const page = await get(config, 'library/recentlyAdded', { includeGuids: '1', 'X-Plex-Container-Start': '0', 'X-Plex-Container-Size': String(limit * 2) }, signal)
  return titlesOf(config, page.Metadata).slice(0, limit)
}

export async function search(config: ServerConfig, text: string, signal?: AbortSignal): Promise<ServerTitle[]> {
  const page = await get(config, 'hubs/search', { query: text, limit: '30', includeGuids: '1' }, signal)
  return titlesOf(config, (page.Hub ?? []).flatMap((hub) => hub.Metadata ?? []))
}

// MARK: Reporting playback (the timeline, and a scrobble when it's watched)

/** Plex counts a play as watched at 90 %, and so does the timeline on its own; the scrobble says it outright, for
 *  a play that ended with the credits rolling. */
export const scrobbleAt = 0.9

/** Tells Plex what is playing: `/:/timeline` with the state and position, and `/:/scrobble` when it stops at 90 %
 *  or more. Never throws. */
export async function report(config: ServerConfig, r: PlaybackReport, keepalive = false): Promise<void> {
  const ratingKey = r.sourceId.split('#')[1]
  if (!ratingKey) return
  const state = r.state === 'paused' ? 'paused' : r.state === 'stopped' ? 'stopped' : 'playing'
  const call = (path: string, query: Record<string, string>) =>
    request(`${config.url}/${path}?${new URLSearchParams(query)}`, { headers: plexHeaders(config.token), timeoutMs: 10_000, keepalive }).catch(() => undefined)
  await call(':/timeline', {
    ratingKey,
    key: `/library/metadata/${ratingKey}`,
    identifier: 'com.plexapp.plugins.library',
    state,
    time: String(Math.round(r.position * 1000)),
    ...(r.duration ? { duration: String(Math.round(r.duration * 1000)) } : {}),
  })
  if (r.state === 'stopped' && r.duration && r.position / r.duration >= scrobbleAt) await call(':/scrobble', { key: ratingKey, identifier: 'com.plexapp.plugins.library' })
}

/** The intro and credits markers Plex found for an item, as the server sends them. */
export async function markersFor(config: ServerConfig, ratingKey: string, signal?: AbortSignal): Promise<unknown> {
  const full = (await get(config, `library/metadata/${encodeURIComponent(ratingKey)}`, { includeMarkers: '1' }, signal)).Metadata?.[0]
  return full?.Marker ?? []
}

const videoCodecs: Record<string, string> = { h264: 'H264', hevc: 'HEVC', h265: 'HEVC', av1: 'AV1', vp9: 'VP9', mpeg4: 'XviD' }
const audioCodecs: Record<string, string> = { eac3: 'DD+', ac3: 'DD', truehd: 'TrueHD', dca: 'DTS', 'dca-ma': 'DTS-HD MA', dts: 'DTS', aac: 'AAC', flac: 'FLAC', opus: 'Opus', mp3: 'MP3' }

function resolution(r: string | undefined, fallback: ResolutionClass): ResolutionClass {
  const v = r?.toLowerCase()
  if (!v) return fallback
  if (v === '4k') return 2160
  if (v === '1080') return 1080
  if (v === '720') return 720
  return Number(v) > 0 ? 480 : fallback
}

export function mapMetadata(config: ServerConfig, full: Metadata, caps: Capabilities): Source[] {
  return (full.Media ?? []).flatMap((media, index) => {
    const part = media.Part?.[0]
    if (!part) return []
    const filename = part.file?.split(/[\\/]/).pop()
    const traits = parseStream(filename)
    traits.resolution = resolution(media.videoResolution, traits.resolution)
    const v = media.videoCodec?.toLowerCase()
    if (v) traits.videoCodec = videoCodecs[v] ?? v.toUpperCase()
    const a = media.audioCodec?.toLowerCase()
    if (a) {
      traits.audioCodec = audioCodecs[a] ?? a.toUpperCase()
      traits.audioCodecs = [traits.audioCodec]
    }
    if (media.audioChannels) traits.audioChannels = media.audioChannels >= 8 ? '7.1' : media.audioChannels >= 6 ? '5.1' : '2.0'
    if (part.size) traits.sizeBytes = part.size
    traits.isCached = undefined

    const container = (part.container ?? media.container ?? '').toLowerCase() || undefined
    const videoOK = !traits.videoCodec || caps.video(traits.videoCodec)
    const audioOK = !traits.audioCodec || caps.audio(traits.audioCodec)
    const direct = videoOK && audioOK && (container === 'mp4' || container === 'mov' || container === 'm4v' || container === 'webm' || (container === 'mkv' && caps.mse))
    let url: string
    if (direct) {
      url = `${config.url}${part.key}?${new URLSearchParams({ 'X-Plex-Token': config.token })}`
    } else {
      // Plex's universal transcoder as HLS; it copies streams the browser can take as they are.
      const params = new URLSearchParams({
        path: `/library/metadata/${full.ratingKey}`,
        mediaIndex: String(index),
        partIndex: '0',
        protocol: 'hls',
        directPlay: '0',
        directStream: '1',
        directStreamAudio: '1',
        fastSeek: '1',
        session: uuid(),
        'X-Plex-Client-Identifier': deviceId(),
        'X-Plex-Platform': 'Chrome',
        'X-Plex-Product': 'Flow',
        'X-Plex-Token': config.token,
      })
      url = `${config.url}/video/:/transcode/universal/start.m3u8?${params}`
    }
    return [
      buildSource(
        {
          id: `${config.id}#${full.ratingKey}#${media.id ?? index}`,
          origin: 'plex',
          provider: config.name,
          providerId: config.id,
          title: filename ?? full.title ?? config.name,
          url,
          filename,
          container: direct ? container : 'm3u8',
          transcoded: !direct,
          traits,
          serverPosition: full.viewOffset ? full.viewOffset / 1000 : undefined,
        },
        caps,
      ),
    ]
  })
}
