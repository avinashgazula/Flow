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
  trailer?: Video
  recommendations: MediaItem[]
  similar: MediaItem[]
  seasons: SeasonSummary[]
  imdb?: string
  tvdb?: number
  logo?: string
  providers: { link?: string; stream: Provider[]; rent: Provider[]; buy: Provider[] }
  nextEpisode?: Episode
  lastEpisode?: Episode
  networks: string[]
  voteCount?: number
  collection?: { id: number; name: string }
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
