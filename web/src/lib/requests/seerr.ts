import { isMixedContent } from '../sources/http'
import type { MediaType } from '../tmdb/types'

/* Seerr, Overseerr and Jellyseerr share one v1 API, signed with the instance's API key, as FlowKit's SeerrClient.
   These calls go straight from the page to the viewer's own instance. The stream proxy can't stand in: it fetches
   with GET only and passes no headers on, and a request needs a POST with the key in X-Api-Key. So the instance has to
   allow web pages (CORS), and the words below say so when it doesn't.

   The address `https://demo.flow.invalid` answers from the sample catalogue instead, so the Request flow can be seen
   without an instance (the sample data has no servers, so every title is one to request). */

/** Where a title stands with Seerr, collapsed from its media and request states. */
export type RequestStatus = 'notRequested' | 'pending' | 'processing' | 'partiallyAvailable' | 'available'

/** A request would still change something: nothing has been asked for, or only some seasons arrived. */
export const canRequest = (status: RequestStatus) => status === 'notRequested' || status === 'partiallyAvailable'

/** The button's words, as the apps print them. */
export const statusWords: Record<RequestStatus, string> = {
  notRequested: 'Request',
  partiallyAvailable: 'Request',
  pending: 'Requested',
  processing: 'Processing',
  available: 'Available',
}

/** Which seasons of a show to ask for. */
export type SeerrSeasons = 'all' | number[]

export interface SeerrConfig {
  url: string
  key: string
}

export class SeerrError extends Error {
  constructor(
    message: string,
    readonly kind: 'network' | 'key' | 'missing' | 'rejected' | 'address' = 'rejected',
  ) {
    super(message)
  }
}

export const demoHost = 'demo.flow.invalid'

/** The instance's address as the API root, or why it can't be used. A bare host gets https://, a trailing slash or
 *  `/api/v1` is dropped (people paste the address of the page they were on). */
export function normaliseURL(input: string): { ok: true; url: string } | { ok: false; error: string } {
  let text = input.trim()
  if (!text) return { ok: false, error: 'Paste your Seerr address, like https://seerr.example.com.' }
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(text)) text = `https://${text}`
  let parsed: URL
  try {
    parsed = new URL(text)
  } catch {
    return { ok: false, error: 'That doesn’t look like a web address. Start it with https://.' }
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return { ok: false, error: 'Start the address with https:// (or http:// for a server on your own network).' }
  const path = parsed.pathname.replace(/\/+$/, '').replace(/\/api\/v1$/, '')
  return { ok: true, url: `${parsed.origin}${path}` }
}

/** Seerr's media status (1 unknown to 5 available) and its requests' (1 pending, 2 approved, 3 declined), as FlowKit
 *  collapses them. */
export function statusFrom(code: number | undefined, requestCodes: number[]): RequestStatus {
  switch (code) {
    case 5:
      return 'available'
    case 4:
      return 'partiallyAvailable'
    case 3:
      return 'processing'
    case 2:
      return 'pending'
    default:
      // A request can exist before the media row catches up; declined ones don't count.
      if (requestCodes.includes(2)) return 'processing'
      if (requestCodes.includes(1)) return 'pending'
      return 'notRequested'
  }
}

/** The body of a request. Films ignore `seasons`; a series asks for every season unless some are named. */
export function requestBody(type: MediaType, tmdbID: number, seasons: SeerrSeasons = 'all'): Record<string, unknown> {
  return { mediaType: type === 'movie' ? 'movie' : 'tv', mediaId: tmdbID, ...(type === 'show' ? { seasons } : {}) }
}

/** The season to offer as "Latest Season": the highest regular season, and only when there is more than one. */
export function latestSeason(seasons: { number: number }[]): number | undefined {
  const regular = seasons.filter((s) => s.number > 0).map((s) => s.number)
  return regular.length > 1 ? Math.max(...regular) : undefined
}

type Json = Record<string, unknown>
const isObject = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v)

/** Requests made to the sample instance, so asking for a title changes its status for the rest of the session. */
const demoRequested = new Set<string>()

