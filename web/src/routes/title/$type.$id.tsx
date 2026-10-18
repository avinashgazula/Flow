import { createFileRoute, notFound } from '@tanstack/react-router'
import { DetailScreen } from '../../features/detail/DetailScreen'
import { q } from '../../lib/queries'
import { mediaTypeFromPath } from '../../lib/tmdb/types'

interface Search {
  season?: number
  play?: boolean
}

export const Route = createFileRoute('/title/$type/$id')({
  validateSearch: (search: Record<string, unknown>): Search => ({
    season: search.season !== undefined ? Number(search.season) || undefined : undefined,
    play: search.play === true || search.play === 'true' ? true : undefined,
  }),
  params: {
    parse: (p) => {
      const id = Number(p.id)
      if (!Number.isInteger(id) || id <= 0) throw notFound()
      return { type: mediaTypeFromPath(p.type), id }
    },
    stringify: (p) => ({ type: p.type, id: String(p.id) }),
  },
  // Not awaited: the page opens straight away on what the card already knew, then fills in.
  loader: ({ context, params }) => {
    void context.queryClient.prefetchQuery(q.detail(params.type, params.id))
  },
  component: DetailRoute,
})

function DetailRoute() {
  const { type, id } = Route.useParams()
  const search = Route.useSearch()
  return <DetailScreen key={`${type}${id}`} type={type} id={id} initialSeason={search.season} autoPlay={search.play} />
}
