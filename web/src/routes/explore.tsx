import { createFileRoute } from '@tanstack/react-router'
import { ExploreScreen } from '../features/explore/ExploreScreen'
import { filtersToSearch, parseFilters, type FilterSearch } from '../features/explore/filters'
import { parseSort } from '../features/explore/sorts'
import type { MediaType } from '../lib/tmdb/types'

export interface ExploreSearch extends FilterSearch {
  type?: MediaType
  sort?: string
  genre?: number
}

export const Route = createFileRoute('/explore')({
  // The filters are checked and rewritten in their canonical form, so a bad or hand-edited link still opens
  // Explore with the parts that make sense, and the address always reads the same for the same filters.
  validateSearch: (search: Record<string, unknown>): ExploreSearch => ({
    type: search.type === 'show' ? 'show' : search.type === 'movie' ? 'movie' : undefined,
    sort: typeof search.sort === 'string' ? search.sort : undefined,
    genre: search.genre !== undefined ? Number(search.genre) || undefined : undefined,
    ...filtersToSearch(parseFilters(search)),
  }),
  component: Explore,
})

function Explore() {
  const search = Route.useSearch()
  return <ExploreScreen type={search.type ?? 'movie'} sort={parseSort(search.sort)} genre={search.genre} filters={parseFilters(search)} />
}
