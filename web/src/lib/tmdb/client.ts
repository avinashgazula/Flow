import { settingsStore } from '../store/settings'
import type { Episode, Genre, MediaDetail, MediaItem, MediaType, Page, Person, SearchResult } from './types'
import { tmdbPath } from './types'

/* TMDB v3, as FlowKit's TMDBClient: either a v3 API key or a v4 read-access token. Responses are
   normalised straight away into the small shapes in types.ts, so the persisted cache stays compact
   and components never touch raw API JSON. */

const base = 'https://api.themoviedb.org/3'

export class TMDBError extends Error {
  constructor(message: string, readonly status: number) {
    super(message)
  }
}

type Query = Record<string, string | number | boolean | undefined>

export async function tmdb<T = any>(path: string, query: Query = {}, signal?: AbortSignal): Promise<T> {
  const s = settingsStore.get()
  const q: Query = { language: s.language, ...query }
  // Sample data stays out of the main bundle: it's fetched only when switched on.
  if (s.demo) return (await import('./demo')).demoTmdb(path, q) as Promise<T>
  const key = s.tmdbKey.trim()
  if (!key) throw new TMDBError('Add a TMDB key in Settings to load the catalogue.', 401)
  // v4 tokens are JWTs; v3 keys are 32 hex characters.
  const bearer = key.length > 40
  const params = new URLSearchParams()
  for (const [k, v] of Object.entries(q)) if (v !== undefined && v !== '') params.set(k, String(v))
  if (!bearer) params.set('api_key', key)
  const response = await fetch(`${base}${path}?${params}`, {
    headers: bearer ? { Authorization: `Bearer ${key}`, Accept: 'application/json' } : { Accept: 'application/json' },
    signal,
  })
  if (!response.ok) {
    const body = await response.json().catch(() => ({}))
    throw new TMDBError(body.status_message ?? `TMDB answered ${response.status}`, response.status)
  }
  return response.json()
}

// MARK: Normalisers

const year = (date?: string) => (date && date.length >= 4 ? Number(date.slice(0, 4)) : undefined)

export function item(raw: any, fallbackType?: MediaType): MediaItem | undefined {
  const type: MediaType | undefined =
    raw.media_type === 'movie' ? 'movie' : raw.media_type === 'tv' ? 'show' : raw.media_type === 'person' ? undefined : fallbackType ?? (raw.title !== undefined ? 'movie' : raw.name !== undefined ? 'show' : undefined)
  if (!type || raw.id == null) return undefined
  const date: string | undefined = (type === 'movie' ? raw.release_date : raw.first_air_date) || undefined
  return {
    type,
    id: raw.id,
    title: (type === 'movie' ? raw.title : raw.name) ?? raw.original_title ?? raw.original_name ?? '',
    year: year(date),
    date,
    overview: raw.overview ?? '',
    poster: raw.poster_path ?? undefined,
    backdrop: raw.backdrop_path ?? undefined,
    rating: raw.vote_average ? Math.round(raw.vote_average * 10) / 10 : undefined,
    genres: raw.genre_ids ?? raw.genres?.map((g: Genre) => g.id) ?? [],
    originalLanguage: raw.original_language || undefined,
  }
}

export const items = (list: any[] | undefined, type?: MediaType): MediaItem[] => (list ?? []).map((r) => item(r, type)).filter((x): x is MediaItem => !!x)

function page(raw: any, type?: MediaType): Page<MediaItem> {
  return { page: raw.page ?? 1, totalPages: Math.min(raw.total_pages ?? 1, 500), results: items(raw.results, type) }
}

export function episode(raw: any): Episode {
  return {
    id: raw.id ?? raw.season_number * 1000 + raw.episode_number,
    season: raw.season_number,
    number: raw.episode_number,
    name: raw.name ?? `Episode ${raw.episode_number}`,
    overview: raw.overview ?? '',
    still: raw.still_path ?? undefined,
    airDate: raw.air_date ?? undefined,
    runtime: raw.runtime ?? undefined,
    rating: raw.vote_average || undefined,
  }
}

