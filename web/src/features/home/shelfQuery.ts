import type { DiscoverQuery } from '../../lib/shelfDefaults'
import type { BuiltInShelf } from '../../lib/shelfDefaults'
import type { MediaItem, MediaType } from '../../lib/tmdb/types'

/* What a shelf means to TMDB and to Explore: the Discover parameters of a query, where "See all" goes, and
   which titles a lead turns through. Pure, so each is tested without a browser. */

const dayMs = 86_400_000
const isoDay = (t: number) => {
  const d = new Date(t)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** The Discover parameters for a query, as FlowKit's TMDBClient.discoverParameters: years become the whole
 *  year, relative days are counted from `now`, a rating sort wants some votes behind it, and services are
 *  matched in the viewer's region. TV names its date fields differently, and Box Office means popularity there. */
export function discoverParams(q: DiscoverQuery, region: string, now: number): Record<string, string | number> {
  const movie = q.type === 'movie'
  const date = movie ? 'primary_release_date' : 'first_air_date'
  const sort = !movie && q.sort === 'revenue.desc' ? 'popularity.desc' : !movie ? q.sort.replace('primary_release_date', 'first_air_date') : q.sort
  const p: Record<string, string | number> = { sort_by: sort }
  if (q.genres.length) p.with_genres = q.genres.join(',')
  if (q.excludedGenres.length) p.without_genres = q.excludedGenres.join(',')
  if (q.yearFrom !== undefined) p[`${date}.gte`] = `${q.yearFrom}-01-01`
  if (q.yearTo !== undefined) p[`${date}.lte`] = `${q.yearTo}-12-31`
  if (q.releasedFromDays !== undefined) p[`${date}.gte`] = isoDay(now + q.releasedFromDays * dayMs)
  if (q.releasedToDays !== undefined) p[`${date}.lte`] = isoDay(now + q.releasedToDays * dayMs)
  if (q.minRating !== undefined) p['vote_average.gte'] = q.minRating
  if (q.minVotes !== undefined) p['vote_count.gte'] = q.minVotes
  else if (q.sort === 'vote_average.desc') p['vote_count.gte'] = 200
  if (q.originalLanguage) p.with_original_language = q.originalLanguage
  if (q.watchProviders.length) {
    p.with_watch_providers = q.watchProviders.join('|')
    p.watch_region = q.watchRegion ?? region
  }
  return p
}

/** What Explore's address can carry of a query: the kind of title, the first genre, the services, the years and
 *  the language. A query with more than that opens Explore on what it can name. */
export interface ExploreLink {
  type: MediaType
  sort?: string
  genre?: number
  providers?: string
  from?: number
  to?: number
  lang?: string
  rating?: number
  window?: string
}

export function exploreLinkFor(q: DiscoverQuery): ExploreLink {
  const link: ExploreLink = { type: q.type }
  if (q.genres[0] !== undefined) link.genre = q.genres[0]
  if (q.watchProviders.length) link.providers = q.watchProviders.join(',')
  if (q.yearFrom !== undefined) link.from = q.yearFrom
  if (q.yearTo !== undefined) link.to = q.yearTo
  if (q.originalLanguage) link.lang = q.originalLanguage
  if (q.minRating !== undefined && q.minRating >= 5 && q.minRating <= 9) link.rating = Math.floor(q.minRating)
  if ((q.releasedToDays ?? 0) > 0) link.window = (q.releasedToDays ?? 0) > 30 ? 'next180' : 'next30'
  if (q.sort === 'vote_average.desc') link.sort = 'top'
  else if (q.sort === 'primary_release_date.desc') link.sort = 'new'
  else if (q.sort === 'popularity.desc') link.sort = 'popular'
  return link
}

/** Where a built-in shelf's "See all" goes; none where Explore has no matching list. */
export function builtInExplore(id: BuiltInShelf): ExploreLink | undefined {
  switch (id) {
    case 'trendingMovies': return { type: 'movie', sort: 'trending' }
    case 'trendingShows': return { type: 'show', sort: 'trending' }
    case 'popularMovies': return { type: 'movie', sort: 'popular' }
    case 'popularShows': return { type: 'show', sort: 'popular' }
    case 'topRatedMovies': return { type: 'movie', sort: 'top' }
    case 'topRatedShows': return { type: 'show', sort: 'top' }
    case 'nowPlaying': return { type: 'movie', window: 'last30' }
    case 'upcomingMovies': return { type: 'movie', window: 'next180' }
    default: return undefined
  }
}

// MARK: The lead's titles

/** The most the lead turns through. */
export const maxSlides = 10

/** One list laid into another, alternating, as the apps' `interleaved`: a's first, b's first, a's second, … */
export function interleave<T>(a: readonly T[], b: readonly T[]): T[] {
  const out: T[] = []
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if (i < a.length) out.push(a[i]!)
    if (i < b.length) out.push(b[i]!)
  }
  return out
}

/** The picks a lead can turn through: the primary source, with the secondary one interleaved when it is a
 *  different source; only titles with a still to show (the lead is a 16:9 frame); each title once. */
export function heroPicks(primary: readonly MediaItem[], secondary: readonly MediaItem[] | undefined, max = maxSlides): MediaItem[] {
  const seen = new Set<string>()
  return (secondary ? interleave(primary, secondary) : [...primary])
    .filter((m) => m.backdrop && !seen.has(`${m.type}:${m.id}`) && !!seen.add(`${m.type}:${m.id}`))
    .slice(0, max)
}

/** Whether the lead turns by itself: only when the viewer wants it, nothing is in progress (what's in progress is
 *  what they came to resume), there is more than one slide, and motion is allowed. */
export const advancesByItself = (o: { setting: boolean; resuming: boolean; slides: number; reducedMotion: boolean }) => o.setting && !o.resuming && o.slides > 1 && !o.reducedMotion
