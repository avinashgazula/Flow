import { languageName } from '../../lib/language'
import type { MediaType } from '../../lib/tmdb/types'

/* Explore's filters, as the apps' DiscoverQuery sheet: when it was released, how well it's rated, the
   language it was made in and where it streams. Pure: the address, the sheet and TMDB's Discover
   parameters are all derived from one small object, so the three can't drift apart. */

export const releaseWindows = [
  { id: 'last30', label: 'Last 30 Days', from: -30, to: 0 },
  { id: 'last90', label: 'Last 90 Days', from: -90, to: 0 },
  { id: 'next30', label: 'Next 30 Days', from: 0, to: 30 },
  { id: 'next180', label: 'Next 6 Months', from: 0, to: 180 },
] as const

export type ReleaseWindow = (typeof releaseWindows)[number]['id']

/** The ratings the sheet offers, "5+" to "9+" (TMDB's vote average is out of ten). */
export const ratingSteps = [5, 6, 7, 8, 9] as const

/** The languages the apps offer, by TMDB's original-language code. */
export const filterLanguages: readonly { id: string; label: string }[] = [
  ['en', 'English'], ['es', 'Spanish'], ['fr', 'French'], ['de', 'German'], ['it', 'Italian'], ['ja', 'Japanese'],
  ['ko', 'Korean'], ['zh', 'Chinese'], ['hi', 'Hindi'], ['ta', 'Tamil'], ['te', 'Telugu'], ['ml', 'Malayalam'],
  ['pt', 'Portuguese'], ['ru', 'Russian'], ['tr', 'Turkish'], ['sv', 'Swedish'], ['da', 'Danish'], ['no', 'Norwegian'],
].map(([id, label]) => ({ id: id!, label: label! }))

export interface ExploreFilters {
  /** Released in or after / in or before this year. Ignored while a window is set. */
  yearFrom?: number
  yearTo?: number
  /** A window around today; it replaces the years, as in the apps. */
  window?: ReleaseWindow
  minRating?: number
  /** TMDB's original-language code. */
  language?: string
  /** TMDB watch-provider ids; a title on any of them matches. */
  providers: number[]
}

export const noFilters: ExploreFilters = { providers: [] }

const firstYear = 1920
export const lastFilterYear = (now = new Date()) => now.getFullYear() + 2

export const isFiltered = (f: ExploreFilters): boolean =>
  f.yearFrom !== undefined || f.yearTo !== undefined || f.window !== undefined || f.minRating !== undefined || f.language !== undefined || f.providers.length > 0

// MARK: The address

/** What the address carries. Providers are one comma-separated value, so the link reads
 *  `?providers=8,337` and not a JSON array. */
export interface FilterSearch {
  from?: number
  to?: number
  window?: string
  rating?: number
  lang?: string
  providers?: string
}

const whole = (value: unknown): number | undefined => {
  const n = typeof value === 'number' ? value : typeof value === 'string' && /^\d+$/.test(value.trim()) ? Number(value) : NaN
  return Number.isSafeInteger(n) ? n : undefined
}

/** Reads filters out of a link, dropping whatever isn't valid instead of failing: a stale or hand-edited
 *  link still opens Explore, with the parts that make sense. Years outside the sheet's range are dropped,
 *  a reversed range is put the right way round, and a window replaces the years. */
export function parseFilters(search: Record<string, unknown>, now = new Date()): ExploreFilters {
  const year = (v: unknown) => {
    const n = whole(v)
    return n !== undefined && n >= firstYear && n <= lastFilterYear(now) ? n : undefined
  }
  const window = releaseWindows.find((w) => w.id === search.window)?.id
  let yearFrom = window ? undefined : year(search.from)
  let yearTo = window ? undefined : year(search.to)
  if (yearFrom !== undefined && yearTo !== undefined && yearFrom > yearTo) [yearFrom, yearTo] = [yearTo, yearFrom]

  const rating = whole(search.rating)
  const lang = typeof search.lang === 'string' ? search.lang.trim().toLowerCase() : ''

  // A single id arrives as a number, several as "8,337": both are fine.
  const raw = typeof search.providers === 'number' ? String(search.providers) : typeof search.providers === 'string' ? search.providers : ''
  const providers: number[] = []
  for (const part of raw.split(',')) {
    const id = whole(part)
    if (id && !providers.includes(id)) providers.push(id)
  }

  return {
    yearFrom,
    yearTo,
    window,
    minRating: rating !== undefined && (ratingSteps as readonly number[]).includes(rating) ? rating : undefined,
    language: /^[a-z]{2,3}$/.test(lang) ? lang : undefined,
    providers: providers.slice(0, 24),
  }
}

/** The link's side of the filters. Unset parts are left out, so the default Explore address stays bare. */
export function filtersToSearch(f: ExploreFilters): FilterSearch {
  const out: FilterSearch = {}
  if (f.window) out.window = f.window
  else {
    if (f.yearFrom !== undefined) out.from = f.yearFrom
    if (f.yearTo !== undefined) out.to = f.yearTo
  }
  if (f.minRating !== undefined) out.rating = f.minRating
  if (f.language) out.lang = f.language
  if (f.providers.length) out.providers = f.providers.join(',')
  return out
}

// MARK: TMDB Discover

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

// MARK: The summary

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
