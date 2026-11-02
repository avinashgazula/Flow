/* Simkl from the page, as FlowKit's SimklClient makes the calls: the PIN sign-in, all-items sync for what is
   watched and planned, the resume points, history, ratings and scrobbles. api.simkl.com sends CORS headers (an
   `Access-Control-Allow-Origin: *`, and it answers a preflight for Authorization and the `simkl-api-key` header,
   errors included), so these go straight from the page; checked against the live service, November 2026.

   Titles are named by TMDB id. Simkl's all-items answers carry ids that are sometimes numbers and sometimes numeric
   text, so both are read. `fetch` is a parameter so the tests can stand in for Simkl. */

import type { MediaType } from '../tmdb/types'
import { scrobbleBody, syncBody, type Entry, type Listed, type Resume, type Scrobble, type ShowWatched, type Target, type Watch } from '../trakt/client'
import { TrackerError, words, type Backend, type Pulled, type PullOptions } from './backend'

export const simklBase = 'https://api.simkl.com'
export const simklName = 'Simkl'
/** Where a person types the code. Simkl names it in the PIN answer too; this is the fallback. */
export const simklPinPage = 'https://simkl.com/pin'

const say = words(simklName)

export interface SimklAuth {
  clientID(): string
  /** The token for a request; null when nobody is signed in. */
  accessToken(): string | null
}

// MARK: Reading responses

type Json = Record<string, any>
const obj = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v)
const rows = (v: unknown): Json[] => (Array.isArray(v) ? v.filter(obj) : [])
const at = (v: unknown, fallback = Date.now()) => {
  const t = typeof v === 'string' ? Date.parse(v) : NaN
  return Number.isFinite(t) ? t : fallback
}

/** A TMDB id from Simkl's `ids`, which may be a number or text. */
export function tmdbOf(media: unknown): number | undefined {
  const raw = obj(media) && obj(media.ids) ? media.ids.tmdb : undefined
  const id = typeof raw === 'string' && raw.trim() ? Number(raw) : raw
  return typeof id === 'number' && Number.isInteger(id) && id > 0 ? id : undefined
}

function title(media: Json): { title: string; year?: number } {
  return { title: typeof media.title === 'string' ? media.title : '', ...(typeof media.year === 'number' ? { year: media.year } : {}) }
}

function named(media: unknown, type: MediaType): { type: MediaType; tmdb: number; title: string; year?: number } | undefined {
  const tmdb = tmdbOf(media)
  return tmdb === undefined ? undefined : { type, tmdb, ...title(media as Json) }
}

/** `/sync/all-items/{movies,shows}/plantowatch`: the watchlist. Titles without a TMDB id can't be shown and are skipped. */
export function readWatchlist(movies: unknown, shows: unknown): Listed[] {
  const list = (body: unknown, key: 'movies' | 'shows', type: MediaType, nested: 'movie' | 'show') =>
    rows(obj(body) ? body[key] : undefined).flatMap((r) => {
      const m = named(r[nested], type)
      return m ? [{ ...m, at: at(r.added_to_watchlist_at, 0) }] : []
    })
  return [...list(movies, 'movies', 'movie', 'movie'), ...list(shows, 'shows', 'show', 'show')]
}

/** What is watched: `/sync/all-items/movies/completed` and `/sync/all-items/shows?extended=full&episode_watched_at=yes`.
 *  Simkl has no flat history, so the plays are the films' last watch and every episode's own time (or the show's
 *  last watch when an episode has none), newest first, and the shows' watched episodes come from the same answer. */
export function readWatched(movies: unknown, shows: unknown, limit: number): { history: Watch[]; shows: ShowWatched[] } {
  const history: Watch[] = rows(obj(movies) ? movies.movies : undefined).flatMap((r) => {
    const m = named(r.movie, 'movie')
    return m ? [{ ...m, at: at(r.last_watched_at) }] : []
  })
  const watched: ShowWatched[] = []
  for (const r of rows(obj(shows) ? shows.shows : undefined)) {
    const m = named(r.show, 'show')
    if (!m) continue
    const episodes: ShowWatched['episodes'] = []
    for (const season of rows(r.seasons)) {
      if (typeof season.number !== 'number') continue
      for (const e of rows(season.episodes)) {
        if (typeof e.number !== 'number') continue
        const when = at(e.watched_at ?? r.last_watched_at)
        episodes.push({ season: season.number, episode: e.number, at: when })
        history.push({ ...m, season: season.number, episode: e.number, at: when })
      }
    }
    watched.push({ tmdb: m.tmdb, title: m.title, ...(m.year ? { year: m.year } : {}), episodes })
  }
  return { history: history.sort((a, b) => b.at - a.at).slice(0, limit), shows: watched }
}

