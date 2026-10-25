import type { WatchProvider } from '../../lib/providers'

/* The two folder rows: Streaming Services and Genres. A tile opens Explore, filtered. As FlowKit's
   StreamingServices.featured and GenreTile.featured, so the website's tiles are the apps' tiles. */

/** The major services in tile order. TMDB lists a few of them twice (a regional entry), so each has aliases. */
const featured: { id: number; name: string; aliases: number[] }[] = [
  { id: 8, name: 'Netflix', aliases: [] },
  { id: 350, name: 'Apple TV+', aliases: [] },
  { id: 337, name: 'Disney+', aliases: [] },
  { id: 9, name: 'Prime Video', aliases: [119] },
  { id: 1899, name: 'Max', aliases: [384] },
  { id: 15, name: 'Hulu', aliases: [] },
  { id: 531, name: 'Paramount+', aliases: [] },
  { id: 386, name: 'Peacock', aliases: [387] },
]

export interface ServiceTile {
  id: number
  name: string
  logo?: string
}

/** The featured services the region carries, with TMDB's logos; one the region lacks is dropped. While the
 *  region's list hasn't loaded (or can't), every service shows by name, so the row never waits. */
export function serviceTiles(available: readonly WatchProvider[]): ServiceTile[] {
  if (available.length === 0) return featured.map((f) => ({ id: f.id, name: f.name }))
  const byId = new Map(available.map((p) => [p.id, p]))
  return featured.flatMap((f) => {
    const found = [f.id, ...f.aliases].map((id) => byId.get(id)).find(Boolean)
    return found ? [{ id: found.id, name: f.name, logo: found.logo }] : []
  })
}

export interface GenreTile {
  id: number
  name: string
}

/** TMDB movie genre ids in tile order, named the short way ("Sci-Fi"). */
export const genreTiles: readonly GenreTile[] = [
  { id: 28, name: 'Action' }, { id: 35, name: 'Comedy' }, { id: 18, name: 'Drama' }, { id: 878, name: 'Sci-Fi' }, { id: 27, name: 'Horror' }, { id: 53, name: 'Thriller' },
  { id: 16, name: 'Animation' }, { id: 10749, name: 'Romance' }, { id: 99, name: 'Documentary' }, { id: 80, name: 'Crime' }, { id: 14, name: 'Fantasy' }, { id: 9648, name: 'Mystery' },
]
