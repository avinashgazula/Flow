/* Jellyfin and Emby, which share the REST API Flow uses, as FlowKit's JellyfinClient. Differences
   for the browser: what plays directly is decided by what *this* browser decodes, Matroska goes to
   the remuxer instead of the server's transcoder, and everything else is the server's HLS. */

import type { ServerConfig } from '../store/settings'
import type { Capabilities } from './capabilities'
import { deviceId, deviceName, requestJSON, SourceError, uuid } from './http'
import { bestMatch, type ServerCandidate } from './match'
import { isUnsafeFileName, parseStream, titleAndYear, type ResolutionClass } from './parser'
import { buildSource } from './rank'
import type { ExternalSubtitle, PlaybackRequest, Source } from './types'

const ticksPerSecond = 10_000_000

export function authHeader(token?: string): string {
  let value = `MediaBrowser Client="Flow", Device="${deviceName()}", DeviceId="${deviceId()}", Version="1.0"`
  if (token) value += `, Token="${token}"`
  return value
}

/** Accepts what people paste: no scheme, a trailing slash, or the web app's own address
 *  ("https://jf.example.com/web/index.html#!/home.html"). */
export function normaliseServerURL(input: string): string {
  let url = input.trim()
  if (!/^https?:\/\//i.test(url)) {
    // A bare IP or a .local name is almost always a home server without a certificate.
    const local = /^(\d{1,3}\.){3}\d{1,3}(:\d+)?(\/|$)|^[^/]+\.local(:\d+)?(\/|$)|^localhost(:\d+)?(\/|$)/i.test(url)
    url = `${local ? 'http' : 'https'}://${url}`
  }
  const parsed = new URL(url)
  parsed.hash = ''
  parsed.search = ''
  parsed.pathname = parsed.pathname.replace(/\/web(\/.*)?$/i, '').replace(/\/+$/, '')
  return parsed.toString().replace(/\/+$/, '')
}

interface ItemDTO {
  Id: string
  Name?: string
  Type?: string
  ProductionYear?: number
  ProviderIds?: Record<string, string | undefined>
  ParentIndexNumber?: number
  IndexNumber?: number
  SeriesId?: string
  UserData?: { PlaybackPositionTicks?: number; Played?: boolean }
  MediaSources?: MediaSourceDTO[]
}

interface MediaSourceDTO {
  Id: string
  Name?: string
  Container?: string
  Size?: number
  Path?: string
  SupportsDirectPlay?: boolean
  SupportsDirectStream?: boolean
  SupportsTranscoding?: boolean
  IsRemote?: boolean
  Protocol?: string
  DirectStreamUrl?: string
  MediaStreams?: MediaStreamDTO[]
}

interface MediaStreamDTO {
  Type?: string
  Codec?: string
  Height?: number
  DisplayTitle?: string
  Language?: string
  Channels?: number
  VideoRange?: string
  VideoRangeType?: string
  IsDefault?: boolean
  Index?: number
  IsTextSubtitleStream?: boolean
  IsForced?: boolean
}

interface ItemsResponse {
  Items: ItemDTO[]
  TotalRecordCount?: number
}

export interface ServerInfo {
  ServerName?: string
  Version?: string
  Id?: string
  ProductName?: string
}

export async function publicInfo(base: string, signal?: AbortSignal): Promise<ServerInfo> {
  return requestJSON<ServerInfo>(`${base}/System/Info/Public`, { signal, timeoutMs: 10_000 })
}

/** Signs in with a username and password and returns a server ready to save. */
export async function signIn(kind: 'jellyfin' | 'emby', address: string, username: string, password: string, signal?: AbortSignal): Promise<ServerConfig> {
  const base = normaliseServerURL(address)
  const info = await publicInfo(base, signal).catch((error) => {
    throw error instanceof SourceError ? error : new SourceError('Couldn’t reach that server. Check the address.')
  })
  const response = await requestJSON<{ User: { Id: string; Name: string }; AccessToken: string }>(`${base}/Users/AuthenticateByName`, {
    method: 'POST',
    headers: { 'X-Emby-Authorization': authHeader() },
    body: { Username: username, Pw: password },
    signal,
    timeoutMs: 15_000,
  }).catch((error) => {
    if (error instanceof SourceError && error.status === 401) throw new SourceError('That username and password didn’t work. Check them and try again.', 401)
    throw error
  })
  return serverConfig(kind, base, info, response.AccessToken, response.User)
}

