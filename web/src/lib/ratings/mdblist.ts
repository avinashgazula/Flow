import { hostOf } from '../sources/http'
import type { MediaType } from '../tmdb/types'
import type { Ratings } from './sources'

/* MDBList's aggregated scores for a title, as FlowKit's MDBListClient and CatalogService.ratings: IMDb, Rotten
   Tomatoes, Popcornmeter, Metacritic, TMDB, Letterboxd and Trakt, asked for by TMDB id with the viewer's own key.
   api.mdblist.com sends `Access-Control-Allow-Origin: *`, so the page asks it directly; the key goes in the address as
   MDBList documents, and no error ever repeats the address. */

const base = 'https://api.mdblist.com'

/** The words for a failed MDBList call, fit to show as they are. */
export class RatingsError extends Error {}

type Json = Record<string, unknown>
const isObject = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v)
const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined)

/** MDBList's `ratings` list as scores. Each entry carries a `value` on the site's own scale and sometimes a 0-100
 *  `score`; a whole-number source takes the value (truncated, as the apps do) or else the score. */
export function parseRatings(json: unknown): Ratings {
  const out: Ratings = {}
  const list = isObject(json) && Array.isArray(json.ratings) ? json.ratings : []
  for (const entry of list) {
    if (!isObject(entry)) continue
    const value = num(entry.value)
    const score = num(entry.score)
    if (value === undefined && score === undefined) continue
    const whole = value !== undefined ? Math.trunc(value) : score
    switch (entry.source) {
      case 'imdb':
        if (value !== undefined) out.imdb = value
        out.imdbVotes = num(entry.votes)
        break
      case 'tomatoes':
        out.tomatometer = whole
        break
      case 'popcorn':
      case 'tomatoesaudience':
      case 'audience':
        out.popcornmeter = whole
        break
      case 'metacritic':
        out.metacritic = whole
        break
      case 'tmdb':
        if (value !== undefined) out.tmdb = value > 10 ? value / 10 : value
        break
      case 'letterboxd':
        if (value !== undefined) out.letterboxd = value
        break
      case 'trakt':
        out.trakt = whole
        break
    }
  }
  return out
}

/** `first` with whatever it lacks taken from `second`, as FlowKit's `Ratings.merged(with:)`. */
export function mergeRatings(first: Ratings, second: Ratings): Ratings {
  const out: Ratings = { ...second }
  for (const [k, v] of Object.entries(first)) if (v !== undefined) (out as Record<string, number>)[k] = v
  return out
}

export const hasRatings = (r: Ratings) => Object.values(r).some((v) => v !== undefined)

export interface FetchOptions {
  signal?: AbortSignal
  fetchImpl?: typeof fetch
}

async function get(path: string, key: string, { signal, fetchImpl = fetch }: FetchOptions): Promise<unknown> {
  let response: Response
  try {
    response = await fetchImpl(`${base}${path}${path.includes('?') ? '&' : '?'}apikey=${encodeURIComponent(key)}`, { signal, headers: { Accept: 'application/json' }, credentials: 'omit' })
  } catch (error) {
    if ((error as Error)?.name === 'AbortError') throw error
    throw new RatingsError(`Couldn’t reach ${hostOf(base)}. Check your connection and try again.`)
  }
  if (response.status === 401 || response.status === 403) throw new RatingsError('MDBList didn’t accept that API key. Copy it again from mdblist.com/preferences.')
  if (response.status === 429) throw new RatingsError('MDBList has no requests left today. Ratings come back tomorrow, or with a higher limit on mdblist.com.')
  if (response.status === 404) return null
  if (!response.ok) throw new RatingsError(`MDBList answered ${response.status}. Try again in a moment.`)
  return response.json().catch(() => null)
}

/** The scores MDBList has for a title; none when it doesn't know the title. */
export async function mdblistRatings(type: MediaType, tmdbID: number, key: string, options: FetchOptions = {}): Promise<Ratings> {
  return parseRatings(await get(`/tmdb/${type === 'movie' ? 'movie' : 'show'}/${tmdbID}`, key, options))
}

/** Asks MDBList about the account, the cheapest call that needs a valid key. */
export async function checkMDBListKey(key: string, options: FetchOptions = {}): Promise<{ ok: true } | { ok: false; error: string }> {
  const value = key.trim()
  if (!value) return { ok: false, error: 'Paste your MDBList API key.' }
  try {
    await get('/user', value, options)
    return { ok: true }
  } catch (error) {
    if ((error as Error)?.name === 'AbortError') return { ok: false, error: '' }
    return { ok: false, error: error instanceof RatingsError ? error.message : 'Couldn’t check the key. Try again.' }
  }
}

/** Trakt's community score as a percentage, for a title MDBList lacks it for. Public: the Client ID is all it takes. */
export async function traktRating(type: MediaType, id: string, clientID: string, options: FetchOptions = {}): Promise<number | undefined> {
  try {
    const response = await (options.fetchImpl ?? fetch)(`https://api.trakt.tv/${type === 'movie' ? 'movies' : 'shows'}/${encodeURIComponent(id)}/ratings`, {
      signal: options.signal,
      headers: { 'trakt-api-version': '2', 'trakt-api-key': clientID },
      credentials: 'omit',
    })
    if (!response.ok) return undefined
    const rating = num(((await response.json()) as Json | null)?.rating)
    return rating === undefined || rating <= 0 ? undefined : Math.round(rating * 10)
  } catch (error) {
    if ((error as Error)?.name === 'AbortError') throw error
    return undefined
  }
}
