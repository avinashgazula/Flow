import { createFileRoute } from '@tanstack/react-router'
import { ExploreScreen } from '../features/explore/ExploreScreen'
import { parseSort } from '../features/explore/source'
import type { MediaType } from '../lib/tmdb/types'

export interface ExploreSearch {
  type?: MediaType
  sort?: string
  genre?: number
}

export const Route = createFileRoute('/explore')({
  validateSearch: (search: Record<string, unknown>): ExploreSearch => ({
    type: search.type === 'show' ? 'show' : search.type === 'movie' ? 'movie' : undefined,
    sort: typeof search.sort === 'string' ? search.sort : undefined,
    genre: search.genre !== undefined ? Number(search.genre) || undefined : undefined,
  }),
  component: Explore,
})

function Explore() {
  const search = Route.useSearch()
  return <ExploreScreen type={search.type ?? 'movie'} sort={parseSort(search.sort)} genre={search.genre} />
}