function serverConfig(kind: 'jellyfin' | 'emby', base: string, info: ServerInfo, token: string, user: { Id: string; Name: string }): ServerConfig {
  return {
    id: `${kind}:${info.Id ?? base}:${user.Id}`,
    kind,
    name: info.ServerName || (kind === 'emby' ? 'Emby' : 'Jellyfin'),
    url: base,
    token,
    userId: user.Id,
    username: user.Name,
    enabled: true,
  }
}

/** "Emby Server" and "Jellyfin Server" say which they are. */
export const detectKind = (info: ServerInfo): 'jellyfin' | 'emby' | undefined =>
  /emby/i.test(info.ProductName ?? '') ? 'emby' : /jellyfin/i.test(info.ProductName ?? '') ? 'jellyfin' : undefined

// MARK: Quick Connect (Jellyfin 10.8+): a six-digit code approved from another signed-in device.

export async function startQuickConnect(address: string, signal?: AbortSignal): Promise<{ base: string; code: string; secret: string }> {
  const base = normaliseServerURL(address)
  const headers = { 'X-Emby-Authorization': authHeader() }
  const enabled = await requestJSON<boolean>(`${base}/QuickConnect/Enabled`, { headers, signal, timeoutMs: 10_000 }).catch(() => false)
  if (!enabled) throw new SourceError('Quick Connect is off on this server. Turn it on in the server’s dashboard, or sign in with a password.')
  // 10.9 made Initiate a POST; 10.8 only answers GET.
  const started = await requestJSON<{ Code: string; Secret: string }>(`${base}/QuickConnect/Initiate`, { method: 'POST', headers, signal, timeoutMs: 10_000 }).catch(() =>
    requestJSON<{ Code: string; Secret: string }>(`${base}/QuickConnect/Initiate`, { headers, signal, timeoutMs: 10_000 }),
  )
  return { base, code: started.Code, secret: started.Secret }
}

export async function finishQuickConnect(base: string, secret: string, signal: AbortSignal): Promise<ServerConfig> {
  const headers = { 'X-Emby-Authorization': authHeader() }
  const deadline = Date.now() + 5 * 60_000
  while (Date.now() < deadline) {
    signal.throwIfAborted()
    const state = await requestJSON<{ Authenticated?: boolean }>(`${base}/QuickConnect/Connect?Secret=${encodeURIComponent(secret)}`, { headers, signal, timeoutMs: 10_000 })
    if (state?.Authenticated) {
      const response = await requestJSON<{ User: { Id: string; Name: string }; AccessToken: string }>(`${base}/Users/AuthenticateWithQuickConnect`, {
        method: 'POST',
        headers,
        body: { Secret: secret },
        signal,
      })
      const info = await publicInfo(base, signal).catch(() => ({}) as ServerInfo)
      return serverConfig('jellyfin', base, info, response.AccessToken, response.User)
    }
    await sleep(3000, signal)
  }
  throw new SourceError('The code expired. Start Quick Connect again.')
}

function sleep(ms: number, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(resolve, ms)
    signal.addEventListener('abort', () => (clearTimeout(timer), reject(signal.reason)), { once: true })
  })
}

// MARK: Requests

function headers(config: ServerConfig) {
  return { 'X-Emby-Authorization': authHeader(config.token), 'X-Emby-Token': config.token }
}

function get<T>(config: ServerConfig, path: string, query: Record<string, string | undefined> = {}, signal?: AbortSignal, method: 'GET' | 'POST' = 'GET', body?: unknown) {
  const params = new URLSearchParams()
  for (const [k, v] of Object.entries(query).sort(([a], [b]) => a.localeCompare(b))) if (v !== undefined) params.set(k, v)
  const qs = params.toString()
  return requestJSON<T>(`${config.url}/${path}${qs ? `?${qs}` : ''}`, { headers: headers(config), signal, method, body })
}

/** Checks the saved sign-in still works; answers with the server's version. */
export async function testServer(config: ServerConfig, signal?: AbortSignal): Promise<string> {
  const info = await get<ServerInfo>(config, 'System/Info', {}, signal)
  return [info.ProductName?.replace(/ Server$/, ''), info.Version].filter(Boolean).join(' ')
}

/** Runs an Items query. Some servers answer a library-wide recursive query with nothing and only list
 *  items per library; then it's asked again in each library and the results merged. */
