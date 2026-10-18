import { createFileRoute, notFound } from '@tanstack/react-router'
import { Player } from '../../features/player/Player'
import { mediaTypeFromPath } from '../../lib/tmdb/types'

export interface WatchSearch {
  season?: number
  episode?: number
  /** A source chosen earlier, by id, to skip the picker. */
  source?: string
}

export const Route = createFileRoute('/watch/$type/$id')({
  validateSearch: (search: Record<string, unknown>): WatchSearch => ({
    season: search.season !== undefined ? Number(search.season) || undefined : undefined,
    episode: search.episode !== undefined ? Number(search.episode) || undefined : undefined,
    source: typeof search.source === 'string' ? search.source : undefined,
  }),
  params: {
    parse: (p) => {
      const id = Number(p.id)
      if (!Number.isInteger(id) || id <= 0) throw notFound()
      return { type: mediaTypeFromPath(p.type), id }
    },
    stringify: (p) => ({ type: p.type, id: String(p.id) }),
  },
  component: WatchRoute,
})

function WatchRoute() {
  const { type, id } = Route.useParams()
  const { season, episode, source } = Route.useSearch()
  return <Player type={type} id={id} season={season} episode={episode} source={source} />
}
