import type { MediaType } from './tmdb/types'

export const movieGenres: Record<number, string> = { 28: 'Action', 12: 'Adventure', 16: 'Animation', 35: 'Comedy', 80: 'Crime', 99: 'Documentary', 18: 'Drama', 10751: 'Family', 14: 'Fantasy', 36: 'History', 27: 'Horror', 10402: 'Music', 9648: 'Mystery', 10749: 'Romance', 878: 'Science Fiction', 10770: 'TV Movie', 53: 'Thriller', 10752: 'War', 37: 'Western' }
export const tvGenres: Record<number, string> = { 10759: 'Action & Adventure', 16: 'Animation', 35: 'Comedy', 80: 'Crime', 99: 'Documentary', 18: 'Drama', 10751: 'Family', 10762: 'Kids', 9648: 'Mystery', 10763: 'News', 10764: 'Reality', 10765: 'Sci-Fi & Fantasy', 10766: 'Soap', 10767: 'Talk', 10768: 'War & Politics', 37: 'Western' }

/** Genre names from ids without a request: TMDB's genre tables change about once a decade. */
export function genreNames(ids: number[], type: MediaType): string[] {
  const table = type === 'movie' ? movieGenres : tvGenres
  return ids.map((id) => table[id] ?? movieGenres[id] ?? tvGenres[id]).filter((n): n is string => !!n)
}