// MARK: Endpoints

export const api = {
  trending: async (type: MediaType | 'all', window: 'day' | 'week' = 'week', p = 1) =>
    page(await tmdb(`/trending/${type === 'all' ? 'all' : tmdbPath(type)}/${window}`, { page: p }), type === 'all' ? undefined : type),

  list: async (type: MediaType, list: 'popular' | 'top_rated' | 'now_playing' | 'upcoming' | 'airing_today' | 'on_the_air', p = 1) =>
    page(await tmdb(`/${tmdbPath(type)}/${list}`, { page: p, region: settingsStore.get().region }), type),

  discover: async (type: MediaType, params: Query, p = 1) =>
    page(await tmdb(`/discover/${tmdbPath(type)}`, { page: p, include_adult: settingsStore.get().includeAdult, ...params }), type),

  genres: async (type: MediaType): Promise<Genre[]> => (await tmdb(`/genre/${tmdbPath(type)}/list`)).genres ?? [],

  search: async (text: string, p = 1, signal?: AbortSignal): Promise<Page<SearchResult>> => {
    const raw = await tmdb('/search/multi', { query: text, page: p, include_adult: settingsStore.get().includeAdult }, signal)
    const results: SearchResult[] = []
    for (const r of raw.results ?? []) {
      if (r.media_type === 'person') {
        results.push({
          kind: 'person',
          id: r.id,
          name: r.name,
          profile: r.profile_path ?? undefined,
          department: r.known_for_department,
          knownFor: (r.known_for ?? []).map((k: any) => k.title ?? k.name).filter(Boolean).slice(0, 3),
        })
      } else {
        const m = item(r)
        if (m) results.push({ kind: 'media', ...m })
      }
    }
    return { page: raw.page ?? 1, totalPages: raw.total_pages ?? 1, results }
  },

  detail: async (type: MediaType, id: number): Promise<MediaDetail> => {
    const s = settingsStore.get()
    const append =
      type === 'movie'
        ? 'credits,videos,recommendations,similar,release_dates,external_ids,images,watch/providers'
        : 'aggregate_credits,credits,videos,recommendations,similar,content_ratings,external_ids,images,watch/providers'
    // Turning the answer into a title page's details is a chunk of its own, fetched alongside the request, so
    // pages that never open a title don't carry it.
    const [raw, { buildDetail }] = await Promise.all([tmdb(`/${tmdbPath(type)}/${id}`, { append_to_response: append, include_image_language: `${s.language.slice(0, 2)},en,null` }), import('./detail')])
    return buildDetail(type, raw, s.language.slice(0, 2), s.region)
  },

  season: async (showId: number, season: number): Promise<Episode[]> => ((await tmdb(`/tv/${showId}/season/${season}`)).episodes ?? []).map(episode),

  person: async (id: number): Promise<Person> => {
    const raw = await tmdb(`/person/${id}`, { append_to_response: 'combined_credits' })
    const seen = new Set<string>()
    const credits = items([...(raw.combined_credits?.cast ?? []), ...(raw.combined_credits?.crew ?? [])])
      .filter((m) => (seen.has(`${m.type}${m.id}`) ? false : (seen.add(`${m.type}${m.id}`), true)))
      .sort((a, b) => (b.rating ?? 0) * Math.log((b.year ?? 1900) - 1890) - (a.rating ?? 0) * Math.log((a.year ?? 1900) - 1890))
    return {
      id: raw.id,
      name: raw.name,
      biography: raw.biography ?? '',
      profile: raw.profile_path ?? undefined,
      birthday: raw.birthday ?? undefined,
      placeOfBirth: raw.place_of_birth ?? undefined,
      department: raw.known_for_department,
      credits,
    }
  },

  find: async (imdb: string): Promise<MediaItem | undefined> => {
    const raw = await tmdb(`/find/${imdb}`, { external_source: 'imdb_id' })
    return items(raw.movie_results, 'movie')[0] ?? items(raw.tv_results, 'show')[0]
  },
}
