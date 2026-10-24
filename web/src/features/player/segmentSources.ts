/* Where skip times come from, as FlowKit's SkipSegmentResolver: the server the file plays from (Jellyfin media
   segments, Plex markers), then IntroDB, then PublicMetaDB, the first to have an answer. Every lookup fails
   quietly: no answer means no button, never an error on the player. The chapter names a Matroska file carries
   are the last resort and are read in PlayerScreen, where the engine is.

   Browsers and these services. Checked against the live services (October 2026):
   - IntroDB answers GET api.introdb.app/segments?imdb_id=…&season=…&episode=… with no key needed to read, but
     its CORS header names only https://introdb.app, so a page anywhere else can't read the answer. Through the
     stream proxy (Settings → Playback) it can: the proxy adds the header, and api.introdb.app goes in its
     ALLOWED_HOSTS. Without a proxy the request is made once, and when the browser refuses it IntroDB isn't
     asked again until the page is reloaded.
   - PublicMetaDB answers GET publicmetadb.com/api/external/skips with a Bearer key, sends no CORS headers and
     doesn't answer the preflight a key header needs, and the stream proxy forwards no Authorization. So from a
     web page it can't be read today; it is asked once per visit and given up on quietly, and the key is kept so
     Flow Sync carries it to the apps. */

import type { PlaybackRequest, Source } from '../../lib/sources'
import { withTimeout } from '../../lib/sources/http'
import { proxied, streamProxy } from '../../lib/sources/proxy'
import type { ServerConfig } from '../../lib/store/settings'
import { mediaSegments, parseSegments, plexMarkers, type SkipSegment } from './segments'

export const introDBBase = 'https://api.introdb.app'
export const publicMetaDBBase = 'https://publicmetadb.com'

/** How long one service gets before the next is tried, as in the apps. */
export const lookupTimeoutMs = 8000

/** IntroDB's address for an episode or film, by IMDb id. Undefined when it can't be asked (no IMDb id, or an episode without numbers). */
export function introDBURL(request: PlaybackRequest, base = introDBBase): string | undefined {
  if (!request.imdbId) return undefined
  const query = new URLSearchParams({ imdb_id: request.imdbId })
  if (request.type === 'show') {
    if (request.season === undefined || request.episode === undefined) return undefined
    query.set('season', String(request.season))
    query.set('episode', String(request.episode))
  } else {
    query.set('is_movie', 'true')
  }
  return `${base}/segments?${query}`
}

/** PublicMetaDB's address for an episode or film, by TMDB id. */
export function publicMetaDBURL(request: PlaybackRequest, base = publicMetaDBBase): string | undefined {
  const query = new URLSearchParams({ tmdb_id: String(request.tmdbId), media_type: request.type === 'show' ? 'tv' : 'movie' })
  if (request.type === 'show') {
    if (request.season === undefined || request.episode === undefined) return undefined
    query.set('season', String(request.season))
    query.set('episode', String(request.episode))
  }
  return `${base}/api/external/skips?${query}`
}

/** Origins that refused this page in this visit (no CORS header), so they aren't asked again. */
const refused = new Set<string>()

/** For tests, and for a page that has just been given a proxy. */
export const forgetRefused = () => refused.clear()

/** One JSON answer, or undefined for anything else: a missing page, a refusal, a timeout. A request that
 *  fails before any answer (a browser refusing a page without the CORS header looks like that) marks the
 *  origin as refusing. */
async function fetchJSON(url: string, headers: Record<string, string>, signal: AbortSignal | undefined): Promise<unknown> {
  const origin = new URL(url).origin
  if (refused.has(origin)) return undefined
  const timeout = withTimeout(signal, lookupTimeoutMs)
  try {
    const response = await fetch(url, { headers, signal: timeout.signal })
    if (!response.ok) return undefined
    return JSON.parse(await response.text())
  } catch (error) {
    if (error instanceof TypeError && !timeout.timedOut() && !signal?.aborted) refused.add(origin)
    return undefined
  } finally {
    timeout.done()
  }
}

/** IntroDB's segments, through the stream proxy when there is one. */
export async function introDBSegments(request: PlaybackRequest, key: string, signal?: AbortSignal, template = streamProxy()): Promise<SkipSegment[]> {
  const url = introDBURL(request)
  if (!url) return []
  // Reading needs no key, and a key header would only make the browser ask permission first. It goes only where nothing is in between.
  const json = template.trim() ? await fetchJSON(proxied(url, template), {}, signal) : await fetchJSON(url, key ? { 'X-API-Key': key } : {}, signal)
  return parseSegments(json)
}

/** PublicMetaDB's segments. Asked directly: the proxy forwards no sign-in, which this needs. */
export async function publicMetaDBSegments(request: PlaybackRequest, key: string, signal?: AbortSignal): Promise<SkipSegment[]> {
  const url = publicMetaDBURL(request)
  if (!url || !key) return []
  return parseSegments(await fetchJSON(url, { Authorization: `Bearer ${key}` }, signal))
}

/** What the server a source plays from knows: Jellyfin's media segments or Plex's markers. Emby has neither. */
export async function serverSegments(source: Source, servers: readonly ServerConfig[], signal?: AbortSignal): Promise<SkipSegment[]> {
  if (source.origin !== 'jellyfin' && source.origin !== 'plex') return []
  const config = servers.find((x) => x.id === source.providerId)
  // Server source ids are `<server id>#<item id>#<media source id>`.
  const itemId = source.id.split('#')[1]
  if (!config || !itemId) return []
  const timeout = withTimeout(signal, lookupTimeoutMs)
  try {
    if (config.kind === 'plex') return plexMarkers(await (await import('../../lib/sources/plex')).markersFor(config, itemId, timeout.signal))
    return mediaSegments(await (await import('../../lib/sources/jellyfin')).mediaSegmentsFor(config, itemId, timeout.signal))
  } catch {
    return []
  } finally {
    timeout.done()
  }
}

export interface LookupOptions {
  source: Source | null
  request: PlaybackRequest
  servers: readonly ServerConfig[]
  introDBKey: string
  publicMetaDBKey: string
  signal?: AbortSignal
}

/** The first answer, as the apps pick it: the source's own server, then IntroDB, then PublicMetaDB. Each service
 *  is asked only if it has a key, so nothing is sent to a service the viewer hasn't set up. */
export async function lookupSegments({ source, request, servers, introDBKey, publicMetaDBKey, signal }: LookupOptions): Promise<SkipSegment[]> {
  const fromServer = source ? await serverSegments(source, servers, signal) : []
  if (fromServer.length) return fromServer
  if (introDBKey.trim()) {
    const found = await introDBSegments(request, introDBKey.trim(), signal).catch(() => [])
    if (found.length) return found
  }
  if (publicMetaDBKey.trim()) {
    const found = await publicMetaDBSegments(request, publicMetaDBKey.trim(), signal).catch(() => [])
    if (found.length) return found
  }
  return []
}
