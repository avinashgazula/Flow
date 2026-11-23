/* Simkl from the page, as FlowKit's SimklClient makes the calls: the sign-in (a PIN, or the OAuth 2.0 device flow
   for apps Simkl registered more recently), all-items sync for what is
   watched and planned, the resume points, history, ratings and scrobbles. api.simkl.com sends CORS headers (an
   `Access-Control-Allow-Origin: *`, and it answers a preflight for Authorization and the `simkl-api-key` header,
   errors included), so these go straight from the page; checked against the live service, November 2026.

   Titles are named by TMDB id. Simkl's all-items answers carry ids that are sometimes numbers and sometimes numeric
   text, so both are read. `fetch` is a parameter so the tests can stand in for Simkl. */

import type { TraktToken } from '../store/settings'
import type { MediaType } from '../tmdb/types'
import { scrobbleBody, syncBody, type Entry, type Listed, type Resume, type Scrobble, type ShowWatched, type Target, type Watch } from '../trakt/client'
import { TrackerError, words, type Backend, type Pulled, type PullOptions } from './backend'

export const simklBase = 'https://api.simkl.com'
export const simklName = 'Simkl'
/** Where a person types the code. Simkl names it in the PIN answer too; this is the fallback. */
export const simklPinPage = 'https://simkl.com/pin'

const say = words(simklName)
const unexpected = 'Simkl answered something Marquee didn’t expect. Try again in a moment.'

export interface SimklAuth {
  clientID(): string
  /** The token for a request; null when nobody is signed in. May be async so the caller can refresh an expired one first. */
  accessToken(): string | null | Promise<string | null>
}

/** What Marquee asks to do: read the lists and history, and write watches, ratings and list changes back. */
export const simklScope = 'media:read media:write'

/** The device flow's grant type, as RFC 8628 names it. */
const deviceGrant = 'urn:ietf:params:oauth:grant-type:device_code'

const clientIDWords = 'Simkl didn’t accept this app’s Client ID. Check it in Settings → Account.'

/** What a sign-in hands back. The apps' token shape, so it is stored as it is. */
export type SimklToken = TraktToken

