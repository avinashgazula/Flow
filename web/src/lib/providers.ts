import { queryOptions, useQuery } from '@tanstack/react-query'
import { useMemo } from 'react'
import { scope } from './queries'
import { useSettings } from './store/settings'
import { tmdb } from './tmdb/client'
import { imageURL } from './tmdb/images'
import { tmdbPath, type MediaType, type Provider } from './tmdb/types'

/* The streaming services TMDB lists for a region, as the apps' `watchProviders`. Generic on purpose: the
   Explore filter sheet picks from it, and Home's Streaming Services folders can read the same list. It
   goes through TanStack Query, so it is fetched once per type and region and then served from the cache
   (which is saved to IndexedDB) for a week. */

/** A service as the catalogue lists it, in TMDB's own order for the region. */
export interface WatchProvider extends Provider {
  /** 0 is first. TMDB ranks services by how many people in the region use them. */
  rank: number
}

/** The raw `/watch/providers/{movie|tv}` answer as a clean, ordered list: services without a name are
 *  dropped, an id listed twice keeps its first entry, and the order is TMDB's display priority for the
 *  region (ties and unranked services fall back to the order they came in). */
export function normalizeProviders(raw: unknown, region: string): WatchProvider[] {
  const results: any[] = Array.isArray((raw as any)?.results) ? (raw as any).results : []
  const seen = new Set<number>()
  const list: { provider: Provider; priority: number; index: number }[] = []
  results.forEach((r, index) => {
    const id = Number(r?.provider_id)
    const name = typeof r?.provider_name === 'string' ? r.provider_name.trim() : ''
    if (!Number.isInteger(id) || id <= 0 || !name || seen.has(id)) return
    seen.add(id)
    const priority = Number(r.display_priorities?.[region] ?? r.display_priority)
    list.push({ provider: { id, name, logo: r.logo_path ?? undefined }, priority: Number.isFinite(priority) ? priority : Infinity, index })
  })
  list.sort((a, b) => (a.priority === b.priority ? a.index - b.index : a.priority - b.priority))
  return list.map((x, rank) => ({ ...x.provider, rank }))
}

const week = 7 * 24 * 60 * 60_000

export const providerQuery = (type: MediaType, region: string) =>
  queryOptions({
    queryKey: [...scope(), 'watch-providers', type, region],
    queryFn: async () => normalizeProviders(await tmdb(`/watch/providers/${tmdbPath(type)}`, { watch_region: region }), region),
    // Services come and go a few times a year.
    staleTime: week,
  })

/** The region's services for one kind of title, in TMDB's order; empty until they load. The region is the
 *  one in Settings unless a caller passes its own. */
export function useWatchProviders(type: MediaType, region?: string) {
  const own = useSettings((s) => s.region)
  const query = useQuery(providerQuery(type, region ?? own))
  return { providers: query.data ?? emptyList, isPending: query.isPending, isError: query.isError, refetch: query.refetch, region: region ?? own }
}

const emptyList: WatchProvider[] = []

/** id to name, for sentences like the filter summary. */
export function useProviderNames(type: MediaType): ReadonlyMap<number, string> {
  const { providers } = useWatchProviders(type)
  return useMemo(() => new Map(providers.map((p) => [p.id, p.name])), [providers])
}

/** A service's logo for an <img>: TMDB serves these square, so 92 wide is sharp up to ~46px and 185 on
 *  dense screens. */
export function providerLogo(path: string | undefined): { src: string; srcSet: string } | undefined {
  const src = imageURL(path, 92)
  if (!src) return undefined
  return { src, srcSet: `${src} 1x, ${imageURL(path, 185)} 2x` }
}
