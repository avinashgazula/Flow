import { useQueries } from '@tanstack/react-query'
import { useMemo } from 'react'
import { q } from '../../lib/queries'
import { queryClient } from '../../lib/queryClient'
import type { EpisodeRef } from '../../lib/store/library'
import type { Episode, MediaDetail } from '../../lib/tmdb/types'
import { airedRefs } from './logic'

/* A series' episodes across every season, which Next Up, Shuffle and "mark the show watched" all need. The apps
   load every season when a series page opens; so does this, through the same season queries the episode list
   reads, so a season is fetched once and kept. Specials are left out: they are not part of what is next. */

const regularSeasons = (d: MediaDetail) => d.seasons.filter((x) => x.number > 0)

const gather = (results: { data?: Episode[]; isPending: boolean }[]) => ({ lists: results.map((r) => r.data), done: results.every((r) => !r.isPending) })

export interface ShowEpisodes {
  /** The aired episodes of the seasons that have loaded. */
  aired: EpisodeRef[]
  /** Every season has answered (or failed to). Until then `aired` may be short. */
  ready: boolean
}

export function useShowEpisodes(d: MediaDetail | undefined, on: boolean, today: string): ShowEpisodes {
  const seasons = d && on ? regularSeasons(d) : []
  const { lists, done } = useQueries({ queries: seasons.map((x) => q.season(d!.id, x.number)), combine: gather })
  const aired = useMemo(() => airedRefs(lists.flatMap((l) => l ?? []), today), [lists, today])
  return { aired, ready: !on || !d || done }
}

/** Every regular season's episodes, from the cache or the network, for a click that needs the whole list now. A season
 *  that can't be read is left out. */
export async function fetchEpisodes(d: MediaDetail): Promise<Episode[]> {
  const lists = await Promise.all(regularSeasons(d).map((x) => queryClient.ensureQueryData(q.season(d.id, x.number)).catch(() => [] as Episode[])))
  return lists.flat()
}
