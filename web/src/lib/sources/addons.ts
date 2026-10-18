/* Stremio add-ons, as FlowKit's AddonClient: a manifest.json, and /stream/{type}/{id}.json with an
   IMDb id ("tt0111161", or "tt0944947:1:2" for an episode). */

import type { AddonConfig } from '../store/settings'
import type { Capabilities } from './capabilities'
import { requestJSON, SourceError } from './http'
import { isUnsafeFileName, parseStream } from './parser'
import { buildSource, stableHash } from './rank'
import type { AddonManifest, ExternalSubtitle, PlaybackRequest, Source } from './types'

/** Accepts what people paste: stremio:// links from configure pages, and base URLs without
 *  /manifest.json. */
export function normaliseManifestURL(input: string): string {
  let url = input.trim()
  if (/^stremio:\/\//i.test(url)) url = `https://${url.slice('stremio://'.length)}`
  if (!/^https?:\/\//i.test(url)) url = `https://${url}`
  const parsed = new URL(url)
  if (!parsed.pathname.endsWith('.json')) parsed.pathname = `${parsed.pathname.replace(/\/+$/, '')}/manifest.json`
  return parsed.toString()
}

/** The URL resource paths hang off: the manifest URL without /manifest.json. */
export function addonBase(manifestURL: string): string {
  return manifestURL.replace(/\/manifest\.json(\?.*)?$/, '').replace(/\/+$/, '')
}

export const stremioType = (request: PlaybackRequest) => (request.type === 'movie' ? 'movie' : 'series')

/** "tt0111161" for a film, "tt0944947:1:2" for an episode. Add-ons that take TMDB ids get
 *  "tmdb:603" when there's no IMDb id. Undefined when the add-on can't be asked. */
export function stremioId(request: PlaybackRequest, manifest?: AddonManifest): string | undefined {
  const episode = request.type === 'show' ? (request.season !== undefined && request.episode !== undefined ? `:${request.season}:${request.episode}` : undefined) : ''
  if (episode === undefined) return undefined
  if (request.imdbId) return `${request.imdbId}${episode}`
  const prefixes = [...(manifest?.idPrefixes ?? []), ...(manifest?.resources ?? []).flatMap((r) => (typeof r === 'string' ? [] : (r.idPrefixes ?? [])))]
  if (prefixes.some((p) => p.startsWith('tmdb'))) return `tmdb:${request.tmdbId}${episode}`
  return undefined
}

/** Whether the add-on answers stream requests for this type and id. With no manifest saved, assume so. */
export function servesStreams(manifest: AddonManifest | undefined, type: string, id: string): boolean {
  if (!manifest) return true
  for (const resource of manifest.resources ?? []) {
    const name = typeof resource === 'string' ? resource : resource.name
    if (name !== 'stream') continue
    const types = (typeof resource === 'string' ? undefined : resource.types) ?? manifest.types
    const prefixes = (typeof resource === 'string' ? undefined : resource.idPrefixes) ?? manifest.idPrefixes
    const typeOK = types ? types.includes(type) : true
    const prefixOK = prefixes ? prefixes.some((p) => id.startsWith(p)) : true
    if (typeOK && prefixOK) return true
  }
  return false
}

/** Just the parts of a manifest Flow keeps: catalogues and configuration schemas can be large. */
export function slimManifest(raw: any): AddonManifest {
  if (!raw || typeof raw !== 'object' || typeof raw.id !== 'string') throw new SourceError('That isn’t a Stremio add-on manifest. Copy the manifest link from the add-on’s configure page.')
  const resources: AddonManifest['resources'] = (Array.isArray(raw.resources) ? raw.resources : [])
    .map((r: any) => (typeof r === 'string' ? r : r && typeof r.name === 'string' ? { name: r.name, types: arrayOfStrings(r.types), idPrefixes: arrayOfStrings(r.idPrefixes) } : undefined))
    .filter(Boolean)
  return {
    id: raw.id,
    name: typeof raw.name === 'string' && raw.name ? raw.name : raw.id,
    version: typeof raw.version === 'string' ? raw.version : undefined,
    description: typeof raw.description === 'string' ? raw.description.slice(0, 300) : undefined,
    logo: typeof raw.logo === 'string' && /^https:\/\//.test(raw.logo) ? raw.logo : undefined,
    types: arrayOfStrings(raw.types),
    idPrefixes: arrayOfStrings(raw.idPrefixes),
    resources,
  }
}

const arrayOfStrings = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : undefined)

export const providesStreams = (m: AddonManifest) => m.resources.some((r) => (typeof r === 'string' ? r : r.name) === 'stream')

export async function fetchManifest(input: string, signal?: AbortSignal): Promise<{ url: string; manifest: AddonManifest }> {
  const url = normaliseManifestURL(input)
  const manifest = slimManifest(await requestJSON(url, { signal, timeoutMs: 15_000 }))
  return { url, manifest }
}

// MARK: Streams

interface StreamDTO {
  name?: string
  title?: string
  description?: string
  url?: string
  ytId?: string
  infoHash?: string
  fileIdx?: number
  externalUrl?: string
  subtitles?: { url?: string; lang?: string; id?: string }[]
  behaviorHints?: {
    bingeGroup?: string
    filename?: string
    videoSize?: number | string
    notWebReady?: boolean
    proxyHeaders?: { request?: Record<string, string> }
  }
}

export interface AddonResult {
  sources: Source[]
  /** Torrent-only results: they need a debrid service to become links a browser can play. */
  torrents: number
}

/** Maps an add-on's stream list. Torrents without a link are counted, not listed; links to other
 *  apps (YouTube, external pages) and files that aren't video are dropped. */
export function mapStreams(streams: StreamDTO[] | undefined, addon: Pick<AddonConfig, 'url' | 'name'>, caps: Capabilities): AddonResult {
  const sources: Source[] = []
  let torrents = 0
  for (const dto of streams ?? []) {
    if (!dto || typeof dto !== 'object') continue
    if (!dto.url) {
      if (dto.infoHash) torrents++
      continue
    }
    if (!/^https?:\/\//i.test(dto.url)) continue
    const hints = dto.behaviorHints ?? {}
    const body = dto.description ?? dto.title ?? ''
    const filename = hints.filename?.trim() || undefined
    const lines = body.split('\n').map((l) => l.trim()).filter(Boolean)
    if ((filename && isUnsafeFileName(filename)) || lines.some(isUnsafeFileName) || isUnsafeFileName(dto.url.split(/[?#]/)[0]!)) continue
    const traits = parseStream(dto.name, body, filename)
    const size = Number(hints.videoSize)
    if (Number.isFinite(size) && size > 0) traits.sizeBytes = size
    const headers = hints.proxyHeaders?.request
    sources.push(
      buildSource(
        {
          id: `${stableHash(addon.url)}#${stableHash(dto.url)}`,
          origin: 'addon',
          provider: addon.name,
          providerId: addon.url,
          title: releaseName(filename, lines, dto.name),
          url: dto.url,
          headers,
          filename,
          detail: [dto.name, body].filter(Boolean).join('\n'),
          traits,
          bingeGroup: hints.bingeGroup,
          notWebReady: hints.notWebReady,
          subtitles: subtitles(dto.subtitles),
        },
        caps,
      ),
    )
  }
  return { sources, torrents }
}

/** The release's name: the file name when the add-on gives one, else the line that looks like one. */
function releaseName(filename: string | undefined, lines: string[], name?: string): string {
  if (filename) return filename
  const fileLike = lines.find((l) => /\.(mkv|mp4|m4v|webm|avi|mov)$/i.test(l) || (/^\S+$/.test(l) && (l.match(/\./g)?.length ?? 0) >= 3))
  return fileLike ?? lines[0] ?? name?.split('\n')[0]?.trim() ?? 'Stream'
}

function subtitles(list: StreamDTO['subtitles']): ExternalSubtitle[] | undefined {
  const out: ExternalSubtitle[] = []
  for (const s of list ?? []) {
    if (!s?.url || !/^https?:\/\//.test(s.url)) continue
    const ext = s.url.split(/[?#]/)[0]!.split('.').pop()?.toLowerCase()
    const format: ExternalSubtitle['format'] = ext === 'vtt' ? 'vtt' : ext === 'ass' || ext === 'ssa' ? 'ass' : 'srt'
    out.push({ url: s.url, language: s.lang, label: s.lang ?? s.id ?? 'Subtitles', format })
  }
  return out.length ? out : undefined
}

/** Everything one add-on offers for the request. */
export async function addonSources(addon: AddonConfig, request: PlaybackRequest, caps: Capabilities, signal?: AbortSignal): Promise<AddonResult> {
  const id = stremioId(request, addon.manifest)
  const type = stremioType(request)
  if (!id || !servesStreams(addon.manifest, type, id)) return { sources: [], torrents: 0 }
  const response = await requestJSON<{ streams?: StreamDTO[] }>(`${addonBase(addon.url)}/stream/${type}/${id}.json`, { signal })
  return mapStreams(response?.streams, addon, caps)
}

/** A short, shareable form of an add-on's address: its host. The full URL often holds a key. */
export function addonHost(url: string): string {
  try {
    return new URL(url).host
  } catch {
    return url
  }
}