/** `/sync/playback`: resume points. The id may be a number or text; one that isn't a number can't be removed here. */
export function readPlayback(body: unknown): Resume[] {
  return rows(body).flatMap((r) => {
    const isMovie = r.type === 'movie'
    const m = named(isMovie ? r.movie : r.show, isMovie ? 'movie' : 'show')
    const id = Number(r.id)
    if (!m || !Number.isFinite(id) || typeof r.progress !== 'number') return []
    const base = { ...m, id, percent: r.progress, at: at(r.paused_at) }
    if (isMovie) return [base]
    const e = r.episode
    const number = obj(e) ? (e.number ?? e.episode) : undefined
    return obj(e) && typeof e.season === 'number' && typeof number === 'number' ? [{ ...base, season: e.season, episode: number, ...(typeof e.title === 'string' ? { episodeTitle: e.title } : {}) }] : []
  })
}

// MARK: The client

export interface RequestOptions {
  query?: Record<string, string | number | undefined>
  body?: unknown
  /** The PIN calls go before there is a sign-in. */
  anonymous?: boolean
  keepalive?: boolean
}

export function createSimklClient(auth: SimklAuth, fetcher: typeof fetch) {
  async function request(method: string, path: string, options: RequestOptions = {}): Promise<unknown> {
    const clientID = auth.clientID()
    if (!clientID) throw new TrackerError('Add a Simkl Client ID in Settings → Account first.', 'client-id')
    const token = options.anonymous ? null : auth.accessToken()
    if (!options.anonymous && !token) throw new TrackerError(say.signedOut, 'signed-out')
    // The Client ID goes in the address as well as the header, as the apps send it: the PIN calls need it there.
    const query = new URLSearchParams({ client_id: clientID })
    for (const [k, v] of Object.entries(options.query ?? {})) if (v !== undefined) query.set(k, String(v))
    // Content-Type only on a body: a plain GET then needs no preflight for it.
    const headers: Record<string, string> = { 'simkl-api-key': clientID }
    if (token) headers.Authorization = `Bearer ${token}`
    if (options.body !== undefined) headers['Content-Type'] = 'application/json'
    let res: Response
    try {
      res = await fetcher(`${simklBase}${path}?${query}`, { method, headers, body: options.body === undefined ? undefined : JSON.stringify(options.body), keepalive: options.keepalive, cache: 'no-store' })
    } catch {
      throw new TrackerError(say.network, 'network')
    }
    if (res.status === 412) throw new TrackerError(`Simkl didn’t accept this app’s Client ID. Check it in Settings → Account.`, 'client-id', 412)
    if (res.status === 401 || res.status === 403) throw new TrackerError(say.signedOut, 'signed-out', res.status)
    if (res.status === 429) throw new TrackerError(say.rate, 'rate', 429)
    if (res.status >= 500) throw new TrackerError(say.server(res.status), 'server', res.status)
    if (!res.ok) throw new TrackerError(say.rejected(res.status), 'rejected', res.status)
    // An empty list comes back as `null`, or as nothing at all.
    return res.status === 204 ? null : await res.json().catch(() => null)
  }

  const post = async (path: string, body: unknown): Promise<void> => void (await request('POST', path, { body }))
  const list = (type: 'movies' | 'shows', status: 'plantowatch' | 'completed', query?: RequestOptions['query']) => request('GET', `/sync/all-items/${type}/${status}`, { query })

  return {
    request,

    /** Asks Simkl for a code to type at simkl.com/pin. Needs only the Client ID, so it also checks the ID. */
    async startPin(): Promise<{ code: string; url: string; expiresIn: number; interval: number }> {
      const body = await request('GET', '/oauth/pin', { anonymous: true })
      const code = obj(body) && typeof body.user_code === 'string' ? body.user_code : ''
      if (!code) throw new TrackerError('Simkl answered something Flow didn’t expect. Try again in a moment.', 'server')
      const b = body as Json
      return {
        code,
        url: typeof b.verification_url === 'string' && b.verification_url.startsWith('https://') ? b.verification_url : simklPinPage,
        expiresIn: typeof b.expires_in === 'number' ? b.expires_in : 900,
        interval: typeof b.interval === 'number' && b.interval >= 1 ? b.interval : 5,
      }
    },

    /** The token once the code has been approved; undefined while Simkl is still waiting. */
    async pollPin(code: string): Promise<string | undefined> {
      const body = await request('GET', `/oauth/pin/${encodeURIComponent(code)}`, { anonymous: true })
      return obj(body) && body.result === 'OK' && typeof body.access_token === 'string' && body.access_token ? body.access_token : undefined
    },

    async profile(): Promise<string | undefined> {
      const body = await request('GET', '/users/settings')
      const user = obj(body) && obj(body.user) ? body.user : {}
      return typeof user.name === 'string' && user.name ? user.name : undefined
    },

    async watchlist(): Promise<Listed[]> {
      const [movies, shows] = await Promise.all([list('movies', 'plantowatch'), list('shows', 'plantowatch')])
      return readWatchlist(movies, shows)
    },
    addToWatchlist: (entries: Entry[]) => post('/sync/add-to-list', toList(entries)),
    // Simkl has one call that takes a title off whatever list it is on.
    removeFromWatchlist: (entries: Entry[]) => post('/sync/history/remove', syncBody(entries)),

    async watched(limit: number): Promise<{ history: Watch[]; shows: ShowWatched[] }> {
      const [movies, shows] = await Promise.all([list('movies', 'completed'), request('GET', '/sync/all-items/shows', { query: { extended: 'full', episode_watched_at: 'yes' } })])
      return readWatched(movies, shows, limit)
    },
    addHistory: (entries: Entry[]) => post('/sync/history', syncBody(entries)),
    removeHistory: (entries: Entry[]) => post('/sync/history/remove', syncBody(entries)),

    async playback(): Promise<Resume[]> {
      return readPlayback(await request('GET', '/sync/playback'))
    },
    deletePlayback: async (id: number): Promise<void> => void (await request('DELETE', `/sync/playback/${id}`)),

    rate: (entries: Entry[]) => post('/sync/ratings', syncBody(entries)),
    unrate: (entries: Entry[]) => post('/sync/ratings/remove', syncBody(entries)),

    scrobble: async (action: Scrobble, target: Target, progress: number, keepalive = false): Promise<void> => void (await request('POST', `/scrobble/${action}`, { body: scrobbleBody(target, progress), keepalive })),
  }
}

