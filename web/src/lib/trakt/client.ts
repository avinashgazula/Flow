/* Trakt API v2 from the page: the calls Flow makes (profile, watchlist, history, watched episodes, playback
   progress, scrobbles, ratings), as FlowKit's TraktClient makes them. Titles are named by their TMDB id, which is
   all Trakt needs to find one. Responses are turned into small shapes here so nothing else reads Trakt's JSON.

   The token comes from `auth`, which refreshes it when it is due, so this file knows nothing of storage or
   Sync. `fetch` is a parameter so the tests can stand in for Trakt. */

import { cleanReview } from '../reviewText'
import type { MediaType, Review } from '../tmdb/types'
import { apiBase } from './oauth'

export interface TraktAuth {
  clientID(): string
  /** A token good for a request now, refreshed first when it is due. `force` after Trakt refused the last one.
   *  Null when nobody is signed in. */
  accessToken(force?: boolean): Promise<string | null>
}

export type TraktErrorKind = 'client-id' | 'signed-out' | 'rate' | 'server' | 'network' | 'rejected'

/** A failure with a sentence fit to show as it is. */
export class TraktError extends Error {
  constructor(
    message: string,
    readonly kind: TraktErrorKind,
    readonly status?: number,
  ) {
    super(message)
  }
}

export const words = {
  clientID: 'Trakt didn’t accept this app’s client ID. Check it in Settings → Account.',
  signedOut: 'Trakt ended this sign-in. Sign in again.',
  rate: 'Trakt is busy. Flow will try again in a moment.',
  network: 'Couldn’t reach Trakt. Check your connection.',
  missingID: 'Add a Trakt Client ID in Settings → Account to sign in.',
}

const serverWords = (status: number) => `Trakt had a problem (${status}). Flow will try again in a moment.`

// MARK: Shapes

export interface Listed {
  type: MediaType
  tmdb: number
  title: string
  year?: number
  at: number
}
export interface Watch extends Listed {
  season?: number
  episode?: number
}
export interface Resume extends Watch {
  id: number
  percent: number
  episodeTitle?: string
  runtimeMinutes?: number
}
export interface ShowWatched {
  tmdb: number
  title: string
  year?: number
  episodes: { season: number; episode: number; at: number }[]
}
export type Scrobble = 'start' | 'pause' | 'stop'
export interface Target {
  type: MediaType
  id: number
  season?: number
  episode?: number
}
export interface Entry extends Target {
  /** ISO 8601, for history. */
  at?: string
  rating?: number
}

// MARK: Request bodies

const ids = (id: number) => ({ tmdb: id })

/** The body Trakt's sync endpoints take: movies, and shows with the seasons and episodes named. Entries
 *  without an episode are the show as a whole. */
export function syncBody(entries: Entry[]): { movies?: unknown[]; shows?: unknown[] } {
  const movies: unknown[] = []
  const wholeShows: unknown[] = []
  const bySeason = new Map<number, Map<number, Map<number, string | undefined>>>()
  for (const e of entries) {
    const extra = (e.at ? { watched_at: e.at } : {}) as Record<string, unknown>
    const rating = e.rating === undefined ? {} : { rating: e.rating }
    if (e.type === 'movie') movies.push({ ids: ids(e.id), ...extra, ...rating })
    else if (e.season === undefined || e.episode === undefined) wholeShows.push({ ids: ids(e.id), ...extra, ...rating })
    else {
      const seasons = bySeason.get(e.id) ?? new Map<number, Map<number, string | undefined>>()
      const eps = seasons.get(e.season) ?? new Map<number, string | undefined>()
      eps.set(e.episode, e.at)
      seasons.set(e.season, eps)
      bySeason.set(e.id, seasons)
    }
  }
  const shows = [
    ...wholeShows,
    ...[...bySeason].map(([id, seasons]) => ({
      ids: ids(id),
      seasons: [...seasons].sort((a, b) => a[0] - b[0]).map(([number, eps]) => ({ number, episodes: [...eps].sort((a, b) => a[0] - b[0]).map(([n, at]) => ({ number: n, ...(at ? { watched_at: at } : {}) })) })),
    })),
  ]
  return { ...(movies.length ? { movies } : {}), ...(shows.length ? { shows } : {}) }
}

/** The body of a scrobble: the movie, or the show and the episode, and how far in, as a percentage. */
export function scrobbleBody(target: Target, progress: number): Record<string, unknown> {
  const p = Math.min(100, Math.max(0, Math.round(progress * 100) / 100))
  return target.type === 'movie' || target.season === undefined || target.episode === undefined
    ? { movie: { ids: ids(target.id) }, progress: p }
    : { show: { ids: ids(target.id) }, episode: { season: target.season, number: target.episode }, progress: p }
}

// MARK: Reading responses

