import { createFileRoute, notFound } from '@tanstack/react-router'
import { CollectionScreen } from '../../features/collection/CollectionScreen'

export const Route = createFileRoute('/collection/$id')({
  params: {
    parse: (p) => {
      const id = Number(p.id)
      if (!Number.isInteger(id) || id <= 0) throw notFound()
      return { id }
    },
    stringify: (p) => ({ id: String(p.id) }),
  },
  component: Collection,
})

function Collection() {
  const { id } = Route.useParams()
  return <CollectionScreen id={id} />
}