/** The body of `/sync/add-to-list`: the same movies and shows, each with the list to put it on. */
export function toList(entries: Entry[]): Record<string, unknown> {
  const body = syncBody(entries)
  const to = (items: unknown[] | undefined) => items?.map((i) => ({ ...(i as object), to: 'plantowatch' }))
  return { ...(body.movies ? { movies: to(body.movies) } : {}), ...(body.shows ? { shows: to(body.shows) } : {}) }
}

export type SimklClient = ReturnType<typeof createSimklClient>

/** The client as the engine uses it. */
export function simklBackend(client: SimklClient, ready: () => boolean): Backend {
  return {
    kind: 'simkl',
    name: simklName,
    ready,
    async pull({ full, limit }: PullOptions): Promise<Pulled> {
      // The watched lists are the costly part (every show with every episode), so they come only on a full pull.
      const [watchlist, resumes, watched] = await Promise.all([client.watchlist(), client.playback(), full ? client.watched(limit) : Promise.resolve(undefined)])
      return { watchlist, resumes, history: watched?.history ?? [], ...(watched ? { shows: watched.shows } : {}) }
    },
    username: () => client.profile(),
    scrobble: client.scrobble,
    addToWatchlist: client.addToWatchlist,
    removeFromWatchlist: client.removeFromWatchlist,
    addHistory: client.addHistory,
    removeHistory: client.removeHistory,
    rate: client.rate,
    unrate: client.unrate,
    playback: client.playback,
    deletePlayback: client.deletePlayback,
  }
}