async function queryItems(config: ServerConfig, query: Record<string, string | undefined>, signal?: AbortSignal): Promise<ItemsResponse> {
  const response = await get<ItemsResponse>(config, `Users/${config.userId}/Items`, query, signal)
  if ((response?.Items?.length ?? 0) > 0 || query.ParentId || query.Recursive !== 'true') return response ?? { Items: [] }
  const views = await get<ItemsResponse>(config, `Users/${config.userId}/Views`, {}, signal)
  const pages = await Promise.all(
    (views?.Items ?? []).map((view) => get<ItemsResponse>(config, `Users/${config.userId}/Items`, { ...query, ParentId: view.Id }, signal).catch(() => ({ Items: [] }))),
  )
  return { Items: pages.flatMap((p) => p?.Items ?? []) }
}

/** A server item in the shape matching works on, or undefined for anything that isn't a film or show. */
export function candidate(dto: ItemDTO): (ServerCandidate & { dto: ItemDTO }) | undefined {
  // Some servers list raw debrid files; never offer anything that isn't a video.
  if (dto.Name && isUnsafeFileName(dto.Name)) return undefined
  const type = dto.Type === 'Movie' ? 'movie' : dto.Type === 'Series' ? 'show' : undefined
  if (!type) return undefined
  const p = dto.ProviderIds ?? {}
  const tmdb = Number(p.Tmdb ?? p.tmdb ?? p.TMDB)
  let title = dto.Name ?? ''
  let year = dto.ProductionYear
  // Items some servers name after their file ("Resident Evil (2026) WEBDL-1080p.mp4") get a clean title.
  if (/\.(mkv|mp4|m4v|avi|mov|webm|ts)$/i.test(title)) {
    const parsed = titleAndYear(title)
    if (parsed.title) title = parsed.title
    year ??= parsed.year
  }
  return { itemId: dto.Id, type, title, year, tmdb: Number.isFinite(tmdb) && tmdb > 0 ? tmdb : undefined, imdb: p.Imdb ?? p.imdb ?? p.IMDB, dto }
}

/** The server's item for the title: by TMDB id, then IMDb id, then by title search. A match on the id
 *  is trusted even when the server's title is odd (some name items after their IMDb id). */
export function pickItem(items: ItemDTO[], request: PlaybackRequest, lookup?: string): ItemDTO | undefined {
  const want = { type: request.type, title: request.item.title, year: request.item.year, tmdb: request.tmdbId, imdb: request.imdbId }
  const candidates = items.map(candidate).filter((c): c is NonNullable<typeof c> => !!c)
  const found = bestMatch(candidates, want)
  if (found) return found.dto
  if (lookup) {
    const wanted = lookup.split('.').slice(1).join('.')
    return items.find((dto) => Object.values(dto.ProviderIds ?? {}).includes(wanted))
  }
  return undefined
}

export async function findItem(config: ServerConfig, request: PlaybackRequest, signal?: AbortSignal): Promise<ItemDTO | undefined> {
  const base = { Recursive: 'true', IncludeItemTypes: request.type === 'movie' ? 'Movie' : 'Series', Fields: 'ProviderIds,ProductionYear', Limit: '20' }
  const lookups = [`tmdb.${request.tmdbId}`, ...(request.imdbId ? [`imdb.${request.imdbId}`] : [])]
  for (const lookup of lookups) {
    const byId = await queryItems(config, { ...base, AnyProviderIdEquals: lookup }, signal).catch(() => undefined)
    const found = byId && pickItem(byId.Items, request, lookup)
    if (found) return found
  }
  const bySearch = await queryItems(config, { ...base, SearchTerm: request.item.title }, signal)
  return pickItem(bySearch.Items, request)
}

export async function jellyfinSources(config: ServerConfig, request: PlaybackRequest, caps: Capabilities, signal?: AbortSignal): Promise<Source[]> {
  const found = await findItem(config, request, signal)
  if (!found) return []
  let targetId = found.Id
  if (request.type === 'show') {
    const season = request.season ?? 1
    const number = request.episode ?? 1
    const episodes = await get<ItemsResponse>(config, `Shows/${found.Id}/Episodes`, { UserId: config.userId, Season: String(season), Fields: 'ProviderIds' }, signal)
    const episode = (episodes?.Items ?? []).find((e) => e.ParentIndexNumber === season && e.IndexNumber === number)
    if (!episode) return []
    targetId = episode.Id
  }
  // PlaybackInfo is where servers resolve what's playable now (and where some list sources at all);
  // the item's own MediaSources are the fallback. Both asked at once.
  const [full, info] = await Promise.all([
    get<ItemDTO>(config, `Users/${config.userId}/Items/${targetId}`, {}, signal),
    get<{ MediaSources?: MediaSourceDTO[] }>(config, `Items/${targetId}/PlaybackInfo`, { UserId: config.userId }, signal, 'POST', { UserId: config.userId, MaxStreamingBitrate: 140_000_000, AutoOpenLiveStream: true }).catch(() => undefined),
  ])
  const resume = (full?.UserData?.PlaybackPositionTicks ?? 0) / ticksPerSecond
  const mediaSources = info?.MediaSources?.length ? info.MediaSources : (full?.MediaSources ?? [])
  return mediaSources
    .map((ms, index) => mapMediaSource(config, targetId, ms, index, resume, caps))
    .filter((s) => !(s.filename && isUnsafeFileName(s.filename)))
}

