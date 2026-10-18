import { createFileRoute, notFound } from '@tanstack/react-router'
import { PersonScreen } from '../../features/person/PersonScreen'
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
  component: Person,
})

function Person() {
  const { id } = Route.useParams()
  return <PersonScreen id={id} />
}
