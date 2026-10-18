import { createFileRoute, notFound } from '@tanstack/react-router'
import { q } from '../../lib/queries'

export const Route = createFileRoute('/person/$id')({
  params: {
    parse: (p) => {
      const id = Number(p.id)
      if (!Number.isInteger(id) || id <= 0) throw notFound()
      return { id }
    },
    stringify: (p) => ({ id: String(p.id) }),
  },
  loader: ({ context, params }) => {
    void context.queryClient.prefetchQuery(q.person(params.id))
  },
  component: () => (
    <div className="page">
      <h1 className="page-title">Person</h1>
    </div>
  ),
})
