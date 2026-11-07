/* MDBList as a tracker, as FlowKit's KeyedSyncClient makes the calls: a Trakt-shaped sync API (`/sync/watched`,
   `/sync/playback`, `/sync/history`, `/watchlist/items`, `/scrobble/*`) behind a plain API key, which goes in the
   address as MDBList documents. The same code would serve PublicMetaDB, which the apps track with in the same way,
   but PublicMetaDB sends no CORS headers (see service.ts) and has no client here.

   Checked against api.mdblist.com in November 2026: every answer, errors included, carries
   `Access-Control-Allow-Origin: *`, so a request the browser doesn't preflight can be read. It refuses a preflight
   (OPTIONS answers 405 on every path), so:
   - a GET sends no custom header and no Content-Type, which makes it a simple request;
   - a POST goes as `text/plain` with the JSON as its body, which also makes it a simple request. Whether MDBList reads
     a JSON body sent that way couldn't be checked without a real key; a refusal says so in words (see `send`) and the
     reading side still works.

   Titles are named by TMDB id. `fetch` is a parameter so the tests can stand in for MDBList. */

import type { MediaType } from '../tmdb/types'
import { scrobbleBody, syncBody, type Entry, type Listed, type Resume, type Scrobble, type ShowWatched, type Target, type Watch } from '../trakt/client'
import { TrackerError, words, type Backend, type Pulled, type PullOptions } from './backend'

export const mdblistBase = 'https://api.mdblist.com'
export const mdblistName = 'MDBList'
const say = words(mdblistName)

// MARK: Reading responses

type Json = Record<string, any>
const obj = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v)
const rows = (v: unknown): Json[] => (Array.isArray(v) ? v.filter(obj) : [])
const at = (v: unknown, fallback = Date.now()) => {
  const t = typeof v === 'string' ? Date.parse(v) : NaN
  return Number.isFinite(t) ? t : fallback
}

/** A TMDB id in the shapes these APIs use: `{ids: {tmdb}}`, `{tmdb}`, `{tmdb_id}`, `{id}`. */
export function tmdbOf(value: unknown): number | undefined {
  if (!obj(value)) return undefined
  const raw = (obj(value.ids) ? value.ids.tmdb : undefined) ?? value.tmdb ?? value.tmdb_id ?? value.id
  const id = typeof raw === 'string' && raw.trim() ? Number(raw) : raw
  return typeof id === 'number' && Number.isInteger(id) && id > 0 ? id : undefined
}

function named(media: unknown, type: MediaType): { type: MediaType; tmdb: number; title: string; year?: number } | undefined {
  const tmdb = tmdbOf(media)
  if (tmdb === undefined) return undefined
  const m = media as Json
  return { type, tmdb, title: typeof m.title === 'string' ? m.title : '', ...(typeof m.year === 'number' ? { year: m.year } : {}) }
}

const isShowRow = (r: Json) => ['show', 'tv', 'series', 'episode'].includes(String(r.mediatype ?? r.type ?? ''))

/** `/watchlist/items`: a list of rows, or `{movies, shows}`. */
export function readWatchlist(body: unknown): Listed[] {
  const date = (r: Json) => at(r.watchlist_at ?? r.listed_at ?? r.added_at, 0)
  if (Array.isArray(body)) {
    return rows(body).flatMap((r) => {
      const show = isShowRow(r)
      const m = named(r[show ? 'show' : 'movie'] ?? r, show ? 'show' : 'movie')
      return m ? [{ ...m, at: date(r) }] : []
    })
  }
  const list = (key: 'movies' | 'shows', type: MediaType, nested: 'movie' | 'show') =>
    rows(obj(body) ? body[key] : undefined).flatMap((r) => {
      const m = named(r[nested] ?? r, type)
      return m ? [{ ...m, at: date(r) }] : []
    })
  return [...list('movies', 'movie', 'movie'), ...list('shows', 'show', 'show')]
}

