import { hostOf } from '../sources/http'

/* TheTVDB v4, as FlowKit's TVDBClient: log in with the project key (a POST), then read a series' episodes in the
   default (aired) order, page by page. api4.thetvdb.com answers the page's requests with CORS headers for both the
   login POST and the Authorization header on the reads (checked in Chromium and Firefox), so nothing needs the stream
   proxy. The token lives in memory only; a refused one is replaced once by logging in again. */

const base = 'https://api4.thetvdb.com/v4'

export class TVDBError extends Error {
  constructor(
    message: string,
    readonly kind: 'key' | 'network' | 'server' = 'server',
  ) {
    super(message)
  }
}

export interface FetchOptions {
  signal?: AbortSignal
  fetchImpl?: typeof fetch
}

/** One episode as TVDB lists it. */
export interface TVDBEpisode {
  id: number
  seasonNumber?: number | null
  number?: number | null
  absoluteNumber?: number | null
  name?: string | null
  overview?: string | null
  aired?: string | null
  runtime?: number | null
  image?: string | null
}

let session: { key: string; token: string } | undefined

const words = {
  key: 'TVDB didn’t accept that API key. Copy the project key again from thetvdb.com/dashboard.',
  network: `Couldn’t reach ${hostOf(base)}. Check your connection and try again.`,
}

async function send(path: string, init: RequestInit, { signal, fetchImpl = fetch }: FetchOptions): Promise<Response> {
  try {
    return await fetchImpl(`${base}${path}`, { ...init, signal, credentials: 'omit' })
  } catch (error) {
    if ((error as Error)?.name === 'AbortError') throw error
    throw new TVDBError(words.network, 'network')
  }
}

async function login(key: string, options: FetchOptions): Promise<string> {
  const response = await send('/login', { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify({ apikey: key }) }, options)
  if (response.status === 401 || response.status === 403) throw new TVDBError(words.key, 'key')
  if (!response.ok) throw new TVDBError(`TVDB answered ${response.status}. Try again in a moment.`)
  const token = ((await response.json().catch(() => null)) as { data?: { token?: unknown } } | null)?.data?.token
  if (typeof token !== 'string' || !token) throw new TVDBError('TVDB answered without a token. Try again in a moment.')
  session = { key, token }
  return token
}

async function get(path: string, key: string, options: FetchOptions): Promise<unknown> {
  for (const fresh of [false, true]) {
    const token = !fresh && session?.key === key ? session.token : await login(key, options)
    const response = await send(path, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } }, options)
    if (response.status === 401 && !fresh) {
      session = undefined
      continue
    }
    if (response.status === 401) throw new TVDBError(words.key, 'key')
    if (response.status === 404) return null
    if (!response.ok) throw new TVDBError(`TVDB answered ${response.status}. Try again in a moment.`)
    return response.json().catch(() => null)
  }
  return null
}

/** Every episode of a series in TVDB's default order. `language` is a three-letter TVDB code ("eng"). The paging is
 *  bounded: no series has fifty pages of episodes. */
export async function tvdbEpisodes(seriesID: number, key: string, language = 'eng', options: FetchOptions = {}): Promise<TVDBEpisode[]> {
  const all: TVDBEpisode[] = []
  for (let page = 0; page < 50; page++) {
    const body = (await get(`/series/${seriesID}/episodes/default/${language}?page=${page}`, key, options)) as { data?: { episodes?: TVDBEpisode[] }; links?: { next?: unknown } } | null
    const episodes = body?.data?.episodes ?? []
    all.push(...episodes)
    if (!body?.links?.next || episodes.length === 0) break
  }
  return all
}

/** Logs in, the cheapest call that needs a valid key. */
export async function checkTVDBKey(key: string, options: FetchOptions = {}): Promise<{ ok: true } | { ok: false; error: string }> {
  const value = key.trim()
  if (!value) return { ok: false, error: 'Paste your TVDB API key.' }
  try {
    await login(value, options)
    return { ok: true }
  } catch (error) {
    if ((error as Error)?.name === 'AbortError') return { ok: false, error: '' }
    return { ok: false, error: error instanceof TVDBError ? error.message : 'Couldn’t check the key. Try again.' }
  }
}
