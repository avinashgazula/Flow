import { infiniteQueryOptions, queryOptions } from '@tanstack/react-query'
import { api } from './tmdb/client'
import type { MediaDetail, MediaItem, MediaType } from './tmdb/types'
import { queryClient } from './queryClient'
import { settingsStore } from './store/settings'

/* Every query key starts with the catalogue's identity (sample data or a key, plus language), so
   switching either never shows the other's results. */
const scope = () => {
  const s = settingsStore.get()
  return [s.demo ? 'demo' : 'tmdb', s.language, s.region] as const
}

const day = 24 * 60 * 60_000

export const q = {
  trending: (type: MediaType | 'all', window: 'day' | 'week' = 'week') =>
    queryOptions({ queryKey: [...scope(), 'trending', type, window], queryFn: () => api.trending(type, window).then(seed) }),

  list: (type: MediaType, list: Parameters<typeof api.list>[1]) =>
    queryOptions({ queryKey: [...scope(), 'list', type, list], queryFn: () => api.list(type, list).then(seed) }),

  discover: (type: MediaType, params: Record<string, string | number | undefined>) =>
    queryOptions({ queryKey: [...scope(), 'discover', type, params], queryFn: () => api.discover(type, params).then(seed) }),

  discoverInfinite: (type: MediaType, params: Record<string, string | number | undefined>) =>
    infiniteQueryOptions({
      queryKey: [...scope(), 'discover-infinite', type, params],
      queryFn: ({ pageParam }) => api.discover(type, params, pageParam).then(seed),
      initialPageParam: 1,
      getNextPageParam: (last) => (last.page < last.totalPages ? last.page + 1 : undefined),
    }),

  /** Trending this week or one of TMDB's fixed lists, page by page, for Explore's endless grid. */
  listInfinite: (type: MediaType, list: 'trending' | Parameters<typeof api.list>[1]) =>
    infiniteQueryOptions({
      queryKey: [...scope(), 'list-infinite', type, list],
      queryFn: ({ pageParam }) => (list === 'trending' ? api.trending(type, 'week', pageParam) : api.list(type, list, pageParam)).then(seed),
      initialPageParam: 1,
      getNextPageParam: (last) => (last.page < last.totalPages ? last.page + 1 : undefined),
    }),

  genres: (type: MediaType) => queryOptions({ queryKey: [...scope(), 'genres', type], queryFn: () => api.genres(type), staleTime: 7 * day }),

  search: (text: string) =>
    queryOptions({
      queryKey: [...scope(), 'search', text.trim().toLowerCase()],
      queryFn: ({ signal }) => api.search(text.trim(), 1, signal),
      enabled: text.trim().length > 0,
      staleTime: 10 * 60_000,
    }),

  detail: (type: MediaType, id: number) =>
    queryOptions({
      queryKey: [...scope(), 'detail', type, id],
      queryFn: () => api.detail(type, id).then((d) => (seed({ results: [...d.recommendations, ...d.similar] }), d)),
      staleTime: day,
      // The card that was tapped already knows the title, art and overview: show those at once.
      placeholderData: () => placeholder(type, id),
    }),

  season: (showId: number, season: number) =>
    queryOptions({ queryKey: [...scope(), 'season', showId, season], queryFn: () => api.season(showId, season), staleTime: day }),

  person: (id: number) => queryOptions({ queryKey: [...scope(), 'person', id], queryFn: () => api.person(id).then((p) => (seed({ results: p.credits }), p)), staleTime: day }),
}

/* Items seen in any list, by key: the instant first frame of their detail page. Kept in memory only. */
const seen = new Map<string, MediaItem>()

function seed<T extends { results: (MediaItem | { kind?: string })[] }>(page: T): T {
  for (const r of page.results) {
    const m = r as MediaItem
    if (m && typeof m.id === 'number' && (m.type === 'movie' || m.type === 'show')) seen.set(`${m.type}:${m.id}`, m)
  }
  return page
}

export function rememberItem(item: MediaItem) {
  seen.set(`${item.type}:${item.id}`, item)
}

function placeholder(type: MediaType, id: number): MediaDetail | undefined {
  const m = seen.get(`${type}:${id}`)
  if (!m) return undefined
  return {
    ...m,
    genreNames: [],
    cast: [],
    crew: [],
    recommendations: [],
    similar: [],
    seasons: [],
    providers: { stream: [], rent: [], buy: [] },
    networks: [],
  }
}

/** Fetches the detail page's data as soon as a pointer heads for a card. */
export function prefetchDetail(item: MediaItem) {
  rememberItem(item)
  void queryClient.prefetchQuery(q.detail(item.type, item.id))
}
