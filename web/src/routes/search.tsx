import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/search')({
  validateSearch: (search: Record<string, unknown>): { q?: string } => ({ q: typeof search.q === 'string' && search.q ? search.q : undefined }),
  component: () => (
    <div className="page">
      <h1 className="page-title">Search</h1>
    </div>
  ),
})
