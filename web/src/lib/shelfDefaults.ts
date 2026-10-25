import type { MediaType } from './tmdb/types'

/* The shelf list's types and its defaults, as FlowKit's ShelfConfig. Kept apart from lib/shelves.ts (the
   editing, the JSON and the validators, which only Settings and Backup load) because the settings store
   needs the default list at first load. Names, order and which are on match the apps. */

export const builtInShelves = [
  'continueWatching', 'nextUp', 'watchlist', 'favourites', 'recentlyWatched', 'trendingMovies', 'trendingShows',
  'popularMovies', 'popularShows', 'topRatedMovies', 'topRatedShows', 'nowPlaying', 'upcomingMovies', 'upcomingEpisodes',
  'airingToday', 'anticipatedMovies', 'anticipatedShows', 'recommendedForYou', 'mediaServerRecent', 'becauseYouWatched',
  'streamingServices', 'genres',
] as const
export type BuiltInShelf = (typeof builtInShelves)[number]

export const builtInTitles: Record<BuiltInShelf, string> = {
  continueWatching: 'Continue Watching', nextUp: 'Up Next', watchlist: 'Watchlist', favourites: 'Favourites', recentlyWatched: 'Recently Watched',
  trendingMovies: 'Trending Movies', trendingShows: 'Trending Shows', popularMovies: 'Popular Movies', popularShows: 'Popular Shows',
  topRatedMovies: 'Top Rated Movies', topRatedShows: 'Top Rated Shows', nowPlaying: 'Now Playing', upcomingMovies: 'Upcoming Movies',
  upcomingEpisodes: 'Upcoming', airingToday: 'Airing Today', anticipatedMovies: 'Anticipated Movies', anticipatedShows: 'Anticipated Shows',
  recommendedForYou: 'Recommended For You', mediaServerRecent: 'Recently Added to Your Server', becauseYouWatched: 'Because You Watched',
  streamingServices: 'Streaming Services', genres: 'Genres',
}

/** TMDB Discover's orderings, by the value the apps save. */
export const discoverSorts = ['popularity.desc', 'vote_average.desc', 'primary_release_date.desc', 'primary_release_date.asc', 'revenue.desc', 'vote_count.desc'] as const
export type DiscoverSort = (typeof discoverSorts)[number]

/** A Discover shelf's filters, as the apps' DiscoverQuery. `releasedFromDays` and `releasedToDays` are
 *  days from today (negative is the past), so a shelf can always point at what's coming. */
export interface DiscoverQuery {
  type: MediaType
  genres: number[]
  excludedGenres: number[]
  yearFrom?: number
  yearTo?: number
  minRating?: number
  minVotes?: number
  originalLanguage?: string
  sort: DiscoverSort
  watchProviders: number[]
  watchRegion?: string
  releasedFromDays?: number
  releasedToDays?: number
}

export const newQuery = (type: MediaType = 'movie'): DiscoverQuery => ({ type, genres: [], excludedGenres: [], sort: 'popularity.desc', watchProviders: [] })

/** Where a shelf's titles come from. Trakt and MDBList lists and a media server's libraries have their own
 *  batches: the model keeps them (and the JSON round-trips them) so those slot in without a migration. */
export type ShelfSource =
  | { kind: 'builtIn'; id: BuiltInShelf }
  | { kind: 'discover'; query: DiscoverQuery }
  | { kind: 'traktList'; user: string; slug: string }
  | { kind: 'mdblist'; id: number }
  | { kind: 'mediaServerLibrary'; serverID: string; libraryID: string }

/** How a shelf is drawn: posters, stills, or the apps' full-width hero (the website draws that as posters). */
export type ShelfStyle = 'poster' | 'landscape' | 'hero'

export interface ShelfConfig {
  id: string
  title: string
  source: ShelfSource
  enabled: boolean
  style: ShelfStyle
}

export const builtIn = (id: BuiltInShelf, enabled = true, style: ShelfStyle = 'poster'): ShelfConfig => ({ id, title: builtInTitles[id], source: { kind: 'builtIn', id }, enabled, style })

/** The apps' default list and order. */
export const defaultShelves: ShelfConfig[] = [
  builtIn('continueWatching', true, 'landscape'), builtIn('upcomingEpisodes'), builtIn('watchlist'), builtIn('trendingMovies'), builtIn('trendingShows'),
  builtIn('becauseYouWatched'), builtIn('popularMovies'), builtIn('nextUp', false, 'landscape'), builtIn('popularShows', false), builtIn('topRatedMovies', false),
  builtIn('nowPlaying', false), builtIn('upcomingMovies', false), builtIn('airingToday', false), builtIn('mediaServerRecent', false), builtIn('favourites', false),
  builtIn('recentlyWatched', false), builtIn('streamingServices'), builtIn('genres'),
]

/** Where the top pick comes from when nothing is in progress. */
export type HeroSource = 'trending' | 'popular' | 'watchlist'
