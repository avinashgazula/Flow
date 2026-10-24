import { languageName } from '../../lib/language'
import type { MediaType } from '../../lib/tmdb/types'
import { releaseWindows, type ExploreFilters } from './filters'

/* What Explore's filters mean to TMDB and to the reader: the Discover parameters and the one-line summary.
   Kept apart from filters.ts, which the route needs at first load to check an address; this part loads
   with the Explore screen. */

/** The languages the apps offer, by TMDB's original-language code. */
export const filterLanguages: readonly { id: string; label: string }[] = [
  ['en', 'English'], ['es', 'Spanish'], ['fr', 'French'], ['de', 'German'], ['it', 'Italian'], ['ja', 'Japanese'],
  ['ko', 'Korean'], ['zh', 'Chinese'], ['hi', 'Hindi'], ['ta', 'Tamil'], ['te', 'Telugu'], ['ml', 'Malayalam'],
  ['pt', 'Portuguese'], ['ru', 'Russian'], ['tr', 'Turkish'], ['sv', 'Swedish'], ['da', 'Danish'], ['no', 'Norwegian'],
].map(([id, label]) => ({ id: id!, label: label! }))

const dayMs = 86_400_000

/** `today` shifted by whole days, as a calendar date. Done in UTC so a day is always a day. */
export function shiftDay(today: string, days: number): string {
  return new Date(Date.parse(`${today}T00:00:00Z`) + days * dayMs).toISOString().slice(0, 10)
}

/** Whether the filters look at titles that aren't out yet, which have no votes to rank by. */
export function looksAhead(f: ExploreFilters, today: string): boolean {
  const w = releaseWindows.find((x) => x.id === f.window)
  if (w) return w.to > 0
  return f.yearFrom !== undefined && f.yearFrom > Number(today.slice(0, 4))
}

/** The Discover parameters for a set of filters. A rating needs votes behind it (a title with one perfect
 *  vote isn't "9+"), so it brings a vote floor; TV gets a lower one, as it has fewer voters. */
export function filterParams(type: MediaType, f: ExploreFilters, opts: { today: string; region: string }): Record<string, string | number> {
  const date = type === 'movie' ? 'primary_release_date' : 'first_air_date'
  const p: Record<string, string | number> = {}
  const window = releaseWindows.find((w) => w.id === f.window)
  if (window) {
    p[`${date}.gte`] = shiftDay(opts.today, window.from)
    p[`${date}.lte`] = shiftDay(opts.today, window.to)
  } else {
    if (f.yearFrom !== undefined) p[`${date}.gte`] = `${f.yearFrom}-01-01`
    if (f.yearTo !== undefined) p[`${date}.lte`] = `${f.yearTo}-12-31`
  }
  if (f.minRating !== undefined) {
    p['vote_average.gte'] = f.minRating
    p['vote_count.gte'] = type === 'movie' ? 100 : 50
  }
  if (f.language) p.with_original_language = f.language
  if (f.providers.length) {
    // Any of them, and only where it's included with a subscription: "Streaming On" is not rent or buy.
    p.with_watch_providers = f.providers.join('|')
    p.watch_region = opts.region
    p.with_watch_monetization_types = 'flatrate'
  }
  return p
}

function yearText(f: ExploreFilters): string | undefined {
  const { yearFrom: a, yearTo: b } = f
  if (a !== undefined && b !== undefined) return a === b ? `${a}` : `${a}–${b}`
  if (a !== undefined) return `${a} and later`
  if (b !== undefined) return `${b} and earlier`
  return undefined
}

/** One line for the filters in force, under the controls: "2020–2024 · Rated 7+ · Japanese · Netflix, Hulu".
 *  Provider names come from the catalogue; until it loads (or for a service the region no longer has)
 *  it counts them instead of showing ids. */
export function summarizeFilters(f: ExploreFilters, providerNames: ReadonlyMap<number, string> = new Map()): string {
  const parts: string[] = []
  const years = releaseWindows.find((w) => w.id === f.window)?.label ?? yearText(f)
  if (years) parts.push(years)
  if (f.minRating !== undefined) parts.push(`Rated ${f.minRating}+`)
  if (f.language) parts.push(filterLanguages.find((l) => l.id === f.language)?.label ?? languageName(f.language) ?? f.language.toUpperCase())
  if (f.providers.length) {
    const names = f.providers.map((id) => providerNames.get(id))
    parts.push(names.every((n): n is string => !!n) ? names.join(', ') : `${f.providers.length} Streaming Service${f.providers.length === 1 ? '' : 's'}`)
  }
  return parts.join(' · ')
}