type Json = Record<string, any>
const obj = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v)
const at = (v: unknown) => {
  const t = typeof v === 'string' ? Date.parse(v) : NaN
  return Number.isFinite(t) ? t : Date.now()
}

/** The title an entry is about, if Trakt knows its TMDB id; entries without one can't be shown and are skipped. */
function media(row: Json): { type: MediaType; tmdb: number; title: string; year?: number } | undefined {
  const m = row.type === 'movie' ? row.movie : row.show
  if (!obj(m) || !obj(m.ids) || typeof m.ids.tmdb !== 'number') return undefined
  return { type: row.type === 'movie' ? 'movie' : 'show', tmdb: m.ids.tmdb, title: typeof m.title === 'string' ? m.title : '', ...(typeof m.year === 'number' ? { year: m.year } : {}) }
}

const rows = (v: unknown): Json[] => (Array.isArray(v) ? v.filter(obj) : [])

export function readWatchlist(body: unknown): Listed[] {
  return rows(body).flatMap((r) => {
    if (r.type !== 'movie' && r.type !== 'show') return []
    const m = media(r)
    return m ? [{ ...m, at: at(r.listed_at) }] : []
  })
}

export function readHistory(body: unknown): Watch[] {
  return rows(body).flatMap((r) => {
    const m = media(r)
    if (!m || (r.type !== 'movie' && r.type !== 'episode')) return []
    if (r.type === 'movie') return [{ ...m, at: at(r.watched_at) }]
    return obj(r.episode) && typeof r.episode.season === 'number' && typeof r.episode.number === 'number' ? [{ ...m, season: r.episode.season, episode: r.episode.number, at: at(r.watched_at) }] : []
  })
}

export function readWatchedShows(body: unknown): ShowWatched[] {
  return rows(body).flatMap((r) => {
    const m = media({ ...r, type: 'show' })
    if (!m) return []
    const episodes = rows(r.seasons).flatMap((s) =>
      typeof s.number === 'number' ? rows(s.episodes).filter((e) => typeof e.number === 'number').map((e) => ({ season: s.number as number, episode: e.number as number, at: at(e.last_watched_at ?? r.last_watched_at) })) : [],
    )
    return [{ tmdb: m.tmdb, title: m.title, ...(m.year ? { year: m.year } : {}), episodes }]
  })
}

export function readPlayback(body: unknown): Resume[] {
  return rows(body).flatMap((r) => {
    const m = media(r)
    if (!m || typeof r.id !== 'number' || typeof r.progress !== 'number') return []
    const base = { ...m, id: r.id, percent: r.progress, at: at(r.paused_at) }
    if (r.type === 'movie') return [{ ...base, ...(typeof r.movie?.runtime === 'number' ? { runtimeMinutes: r.movie.runtime } : {}) }]
    if (!obj(r.episode) || typeof r.episode.season !== 'number' || typeof r.episode.number !== 'number') return []
    return [{ ...base, season: r.episode.season, episode: r.episode.number, ...(typeof r.episode.title === 'string' ? { episodeTitle: r.episode.title } : {}), ...(typeof r.episode.runtime === 'number' ? { runtimeMinutes: r.episode.runtime } : {}) }]
  })
}

/** Trakt's most-liked comments as reviews, as FlowKit's `comments`. Anything without words is skipped. */
export function readComments(body: unknown): Review[] {
  return rows(body).flatMap((c) => {
    const text = cleanReview(typeof c.comment === 'string' ? c.comment : '')
    if (!text || typeof c.id !== 'number') return []
    const score = c.user_stats?.rating ?? c.user_rating
    const posted = Date.parse(typeof c.created_at === 'string' ? c.created_at : '')
    return [
      {
        id: `trakt:${c.id}`,
        source: 'trakt' as const,
        author: (typeof c.user?.username === 'string' && c.user.username) || 'Anonymous',
        text,
        ...(typeof score === 'number' ? { rating: Math.round(score) } : {}),
        ...(Number.isFinite(posted) ? { date: posted } : {}),
        spoiler: c.spoiler === true,
      },
    ]
  })
}

// MARK: The client

export interface RequestOptions {
  query?: Record<string, string | number | undefined>
  body?: unknown
  /** Public endpoints go without a sign-in. */
  anonymous?: boolean
  /** For a request sent as the page goes away, which the browser would otherwise cancel. */
  keepalive?: boolean
}

