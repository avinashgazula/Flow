export type MediaType = 'movie' | 'show'

export const tmdbPath = (type: MediaType) => (type === 'movie' ? 'movie' : 'tv')
export const mediaTypeFromPath = (path: string): MediaType => (path === 'tv' || path === 'show' ? 'show' : 'movie')

/** What a card needs. Kept small: these are persisted to IndexedDB by the hundred. */
export interface MediaItem {
  type: MediaType
  id: number
  title: string
  year?: number
  date?: string
  overview: string
  poster?: string
  backdrop?: string
  rating?: number
  genres: number[]
  /** The language the title was made in (ISO 639-1, "ko"), for choosing audio. */
  originalLanguage?: string
}

export interface CastMember {
  id: number
  name: string
  role: string
  profile?: string
}

export interface Video {
  key: string
  name: string
  site: string
  type: string
  official?: boolean
}

export interface Provider {
  id: number
  name: string
  logo?: string
}

export interface SeasonSummary {
  number: number
  name: string
  episodeCount: number
  airDate?: string
  poster?: string
}

export interface Episode {
  id: number
  season: number
  number: number
  name: string
  overview: string
  still?: string
  airDate?: string
  runtime?: number
  rating?: number
}

export interface MediaDetail extends MediaItem {
  tagline?: string
  status?: string
  runtime?: number
  certification?: string
  genreNames: string[]
  cast: CastMember[]
  crew: CastMember[]
  /** The best trailer, the first of `trailers`. */
  trailer?: Video
  /** Every YouTube video TMDB lists, best first: official trailers, then teasers, then the rest. */
  trailers: Video[]
  recommendations: MediaItem[]
  similar: MediaItem[]
  seasons: SeasonSummary[]
  imdb?: string
  tvdb?: number
  logo?: string
  providers: { link?: string; stream: Provider[]; free: Provider[]; rent: Provider[]; buy: Provider[] }
  nextEpisode?: Episode
  lastEpisode?: Episode
  networks: string[]
  voteCount?: number
  collection?: { id: number; name: string }
  /** ISO 3166-1 codes of where it was made. */
  originCountries?: string[]
  /** Dollars; left out when TMDB has none (it says 0). */
  budget?: number
  revenue?: number
  productionCompanies?: string[]
}

/** What a viewer wrote about a title, from TMDB or a Trakt comment (FlowKit's Review). */
export interface Review {
  id: string
  source: 'tmdb' | 'trakt'
  author: string
  /** Already cleaned of entities, tags and Markdown (lib/reviewText). */
  text: string
  /** Out of 10, when the reviewer scored the title. */
  rating?: number
  /** Milliseconds since the epoch. */
  date?: number
  /** Trakt lets commenters flag spoilers; TMDB has no such flag. */
  spoiler: boolean
}

export interface Person {
  id: number
  name: string
  biography: string
  profile?: string
  birthday?: string
  placeOfBirth?: string
  department?: string
  credits: MediaItem[]
}

export type SearchResult = ({ kind: 'media' } & MediaItem) | { kind: 'person'; id: number; name: string; profile?: string; department?: string; knownFor: string[] }

export interface Page<T> {
  page: number
  totalPages: number
  results: T[]
}

export interface Genre {
  id: number
  name: string
}
