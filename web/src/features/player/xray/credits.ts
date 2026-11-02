import { queryOptions } from '@tanstack/react-query'
import { scope } from '../../../lib/queries'
import { tmdb } from '../../../lib/tmdb/client'
import { episodeCast } from './xray'

const day = 24 * 60 * 60_000

/** Who is in one episode: the regular cast, then that episode's guest stars. Part of X-Ray's own chunk. */
export const episodeCredits = (showId: number, season: number, episode: number) =>
  queryOptions({
    queryKey: [...scope(), 'episode-credits', showId, season, episode],
    queryFn: async () => episodeCast(await tmdb(`/tv/${showId}/season/${season}/episode/${episode}/credits`)),
    staleTime: day,
  })