export function createClient(auth: TraktAuth, fetcher: typeof fetch) {
  async function send(method: string, path: string, options: RequestOptions, token: string | null): Promise<Response> {
    const clientID = auth.clientID()
    const headers: Record<string, string> = { 'trakt-api-version': '2', 'trakt-api-key': clientID }
    if (token) headers.Authorization = `Bearer ${token}`
    if (options.body !== undefined) headers['Content-Type'] = 'application/json'
    const query = Object.entries(options.query ?? {}).filter((e): e is [string, string | number] => e[1] !== undefined)
    const url = `${apiBase}${path}${query.length ? `?${new URLSearchParams(query.map(([k, v]) => [k, String(v)]))}` : ''}`
    try {
      return await fetcher(url, { method, headers, body: options.body === undefined ? undefined : JSON.stringify(options.body), keepalive: options.keepalive, cache: 'no-store' })
    } catch {
      throw new TraktError(words.network, 'network')
    }
  }

  /** One request, retried once with a freshly refreshed token if Trakt says the token is no good. */
  async function request(method: string, path: string, options: RequestOptions = {}): Promise<{ status: number; body: unknown }> {
    if (!auth.clientID()) throw new TraktError(words.missingID, 'client-id')
    let token: string | null = null
    if (!options.anonymous) {
      token = await auth.accessToken()
      if (!token) throw new TraktError(words.signedOut, 'signed-out')
    }
    let res = await send(method, path, options, token)
    if (res.status === 401 && token) {
      const again = await auth.accessToken(true)
      if (!again) throw new TraktError(words.signedOut, 'signed-out', 401)
      res = await send(method, path, options, again)
    }
    if (res.status === 401) throw new TraktError(words.signedOut, 'signed-out', 401)
    if (res.status === 403) throw new TraktError(words.clientID, 'client-id', 403)
    if (res.status === 429) throw new TraktError(words.rate, 'rate', 429)
    if (res.status >= 500) throw new TraktError(serverWords(res.status), 'server', res.status)
    // 409 on a scrobble means it was already recorded a moment ago, which is as good as success.
    if (!res.ok && res.status !== 409) throw new TraktError(`Trakt didn’t accept that update (${res.status}).`, 'rejected', res.status)
    return { status: res.status, body: res.status === 204 ? null : await res.json().catch(() => null) }
  }

  const post = async (path: string, body: unknown): Promise<void> => void (await request('POST', path, { body }))

  return {
    request,

    /** Whether Trakt accepts the Client ID, using a public list so no sign-in is needed. */
    async checkClientID(): Promise<void> {
      await request('GET', '/genres/movies', { anonymous: true })
    },

    async profile(): Promise<{ username: string; name?: string }> {
      const { body } = await request('GET', '/users/settings')
      const user = obj(body) && obj(body.user) ? body.user : {}
      if (typeof user.username !== 'string') throw new TraktError('Trakt answered something Flow didn’t expect. Try again in a moment.', 'server')
      return { username: user.username, ...(typeof user.name === 'string' && user.name ? { name: user.name } : {}) }
    },

    async watchlist(): Promise<Listed[]> {
      return readWatchlist((await request('GET', '/sync/watchlist')).body)
    },
    addToWatchlist: (entries: Entry[]) => post('/sync/watchlist', syncBody(entries)),
    removeFromWatchlist: (entries: Entry[]) => post('/sync/watchlist/remove', syncBody(entries)),

    /** The newest plays first. `startAt` (ISO 8601) asks only for those after it. */
    async history(limit: number, startAt?: string): Promise<Watch[]> {
      return readHistory((await request('GET', '/sync/history', { query: { limit, start_at: startAt } })).body)
    },
    addHistory: (entries: Entry[]) => post('/sync/history', syncBody(entries)),
    removeHistory: (entries: Entry[]) => post('/sync/history/remove', syncBody(entries)),

    async watchedShows(): Promise<ShowWatched[]> {
      return readWatchedShows((await request('GET', '/sync/watched/shows')).body)
    },

    /** Resume points, with runtimes so a percentage can become a position. */
    async playback(): Promise<Resume[]> {
      return readPlayback((await request('GET', '/sync/playback', { query: { limit: 100, extended: 'full' } })).body)
    },
    deletePlayback: async (id: number): Promise<void> => void (await request('DELETE', `/sync/playback/${id}`)),

    rate: (entries: Entry[]) => post('/sync/ratings', syncBody(entries)),
    unrate: (entries: Entry[]) => post('/sync/ratings/remove', syncBody(entries)),

    /** The most-liked comments, which are mostly reviews. Public, so no sign-in is needed, only the Client ID.
     *  `slug` is the IMDb id or Trakt's own, which is what Trakt's paths take. */
    async comments(type: MediaType, slug: string): Promise<Review[]> {
      const path = type === 'movie' ? 'movies' : 'shows'
      return readComments((await request('GET', `/${path}/${encodeURIComponent(slug)}/comments/likes`, { query: { limit: 10 }, anonymous: true })).body)
    },

    scrobble: async (action: Scrobble, target: Target, progress: number, keepalive = false): Promise<void> => void (await request('POST', `/scrobble/${action}`, { body: scrobbleBody(target, progress), keepalive })),
  }
}

export type TraktClient = ReturnType<typeof createClient>