/** `/sync/history`: the newest plays first. A row without a `type` is a film. */
export function readHistory(body: unknown): Watch[] {
  return rows(body).flatMap((r) => {
    const movie = (r.type ?? 'movie') === 'movie'
    const m = named(movie ? r.movie : (r.show ?? (obj(r.episode) ? r.episode.show : undefined)), movie ? 'movie' : 'show')
    if (!m) return []
    if (movie) return [{ ...m, at: at(r.watched_at) }]
    const e = r.episode
    return obj(e) && typeof e.season === 'number' && typeof e.number === 'number' ? [{ ...m, season: e.season, episode: e.number, at: at(r.watched_at) }] : []
  })
}

/** `/sync/watched`: films, shows with their seasons, or a flat list of episodes. Only the shows' episodes are used here:
 *  the films are plays in `/sync/history`. */
export function readWatchedShows(body: unknown): ShowWatched[] {
  const byShow = new Map<number, ShowWatched>()
  const show = (media: unknown, last?: unknown) => {
    const m = named(media, 'show')
    if (!m) return undefined
    const entry = byShow.get(m.tmdb) ?? { tmdb: m.tmdb, title: m.title, ...(m.year ? { year: m.year } : {}), episodes: [] }
    byShow.set(m.tmdb, entry)
    return { entry, when: at(last) }
  }
  const b = obj(body) ? body : {}
  for (const r of rows(b.shows)) {
    const s = show(r.show ?? r, r.last_watched_at)
    if (!s) continue
    for (const season of rows(r.seasons)) {
      if (typeof season.number !== 'number') continue
      for (const e of rows(season.episodes)) if (typeof e.number === 'number') s.entry.episodes.push({ season: season.number, episode: e.number, at: at(e.last_watched_at ?? e.watched_at ?? r.last_watched_at) })
    }
  }
  // The flat shape: one row per episode.
  for (const r of rows(b.episodes)) {
    const ep = obj(r.episode) ? r.episode : r
    const s = show(r.show ?? ep.show, r.watched_at ?? r.last_watched_at)
    const season = ep.season
    const number = ep.number
    if (s && typeof season === 'number' && typeof number === 'number') s.entry.episodes.push({ season, episode: number, at: s.when })
  }
  return [...byShow.values()]
}

/** `/sync/playback`: resume points. */
export function readPlayback(body: unknown): Resume[] {
  const list = Array.isArray(body) ? body : obj(body) && Array.isArray(body.playback) ? body.playback : []
  return rows(list).flatMap((r) => {
    const movie = (r.type ?? 'movie') === 'movie'
    const m = named(movie ? r.movie : (r.show ?? (obj(r.episode) ? r.episode.show : undefined)), movie ? 'movie' : 'show')
    const id = Number(r.id)
    if (!m || !Number.isFinite(id) || typeof r.progress !== 'number') return []
    const base = { ...m, id, percent: r.progress, at: at(r.paused_at) }
    if (movie) return [base]
    const e = r.episode
    return obj(e) && typeof e.season === 'number' && typeof e.number === 'number' ? [{ ...base, season: e.season, episode: e.number, ...(typeof e.title === 'string' ? { episodeTitle: e.title } : {}) }] : []
  })
}

// MARK: The client

export interface RequestOptions {
  query?: Record<string, string | number | undefined>
  body?: unknown
  keepalive?: boolean
}

