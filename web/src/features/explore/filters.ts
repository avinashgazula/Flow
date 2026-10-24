/* Explore's filters, as the apps' DiscoverQuery sheet: when it was released, how well it's rated, the
   language it was made in and where it streams. Pure: the address, the sheet and TMDB's Discover
   parameters (filterQuery.ts) are all derived from one small object, so the three can't drift apart.
   This file is only what the route needs at first load to read an address; keep it small. */

export const releaseWindows = [
  { id: 'last30', label: 'Last 30 Days', from: -30, to: 0 },
  { id: 'last90', label: 'Last 90 Days', from: -90, to: 0 },
  { id: 'next30', label: 'Next 30 Days', from: 0, to: 30 },
  { id: 'next180', label: 'Next 6 Months', from: 0, to: 180 },
] as const

export type ReleaseWindow = (typeof releaseWindows)[number]['id']

/** The ratings the sheet offers, "5+" to "9+" (TMDB's vote average is out of ten). */
export const ratingSteps = [5, 6, 7, 8, 9] as const

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
  providers?: string | number
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
  // One id as a number: the router writes a numeric-looking string quoted ("8"), which reads badly in a link.
  if (f.providers.length) out.providers = f.providers.length === 1 ? f.providers[0] : f.providers.join(',')
  return out
}