/** One poll of a sign-in: the token once approved, otherwise still waiting (`slowDown` when Simkl asked for more time). */
export interface PinPoll {
  token?: SimklToken
  slowDown?: boolean
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

/** Simkl tells an OAuth 2.0 app to use the device flow instead of the PIN by answering /oauth/pin with a 400. */
function wantsDeviceFlow(body: unknown): boolean {
  if (!obj(body)) return false
  return body.error === 'unauthorized_client' || (typeof body.message === 'string' && body.message.includes('/oauth2/device'))
}

/** A token answer, read defensively: only the access token is certain. `expires_in` may be a number or numeric text. */
function readTokenAnswer(body: unknown, now: number, keep?: string): SimklToken | undefined {
  if (!obj(body) || typeof body.access_token !== 'string' || !body.access_token) return undefined
  const seconds = Number(body.expires_in)
  return {
    accessToken: body.access_token,
    refreshToken: typeof body.refresh_token === 'string' && body.refresh_token ? body.refresh_token : (keep ?? null),
    expiresAt: body.expires_in !== undefined && body.expires_in !== null && body.expires_in !== '' && Number.isFinite(seconds) && seconds > 0 ? new Date(now + seconds * 1000).toISOString() : null,
    redirectURI: null,
  }
}

export function createSimklClient(auth: SimklAuth, fetcher: typeof fetch, now: () => number = Date.now) {
  /** Makes the call and hands back whatever Simkl answered; only a failure to reach it is an error here. */
  async function send(method: string, path: string, options: RequestOptions = {}): Promise<Response> {
    const clientID = auth.clientID()
    if (!clientID) throw new TrackerError('Add a Simkl Client ID in Settings → Account first.', 'client-id')
    const token = options.anonymous ? null : await auth.accessToken()
    if (!options.anonymous && !token) throw new TrackerError(say.signedOut, 'signed-out')
    // The Client ID goes in the address as well as the header, as the apps send it: the PIN calls need it there.
    const query = new URLSearchParams({ client_id: clientID })
    for (const [k, v] of Object.entries(options.query ?? {})) if (v !== undefined) query.set(k, String(v))
    // Content-Type only on a body: a plain GET then needs no preflight for it.
    const headers: Record<string, string> = { 'simkl-api-key': clientID }
    if (token) headers.Authorization = `Bearer ${token}`
    if (options.body !== undefined) headers['Content-Type'] = 'application/json'
    try {
      return await fetcher(`${simklBase}${path}?${query}`, { method, headers, body: options.body === undefined ? undefined : JSON.stringify(options.body), keepalive: options.keepalive, cache: 'no-store' })
    } catch {
      throw new TrackerError(say.network, 'network')
    }
  }

  function fail(status: number): TrackerError {
    if (status === 412) return new TrackerError(clientIDWords, 'client-id', 412)
    if (status === 401 || status === 403) return new TrackerError(say.signedOut, 'signed-out', status)
    if (status === 429) return new TrackerError(say.rate, 'rate', 429)
    if (status >= 500) return new TrackerError(say.server(status), 'server', status)
    return new TrackerError(say.rejected(status), 'rejected', status)
  }

  const readBody = (res: Response): Promise<unknown> => res.json().catch(() => null)

  async function request(method: string, path: string, options: RequestOptions = {}): Promise<unknown> {
    const res = await send(method, path, options)
    if (!res.ok) throw fail(res.status)
    // An empty list comes back as `null`, or as nothing at all.
    return res.status === 204 ? null : await res.json().catch(() => null)
  }

  /** The device flow's start (RFC 8628): a code to type, and the device code that polling is done with. */
  async function startDevice() {
    // Without a scope Simkl grants reading only, and every watch, rating and list change sent back is refused.
    const res = await send('POST', '/oauth2/device', { anonymous: true, body: { client_id: auth.clientID(), scope: simklScope } })
    // Here a refusal can only be about the app, since nobody is signed in yet.
    if (!res.ok) throw res.status >= 500 || res.status === 429 ? fail(res.status) : new TrackerError(clientIDWords, 'client-id', res.status)
    const b = (await readBody(res)) as Json
    const code = obj(b) && typeof b.user_code === 'string' ? b.user_code : ''
    const deviceCode = obj(b) && typeof b.device_code === 'string' ? b.device_code : ''
    if (!code || !deviceCode) throw new TrackerError(unexpected, 'server')
    const https = (v: unknown) => (typeof v === 'string' && v.startsWith('https://') ? v : undefined)
    return {
      code,
      deviceCode,
      // The address with the code in it, when Simkl gives one, so the page can open with it filled in.
      url: https(b.verification_uri_complete) ?? https(b.verification_uri) ?? simklPinPage,
      expiresIn: typeof b.expires_in === 'number' ? b.expires_in : 900,
      interval: typeof b.interval === 'number' && b.interval >= 1 ? b.interval : 5,
    }
  }

  const post = async (path: string, body: unknown): Promise<void> => void (await request('POST', path, { body }))
  const list = (type: 'movies' | 'shows', status: 'plantowatch' | 'completed', query?: RequestOptions['query']) => request('GET', `/sync/all-items/${type}/${status}`, { query })

  return {
    request,

    /** Asks Simkl for a code to type at simkl.com/pin. Needs only the Client ID, so it also checks the ID. Tries the PIN
     *  flow first; an OAuth 2.0 app is turned away from it with a 400, and then the device flow gives the code. That one
     *  also has a device code to poll with, which `deviceCode` carries (a PIN has none). */
    async startPin(): Promise<{ code: string; url: string; expiresIn: number; interval: number; deviceCode?: string }> {
      const res = await send('GET', '/oauth/pin', { anonymous: true })
      if (!res.ok) {
        if (res.status === 400 && wantsDeviceFlow(await readBody(res))) return startDevice()
        throw fail(res.status)
      }
      const body = await readBody(res)
      const code = obj(body) && typeof body.user_code === 'string' ? body.user_code : ''
      if (!code) throw new TrackerError(unexpected, 'server')
      const b = body as Json
      return {
        code,
        url: typeof b.verification_url === 'string' && b.verification_url.startsWith('https://') ? b.verification_url : simklPinPage,
        expiresIn: typeof b.expires_in === 'number' ? b.expires_in : 900,
        interval: typeof b.interval === 'number' && b.interval >= 1 ? b.interval : 5,
      }
    },

    /** One look at whether the code has been approved. Pass the `deviceCode` from startPin when it had one. */
    async pollPin(code: string, deviceCode?: string): Promise<PinPoll> {
      if (!deviceCode) {
        const body = await request('GET', `/oauth/pin/${encodeURIComponent(code)}`, { anonymous: true })
        return obj(body) && body.result === 'OK' && typeof body.access_token === 'string' && body.access_token ? { token: { accessToken: body.access_token, refreshToken: null, expiresAt: null, redirectURI: null } } : {}
      }
      const res = await send('POST', '/oauth2/token', { anonymous: true, body: { client_id: auth.clientID(), device_code: deviceCode, grant_type: deviceGrant } })
      const body = await readBody(res)
      if (res.ok) {
        const token = readTokenAnswer(body, now())
        if (token) return { token }
        throw new TrackerError(unexpected, 'server')
      }
      const error = obj(body) ? body.error : undefined
      if (error === 'authorization_pending') return {}
      if (error === 'slow_down') return { slowDown: true }
      if (error === 'expired_token') throw new TrackerError('That code expired before it was approved. Start again from Settings → Account.', 'rejected', res.status)
      if (error === 'access_denied') throw new TrackerError('The sign-in was declined on Simkl. Start again from Settings → Account if you want to sign in.', 'rejected', res.status)
      throw fail(res.status)
    },

    /** A new token from the refresh token. Simkl turning it down (400 or 401) means the sign-in has ended. */
    async refresh(refreshToken: string): Promise<SimklToken> {
      const res = await send('POST', '/oauth2/token', { anonymous: true, body: { client_id: auth.clientID(), grant_type: 'refresh_token', refresh_token: refreshToken } })
      if (res.status === 400 || res.status === 401) throw new TrackerError(say.signedOut, 'signed-out', res.status)
      if (!res.ok) throw fail(res.status)
      const token = readTokenAnswer(await readBody(res), now(), refreshToken)
      if (!token) throw new TrackerError(unexpected, 'server')
      return token
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
    async pull({ full, limit, track = true, watchlist: lists = true }: PullOptions): Promise<Pulled> {
      // The watched lists are the costly part (every show with every episode), so they come only on a full pull.
      const [watchlist, resumes, watched] = await Promise.all([lists ? client.watchlist() : [], track ? client.playback() : [], track && full ? client.watched(limit) : Promise.resolve(undefined)])
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
