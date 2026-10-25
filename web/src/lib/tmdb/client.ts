import { settingsStore } from '../store/settings'
import type { CastMember, Episode, Genre, MediaDetail, MediaItem, MediaType, Page, Person, Provider, SearchResult, Video } from './types'
import { creditsScenesFrom } from './creditsScenes'
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

const items = (list: any[] | undefined, type?: MediaType): MediaItem[] => (list ?? []).map((r) => item(r, type)).filter((x): x is MediaItem => !!x)

function page(raw: any, type?: MediaType): Page<MediaItem> {
  return { page: raw.page ?? 1, totalPages: Math.min(raw.total_pages ?? 1, 500), results: items(raw.results, type) }
}

function provider(raw: any): Provider {
  return { id: raw.provider_id, name: raw.provider_name, logo: raw.logo_path ?? undefined }
}

function episode(raw: any): Episode {
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

function bestLogo(logos: any[] | undefined, language: string): string | undefined {
  if (!logos?.length) return undefined
  const score = (l: any) => (l.iso_639_1 === language ? 3 : l.iso_639_1 === 'en' ? 2 : l.iso_639_1 == null ? 1 : 0) + (l.vote_average ?? 0) / 100
  return [...logos].sort((a, b) => score(b) - score(a))[0]?.file_path
}

function certification(raw: any, type: MediaType, region: string): string | undefined {
  if (type === 'movie') {
    const pick = (r: any) => r?.release_dates?.map((d: any) => d.certification).find((c: string) => c)
    const results: any[] = raw.release_dates?.results ?? []
    return pick(results.find((r) => r.iso_3166_1 === region)) ?? pick(results.find((r) => r.iso_3166_1 === 'US'))
  }
  const results: any[] = raw.content_ratings?.results ?? []
  return (results.find((r) => r.iso_3166_1 === region) ?? results.find((r) => r.iso_3166_1 === 'US'))?.rating || undefined
}

function trailer(raw: any): Video | undefined {
  const videos: any[] = (raw.videos?.results ?? []).filter((v: any) => v.site === 'YouTube')
  const pick = videos.find((v) => v.type === 'Trailer' && v.official) ?? videos.find((v) => v.type === 'Trailer') ?? videos.find((v) => v.type === 'Teaser')
  return pick ? { key: pick.key, name: pick.name, site: pick.site, type: pick.type } : undefined
}

function credits(raw: any, type: MediaType): { cast: CastMember[]; crew: CastMember[] } {
  const castRaw: any[] = type === 'show' && raw.aggregate_credits?.cast?.length ? raw.aggregate_credits.cast : raw.credits?.cast ?? []
  const cast = castRaw.slice(0, 200).map((c) => ({
    id: c.id,
    name: c.name,
    role: c.character ?? c.roles?.[0]?.character ?? '',
    profile: c.profile_path ?? undefined,
  }))
  const key = new Set(['Director', 'Creator', 'Screenplay', 'Writer', 'Original Music Composer', 'Director of Photography', 'Producer'])
  const crewRaw: any[] = raw.credits?.crew ?? []
  const creators: CastMember[] = (raw.created_by ?? []).map((c: any) => ({ id: c.id, name: c.name, role: 'Creator', profile: c.profile_path ?? undefined }))
  const seen = new Set<number>(creators.map((c) => c.id))
  const crew = [
    ...creators,
    ...crewRaw
      .filter((c) => key.has(c.job))
      .filter((c) => (seen.has(c.id) ? false : (seen.add(c.id), true)))
      .map((c) => ({ id: c.id, name: c.name, role: c.job, profile: c.profile_path ?? undefined })),
  ].slice(0, 12)
  return { cast, crew }
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
    const lang = s.language.slice(0, 2)
    const append =
      type === 'movie'
        ? 'credits,videos,recommendations,similar,release_dates,external_ids,images,watch/providers,keywords'
        : 'aggregate_credits,credits,videos,recommendations,similar,content_ratings,external_ids,images,watch/providers'
    const raw = await tmdb(`/${tmdbPath(type)}/${id}`, { append_to_response: append, include_image_language: `${lang},en,null` })
    const base = item({ ...raw, media_type: tmdbPath(type) }, type)!
    const region = raw['watch/providers']?.results?.[s.region] ?? raw['watch/providers']?.results?.US ?? {}
    const { cast, crew } = credits(raw, type)
    return {
      ...base,
      genres: (raw.genres ?? []).map((g: Genre) => g.id),
      genreNames: (raw.genres ?? []).map((g: Genre) => g.name),
      tagline: raw.tagline || undefined,
      status: raw.status,
      runtime: raw.runtime || raw.episode_run_time?.[0] || undefined,
      certification: certification(raw, type, s.region),
      cast,
      crew,
      trailer: trailer(raw),
      recommendations: items(raw.recommendations?.results, type),
      similar: items(raw.similar?.results, type),
      seasons: (raw.seasons ?? [])
        .filter((x: any) => x.season_number > 0 || (raw.seasons ?? []).length === 1)
        .map((x: any) => ({ number: x.season_number, name: x.name, episodeCount: x.episode_count, airDate: x.air_date ?? undefined, poster: x.poster_path ?? undefined })),
      imdb: raw.imdb_id ?? raw.external_ids?.imdb_id ?? undefined,
      tvdb: raw.external_ids?.tvdb_id ?? undefined,
      logo: bestLogo(raw.images?.logos, lang),
      providers: {
        link: region.link,
        stream: (region.flatrate ?? []).map(provider),
        rent: (region.rent ?? []).map(provider),
        buy: (region.buy ?? []).map(provider),
      },
      nextEpisode: raw.next_episode_to_air ? episode(raw.next_episode_to_air) : undefined,
      lastEpisode: raw.last_episode_to_air ? episode(raw.last_episode_to_air) : undefined,
      networks: (raw.networks ?? []).map((n: any) => n.name),
      voteCount: raw.vote_count,
      collection: raw.belongs_to_collection ? { id: raw.belongs_to_collection.id, name: raw.belongs_to_collection.name } : undefined,
      // Movies list their keywords under "keywords", shows under "results"; only films have credits scenes to stay for.
      creditsScenes: type === 'movie' ? creditsScenesFrom((raw.keywords?.keywords ?? []).map((k: { name: string }) => k.name)) : undefined,
    }
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