export function createMDBListClient(apiKey: () => string, fetcher: typeof fetch) {
  async function request(method: string, path: string, options: RequestOptions = {}): Promise<unknown> {
    const key = apiKey().trim()
    if (!key) throw new TrackerError('Add an MDBList API key in Settings → Metadata first.', 'client-id')
    const query = new URLSearchParams({ apikey: key })
    for (const [k, v] of Object.entries(options.query ?? {})) if (v !== undefined) query.set(k, String(v))
    // A body goes as text/plain: the one JSON-carrying request a browser sends without a preflight, which MDBList refuses.
    const init: RequestInit = { method, cache: 'no-store', keepalive: options.keepalive }
    if (options.body !== undefined) {
      init.body = JSON.stringify(options.body)
      init.headers = { 'Content-Type': 'text/plain;charset=UTF-8' }
    }
    let res: Response
    try {
      res = await fetcher(`${mdblistBase}${path}?${query}`, init)
    } catch {
      throw new TrackerError(say.network, 'network')
    }
    if (res.status === 401 || res.status === 403) throw new TrackerError(say.key, 'client-id', res.status)
    if (res.status === 429) throw new TrackerError(say.rate, 'rate', 429)
    if (res.status >= 500) throw new TrackerError(say.server(res.status), 'server', res.status)
    if (res.status === 415) throw new TrackerError('MDBList won’t take updates sent from a web page, so this change stays in this browser. The apps can send it.', 'rejected', 415)
    if (!res.ok) throw new TrackerError(say.rejected(res.status), 'rejected', res.status)
    return res.status === 204 ? null : await res.json().catch(() => null)
  }

  const post = async (path: string, body: unknown): Promise<void> => void (await request('POST', path, { body }))
  const ids = (entries: Entry[]) => syncBody(entries)

  return {
    request,

    /** Whether MDBList accepts the key, using the account's own profile. Resolves to who it belongs to. */
    async profile(): Promise<string | undefined> {
      const body = await request('GET', '/user')
      const name = obj(body) ? (body.username ?? body.name) : undefined
      return typeof name === 'string' && name ? name : undefined
    },

    async watchlist(): Promise<Listed[]> {
      return readWatchlist(await request('GET', '/watchlist/items'))
    },
    addToWatchlist: (entries: Entry[]) => post('/watchlist/items/add', listBody(entries)),
    removeFromWatchlist: (entries: Entry[]) => post('/watchlist/items/remove', listBody(entries)),

    async history(limit: number): Promise<Watch[]> {
      return readHistory(await request('GET', '/sync/history', { query: { limit } }))
    },
    addHistory: (entries: Entry[]) => post('/sync/watched', ids(entries)),
    removeHistory: (entries: Entry[]) => post('/sync/watched/remove', ids(entries)),

    async watchedShows(): Promise<ShowWatched[]> {
      return readWatchedShows(await request('GET', '/sync/watched'))
    },

    async playback(): Promise<Resume[]> {
      return readPlayback(await request('GET', '/sync/playback'))
    },
    deletePlayback: async (id: number): Promise<void> => void (await request('DELETE', `/sync/playback/${id}`)),

    // MDBList keeps no scores of the viewer's own through this API; the apps send none either.
    rate: async (_entries: Entry[]): Promise<void> => undefined,
    unrate: async (_entries: Entry[]): Promise<void> => undefined,

    scrobble: async (action: Scrobble, target: Target, progress: number, keepalive = false): Promise<void> => void (await request('POST', `/scrobble/${action}`, { body: scrobbleBody(target, progress), keepalive })),
  }
}

/** `/watchlist/items/add` names a title by its TMDB id alone: `{movies: [{tmdb}]}`. */
export function listBody(entries: Entry[]): Record<string, unknown> {
  const movies = entries.filter((e) => e.type === 'movie').map((e) => ({ tmdb: e.id }))
  const shows = entries.filter((e) => e.type === 'show').map((e) => ({ tmdb: e.id }))
  return { ...(movies.length ? { movies } : {}), ...(shows.length ? { shows } : {}) }
}

export type MDBListClient = ReturnType<typeof createMDBListClient>

/** The client as the engine uses it. */
export function mdblistBackend(client: MDBListClient, ready: () => boolean): Backend {
  return {
    kind: 'mdblist',
    name: mdblistName,
    ready,
    async pull({ full, limit, track = true, watchlist: lists = true }: PullOptions): Promise<Pulled> {
      const [watchlist, history, resumes, shows] = await Promise.all([lists ? client.watchlist() : [], track ? client.history(limit) : [], track ? client.playback() : [], track && full ? client.watchedShows() : Promise.resolve(undefined)])
      return { watchlist, history, resumes, ...(shows ? { shows } : {}) }
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
