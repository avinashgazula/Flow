import type { MediaItem, MovieRelease } from './types'

/* Whether a title can be played at home yet, as FlowKit's ReleaseFilter. A film is out once a digital, physical or TV
   release date has passed; a list only gives its theatrical date, so a film from the last few months is checked
   against its release dates. A show is out once its first episode has aired. Pure: the lookup is passed in. */

/** Films older than this many days are taken to be out on home video even without release data. */
export const assumeReleasedAfterDays = 150

const dayMs = 86_400_000
const dayOf = (iso: string) => {
  const [y = 1970, m = 1, d = 1] = iso.split('-').map(Number)
  return Date.UTC(y, m - 1, d)
}

/** Local calendar day as "2026-11-07": the day TMDB's dates are compared with. */
export function today(now = Date.now()): string {
  const d = new Date(now)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** An answer that needs no request, or undefined when the film's release dates have to be looked up. */
export function quickDecision(item: Pick<MediaItem, 'type' | 'date'>, now: string): boolean | undefined {
  if (!item.date) return item.type === 'show'
  if (item.date > now) return false
  if (item.type === 'show') return true
  if (dayOf(now) - dayOf(item.date) > assumeReleasedAfterDays * dayMs) return true
  return undefined
}

/** Digital (4), physical (5) and TV (6) releases are the ones you can play at home. */
const isHome = (type: number) => type === 4 || type === 5 || type === 6

/** Undefined when there is no release information at all. */
export function isHomeReleased(releases: readonly MovieRelease[], now: string): boolean | undefined {
  if (releases.length === 0) return undefined
  return releases.some((r) => isHome(r.type) && r.date <= now)
}

export type ReleaseLookup = (id: number) => Promise<readonly MovieRelease[]>

/** The titles that can be played, in their order. Lookups run together and each film is asked once. */
export async function filterReleased<T extends Pick<MediaItem, 'type' | 'id' | 'date'>>(items: readonly T[], lookup: ReleaseLookup, now: string, cache: Map<number, boolean> = new Map()): Promise<T[]> {
  const flags = await Promise.all(
    items.map(async (item) => {
      const quick = quickDecision(item, now)
      if (quick !== undefined) return quick
      const known = cache.get(item.id)
      if (known !== undefined) return known
      const releases = await lookup(item.id).catch(() => undefined)
      // A lookup that failed isn't remembered, so the next list asks again.
      if (!releases) return false
      // With no dates to go on, a film from the last few months counts as not out yet, as the apps decide.
      const out = isHomeReleased(releases, now) ?? false
      cache.set(item.id, out)
      return out
    }),
  )
  return items.filter((_, i) => flags[i])
}