const videoCodecs: Record<string, string> = { h264: 'H264', avc: 'H264', hevc: 'HEVC', h265: 'HEVC', av1: 'AV1', vp9: 'VP9', mpeg4: 'XviD', msmpeg4v3: 'XviD' }
const audioCodecs: Record<string, string> = { eac3: 'DD+', ac3: 'DD', truehd: 'TrueHD', dts: 'DTS', dca: 'DTS', aac: 'AAC', flac: 'FLAC', opus: 'Opus', mp3: 'MP3' }

export const resolutionFromHeight = (h: number): ResolutionClass => (h >= 1600 ? 2160 : h >= 1300 ? 1440 : h >= 900 ? 1080 : h >= 600 ? 720 : 480)

/** The file name, unless the path is an opaque playback link. */
function fileName(ms: MediaSourceDTO): string | undefined {
  if (!ms.Path) return undefined
  let last = ms.Path.split(/[\\/]/).pop() ?? ms.Path
  try {
    last = decodeURIComponent(last.split('?')[0]!)
  } catch {
    // Keep it as it is.
  }
  return last.includes('.') ? last : undefined
}

/** The origin of a source the server only links to (debrid, .strm): played directly. */
function remoteURL(ms: MediaSourceDTO): string | undefined {
  if (!(ms.IsRemote || ms.Protocol === 'Http')) return undefined
  return [ms.DirectStreamUrl, ms.Path].find((u) => u && /^https?:\/\//i.test(u))
}

export function mapMediaSource(config: ServerConfig, itemId: string, ms: MediaSourceDTO, index: number, resume: number, caps: Capabilities): Source {
  const streams = ms.MediaStreams ?? []
  const video = streams.find((s) => s.Type === 'Video')
  const audioStreams = streams.filter((s) => s.Type === 'Audio')
  const defaultAudio = audioStreams.find((s) => s.IsDefault) ?? audioStreams[0]
  // Add-on style names arrive flattened with " | "; restore their lines.
  const name = ms.Name?.replace(/ \| /g, '\n')
  const filename = fileName(ms)
  const traits = parseStream(name, filename)
  if (video?.Height) traits.resolution = resolutionFromHeight(video.Height)
  const videoCodec = video?.Codec?.toLowerCase()
  if (videoCodec) traits.videoCodec = videoCodecs[videoCodec] ?? videoCodec.toUpperCase()
  const range = video?.VideoRangeType ?? video?.VideoRange
  if (range && range !== 'SDR' && range !== 'Unknown') {
    traits.hdr = range.startsWith('DOVI')
      ? ['DV', ...(range.includes('HDR10') ? ['HDR10'] : range.includes('HLG') ? ['HLG'] : [])]
      : range === 'HDR10Plus'
        ? ['HDR10+']
        : range === 'HLG'
          ? ['HLG']
          : range === 'HDR10'
            ? ['HDR10']
            : ['HDR']
  }
  const audioNames = [...new Set(audioStreams.map((a) => a.Codec?.toLowerCase()).filter((c): c is string => !!c).map((c) => audioCodecs[c] ?? c.toUpperCase()))]
  if (defaultAudio?.Codec) {
    const lead = audioCodecs[defaultAudio.Codec.toLowerCase()] ?? defaultAudio.Codec.toUpperCase()
    traits.audioCodec = lead
    traits.audioCodecs = [lead, ...audioNames.filter((a) => a !== lead)]
  }
  if (defaultAudio?.Channels) traits.audioChannels = defaultAudio.Channels >= 8 ? '7.1' : defaultAudio.Channels >= 6 ? '5.1' : '2.0'
  if (ms.Size) traits.sizeBytes = ms.Size
  const langs = [...new Set(audioStreams.map((a) => a.Language).filter((l): l is string => !!l).map(languageName))]
  if (langs.length) traits.languages = langs
  traits.isCached = undefined

  const container = (ms.Container ?? '').split(',')[0]!.trim().toLowerCase() || undefined
  const videoOK = !traits.videoCodec || caps.video(traits.videoCodec)
  // Servers that report no MediaStreams (Trellis) leave this open on purpose: buildSource judges the
  // audio the name spells out, and a direct link they can't transcode is better than a dead HLS one.
  const audioOK = audioNames.length === 0 || audioNames.some((a) => caps.audio(a))
  const directOK = config.kind === 'emby' || ms.SupportsDirectPlay !== false || ms.SupportsDirectStream !== false
  const browserContainer = container === 'mp4' || container === 'm4v' || container === 'mov' || container === 'webm'
  const remuxable = (container === 'mkv' || container === 'matroska') && caps.mse

  let url: string
  let transcoded = false
  let urlContainer = container === 'matroska' ? 'mkv' : container
  const remote = remoteURL(ms)
  if (remote) {
    url = remote
    urlContainer = undefined
  } else if (directOK && videoOK && audioOK && (browserContainer || remuxable)) {
    url = streamURL(config, config.kind === 'emby' ? `Videos/${itemId}/stream.${urlContainer}` : `Videos/${itemId}/stream`, { static: 'true', MediaSourceId: ms.Id })
  } else {
    // The server's HLS, asking only for codecs this browser decodes; it copies streams that already fit.
    transcoded = true
    urlContainer = 'm3u8'
    const video = ['h264', caps.video('HEVC') ? 'hevc' : '', caps.video('AV1') ? 'av1' : ''].filter(Boolean).join(',')
    const audio = ['aac', caps.audio('DD') ? 'ac3' : '', caps.audio('DD+') ? 'eac3' : '', caps.audio('FLAC') ? 'flac' : ''].filter(Boolean).join(',')
    url = streamURL(config, `Videos/${itemId}/master.m3u8`, {
      MediaSourceId: ms.Id,
      DeviceId: deviceId(),
      PlaySessionId: playSessionId(),
      VideoCodec: video,
      AudioCodec: audio,
      TranscodingContainer: 'mp4',
      SegmentContainer: 'mp4',
      BreakOnNonKeyFrames: 'true',
      MaxStreamingBitrate: '140000000',
      AllowVideoStreamCopy: 'true',
      AllowAudioStreamCopy: 'true',
    })
  }

  return buildSource(
    {
      id: `${config.id}#${itemId}#${ms.Id}`,
      origin: config.kind === 'emby' ? 'emby' : 'jellyfin',
      provider: config.name,
      providerId: config.id,
      title: filename ?? name?.split('\n')[0] ?? config.name,
      url,
      filename,
      container: urlContainer,
      transcoded,
      detail: [name, video?.DisplayTitle, defaultAudio?.DisplayTitle].filter(Boolean).join('\n') || undefined,
      traits,
      bingeGroup: `${config.id}-${index}`,
      serverPosition: resume > 0 ? resume : undefined,
      subtitles: subtitles(config, itemId, ms),
    },
    caps,
  )
}

/** Text subtitles, converted to WebVTT by the server. Picture subtitles (PGS) can't be. */
function subtitles(config: ServerConfig, itemId: string, ms: MediaSourceDTO): ExternalSubtitle[] | undefined {
  const out = (ms.MediaStreams ?? [])
    .filter((s) => s.Type === 'Subtitle' && s.IsTextSubtitleStream && s.Index !== undefined)
    .map((s) => ({
      url: `${config.url}/Videos/${itemId}/${ms.Id}/Subtitles/${s.Index}/0/Stream.vtt?api_key=${encodeURIComponent(config.token)}`,
      language: s.Language,
      label: s.DisplayTitle ?? (s.Language ? languageName(s.Language) : 'Subtitles'),
      format: 'vtt' as const,
    }))
  return out.length ? out : undefined
}

function streamURL(config: ServerConfig, path: string, query: Record<string, string>): string {
  const params = new URLSearchParams(Object.entries(query).sort(([a], [b]) => a.localeCompare(b)))
  params.set('api_key', config.token)
  return `${config.url}/${path}?${params}`
}

const playSessionId = () => uuid().replace(/-/g, '')

let names: Intl.DisplayNames | undefined
function languageName(code: string): string {
  try {
    names ??= new Intl.DisplayNames(['en'], { type: 'language' })
    // Servers report ISO 639-2 ("eng"); Intl knows most of those too.
    return names.of(code) ?? code
  } catch {
    return code
  }
}
