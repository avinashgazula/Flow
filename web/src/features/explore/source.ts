import type { MediaItem, MediaType } from '../../lib/tmdb/types'

export const exploreSorts = [
  { id: 'trending', label: 'Trending' },
  { id: 'popular', label: 'Popular' },
  { id: 'top', label: 'Top Rated' },
  { id: 'new', label: 'Newest' },
] as const

export type ExploreSort = (typeof exploreSorts)[number]['id']

export const parseSort = (value: unknown): ExploreSort => (exploreSorts.some((s) => s.id === value) ? (value as ExploreSort) : 'trending')

export type ExploreSource =
  | { kind: 'list'; list: 'trending' | 'popular' | 'top_rated' }
  | { kind: 'discover'; params: Record<string, string | number> }

/** Which TMDB endpoint answers a set of Explore filters. Trending and the fixed lists can't filter by
 *  genre, so a genre always goes through Discover, with the closest sort it offers. */
export function exploreSource(type: MediaType, sort: ExploreSort, genre: number | undefined, today = new Date().toISOString().slice(0, 10)): ExploreSource {
  const dateField = type === 'movie' ? 'primary_release_date' : 'first_air_date'
  if (!genre) {
    if (sort === 'trending') return { kind: 'list', list: 'trending' }
    if (sort === 'popular') return { kind: 'list', list: 'popular' }
    if (sort === 'top') return { kind: 'list', list: 'top_rated' }
  }
  const params: Record<string, string | number> = genre ? { with_genres: genre } : {}
  switch (sort) {
    case 'top':
      // Without a vote floor the top of the list is titles with one perfect vote.
      return { kind: 'discover', params: { ...params, sort_by: 'vote_average.desc', 'vote_count.gte': 300 } }
    case 'new':
      // Newest released, not announced: the far future is full of placeholders.
      return { kind: 'discover', params: { ...params, sort_by: `${dateField}.desc`, [`${dateField}.lte`]: today, 'vote_count.gte': type === 'movie' ? 40 : 15 } }
    default:
      return { kind: 'discover', params: { ...params, sort_by: 'popularity.desc' } }
  }
}

/** Pages overlap when the ranking shifts between requests: each title appears once, where it first did. */
export function uniqueItems(pages: { results: MediaItem[] }[] | undefined): MediaItem[] {
  if (!pages) return []
  const seen = new Set<string>()
  const out: MediaItem[] = []
  for (const page of pages) {
    for (const item of page.results) {
      const key = `${item.type}:${item.id}`
      if (seen.has(key)) continue
      seen.add(key)
      out.push(item)
    }
  }
  return out
}

/** The genres offered as chips, the most-browsed first (as ExploreView.quickGenres), then the rest by name. */
export const quickGenres: Record<MediaType, number[]> = {
  movie: [28, 35, 18, 878, 27, 53, 16, 10749, 99, 14, 80, 12],
  show: [18, 35, 80, 10765, 10759, 16, 9648, 99, 10764, 10751],
}

export function orderGenres<G extends { id: number; name: string }>(genres: G[], type: MediaType): G[] {
  const rank = new Map(quickGenres[type].map((id, i) => [id, i]))
  return [...genres].sort((a, b) => (rank.get(a.id) ?? 99) - (rank.get(b.id) ?? 99) || a.name.localeCompare(b.name))
}
