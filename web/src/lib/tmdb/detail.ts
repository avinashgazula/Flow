import type { CastMember, Genre, MediaDetail, MediaType, MovieRelease, Provider, Video } from './types'
import { tmdbPath } from './types'
import { episode, item, items } from './client'

/* A title page's details, from TMDB's one big answer (the title with its credits, videos, recommendations, release
   dates, images and watch providers appended) to the small shape components read. It is a chunk of its own: the
   first page needs only the lists. */

function provider(raw: any): Provider {
  return { id: raw.provider_id, name: raw.provider_name, logo: raw.logo_path ?? undefined }
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

/** A film's release dates in every country, as calendar days. TMDB gives each as a moment in UTC at midnight, so the
 *  first ten characters are the day. Entries without a usable date are left out. */
export function movieReleases(raw: any): MovieRelease[] {
  const out: MovieRelease[] = []
  for (const result of raw.release_dates?.results ?? []) {
    for (const r of result.release_dates ?? []) {
      const date = typeof r.release_date === 'string' ? r.release_date.slice(0, 10) : ''
      if (result.iso_3166_1 && Number.isInteger(r.type) && /^\d{4}-\d{2}-\d{2}$/.test(date)) out.push({ country: result.iso_3166_1, type: r.type, date })
    }
  }
  return out
}

/** Every YouTube video, best first, as FlowKit's `trailers`: official trailers, trailers, official teasers,
 *  teasers, then clips and the rest. The sort is stable, so TMDB's own order breaks ties. */
export function trailers(raw: any): Video[] {
  const rank = (v: Video) => (v.type === 'Trailer' ? 0 : v.type === 'Teaser' ? 1 : 2) * 2 + (v.official ? 0 : 1)
  return (raw.videos?.results ?? [])
    .filter((v: any) => typeof v.site === 'string' && v.site.toLowerCase() === 'youtube' && v.key)
    .map((v: any): Video => ({ key: v.key, name: v.name || v.type || 'Video', site: v.site, type: v.type, official: !!v.official }))
    .sort((a: Video, b: Video) => rank(a) - rank(b))
    .slice(0, 12)
}

/** Providers in the region's own display order, as FlowKit sorts them. */
function providersIn(list: any[] | undefined): Provider[] {
  return [...(list ?? [])].sort((a, b) => (a.display_priority ?? 999) - (b.display_priority ?? 999)).map(provider)
}


/** Where it was made: a show names its countries, a film lists its production countries. */
function countries(raw: any): string[] {
  const list: string[] = raw.origin_country ?? (raw.production_countries ?? []).map((c: any) => c.iso_3166_1)
  return list.filter(Boolean)
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


export function buildDetail(type: MediaType, raw: any, lang: string, regionCode: string): MediaDetail {
  const base = item({ ...raw, media_type: tmdbPath(type) }, type)!
  // The viewer's own region only: another country's services would be a promise it can't keep.
  const region = raw['watch/providers']?.results?.[regionCode] ?? {}
  const videos = trailers(raw)
  const { cast, crew } = credits(raw, type)
  return {
    ...base,
    genres: (raw.genres ?? []).map((g: Genre) => g.id),
    genreNames: (raw.genres ?? []).map((g: Genre) => g.name),
    tagline: raw.tagline || undefined,
    status: raw.status,
    runtime: raw.runtime || raw.episode_run_time?.[0] || undefined,
    certification: certification(raw, type, regionCode),
    cast,
    crew,
    trailer: videos[0],
    trailers: videos,
    recommendations: items(raw.recommendations?.results, type),
    similar: items(raw.similar?.results, type),
    // Specials (season 0) stay in the list: the page shows them when Settings → Specials Season is on.
    seasons: (raw.seasons ?? []).map((x: any) => ({ number: x.season_number, name: x.name, episodeCount: x.episode_count, airDate: x.air_date ?? undefined, poster: x.poster_path ?? undefined })),
    imdb: raw.imdb_id ?? raw.external_ids?.imdb_id ?? undefined,
    tvdb: raw.external_ids?.tvdb_id ?? undefined,
    logo: bestLogo(raw.images?.logos, lang),
    providers: {
      link: region.link,
      stream: providersIn(region.flatrate),
      // Free with ads counts as free, as in the apps.
      free: providersIn([...(region.free ?? []), ...(region.ads ?? [])]),
      rent: providersIn(region.rent),
      buy: providersIn(region.buy),
    },
    nextEpisode: raw.next_episode_to_air ? episode(raw.next_episode_to_air) : undefined,
    lastEpisode: raw.last_episode_to_air ? episode(raw.last_episode_to_air) : undefined,
    networks: (raw.networks ?? []).map((n: any) => n.name),
    voteCount: raw.vote_count,
    collection: raw.belongs_to_collection ? { id: raw.belongs_to_collection.id, name: raw.belongs_to_collection.name } : undefined,
    originCountries: countries(raw),
    budget: raw.budget > 0 ? raw.budget : undefined,
    revenue: raw.revenue > 0 ? raw.revenue : undefined,
    productionCompanies: (raw.production_companies ?? []).map((c: any) => c.name).filter(Boolean),
    ...(type === 'movie' ? { releases: movieReleases(raw) } : {}),
  }
}
