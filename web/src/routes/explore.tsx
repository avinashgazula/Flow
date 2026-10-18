import { createFileRoute } from '@tanstack/react-router'
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
  component: () => (
    <div className="page">
      <h1 className="page-title">Explore</h1>
    </div>
  ),
})