/** The sample instance: a title's status follows its TMDB id (available, nothing, requested, processing, nothing). */
function demoCall(method: string, path: string, body: unknown): unknown {
  if (method === 'POST') {
    const b = isObject(body) ? body : {}
    demoRequested.add(`${b.mediaType}/${b.mediaId}`)
    return {}
  }
  if (path === 'status') return { version: 'demo' }
  if (path === 'auth/me') return { id: 1 }
  const id = Number(path.split('/')[1])
  if (demoRequested.has(path)) return { mediaInfo: { status: 2 } }
  const code = [5, undefined, 2, 3, undefined][id % 5]
  return code === undefined ? {} : { mediaInfo: { status: code } }
}

export interface CallOptions {
  signal?: AbortSignal
  fetchImpl?: typeof fetch
}

async function call(config: SeerrConfig, method: 'GET' | 'POST', path: string, body: unknown, { signal, fetchImpl = fetch }: CallOptions): Promise<unknown> {
  const root = normaliseURL(config.url)
  if (!root.ok) throw new SeerrError(root.error, 'address')
  const host = new URL(root.url).host
  if (host === demoHost) return demoCall(method, path, body)
  if (isMixedContent(root.url)) throw new SeerrError(`This page is on HTTPS and ${host} is http://, so the browser blocks the request. Use an https:// address for it, or open Flow from an http:// address on your own network.`, 'address')
  let response: Response
  try {
    response = await fetchImpl(`${root.url}/api/v1/${path}`, {
      method,
      signal,
      headers: { 'X-Api-Key': config.key.trim(), Accept: 'application/json', ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
      body: body === undefined ? undefined : JSON.stringify(body),
      credentials: 'omit',
    })
  } catch (error) {
    if ((error as Error)?.name === 'AbortError') throw error
    // A refused CORS check and an instance that is down look the same to a page.
    throw new SeerrError(`Flow couldn’t reach ${host}. Check the address, and that it lets web pages talk to it: Seerr sends no CORS headers itself, so put it behind a reverse proxy that adds them for this site.`, 'network')
  }
  if (response.status === 401 || response.status === 403) throw new SeerrError('Seerr rejected that API key. Copy it again from Seerr under Settings, General.', 'key')
  if (response.status === 404) throw new SeerrError(`${host} answered, but it isn’t a Seerr instance. Check the address.`, 'missing')
  if (!response.ok) {
    const detail = await response.json().then((j: unknown) => (isObject(j) && typeof j.message === 'string' ? j.message : ''), () => '')
    throw new SeerrError(detail ? `Seerr said: ${detail}` : `Seerr answered ${response.status}. Try again in a moment.`)
  }
  return response.status === 204 ? null : response.json().catch(() => null)
}

/** Proves the address is a Seerr instance and the key is one it accepts. `status` answers without a key, so a wrong key
 *  would pass it and only show up later as a Request button that never appears; the signed-in user is only returned
 *  for a key Seerr accepts. Returns the version. */
export async function connect(config: SeerrConfig, options: CallOptions = {}): Promise<string> {
  const status = await call(config, 'GET', 'status', undefined, options)
  await call(config, 'GET', 'auth/me', undefined, options)
  return isObject(status) && typeof status.version === 'string' ? status.version : ''
}

/** Seerr 404s titles TMDB doesn't know; there is nothing to request either, so that reads as not requested. */
export async function mediaStatus(config: SeerrConfig, type: MediaType, tmdbID: number, options: CallOptions = {}): Promise<RequestStatus> {
  const body = await call(config, 'GET', `${type === 'movie' ? 'movie' : 'tv'}/${tmdbID}`, undefined, options).catch((e) => {
    if (e instanceof SeerrError && e.kind === 'missing') return null
    throw e
  })
  const info = isObject(body) && isObject(body.mediaInfo) ? body.mediaInfo : undefined
  const requests = Array.isArray(info?.requests) ? info.requests.flatMap((r) => (isObject(r) && typeof r.status === 'number' ? [r.status] : [])) : []
  return statusFrom(typeof info?.status === 'number' ? info.status : undefined, requests)
}

export async function request(config: SeerrConfig, type: MediaType, tmdbID: number, seasons: SeerrSeasons = 'all', options: CallOptions = {}): Promise<void> {
  await call(config, 'POST', 'request', requestBody(type, tmdbID, seasons), options)
}
