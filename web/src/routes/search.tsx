import { createFileRoute } from '@tanstack/react-router'
import { SearchScreen } from '../features/search/SearchScreen'

export const Route = createFileRoute('/search')({
  // A number-only search ("1917") arrives parsed as a number.
  validateSearch: (search: Record<string, unknown>): { q?: string } => ({ q: typeof search.q === 'string' && search.q ? search.q : typeof search.q === 'number' ? String(search.q) : undefined }),
  component: Search,
})

function Search() {
  const { q } = Route.useSearch()
  return <SearchScreen initial={q ?? ''} />
}
