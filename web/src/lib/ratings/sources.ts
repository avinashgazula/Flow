import type { MediaType } from '../tmdb/types'

/* The scores a title page can show, as FlowKit's RatingSource, Ratings and RatingLinks. The apps also list
   MyAnimeList, which has no score source in either build, so the website leaves it out. */

export const ratingSources = ['imdb', 'tomatometer', 'popcornmeter', 'metacritic', 'tmdb', 'letterboxd', 'trakt'] as const
export type RatingSource = (typeof ratingSources)[number]

const titles: Record<RatingSource, string> = {
  imdb: 'IMDb',
  tomatometer: 'Rotten Tomatoes',
  popcornmeter: 'Popcornmeter',
  metacritic: 'Metacritic',
  tmdb: 'TMDB',
  letterboxd: 'Letterboxd',
  trakt: 'Trakt',
}
export const ratingTitle = (source: RatingSource) => titles[source]

/** What each source has for a title; a missing one is left out of the row. As FlowKit's `Ratings`. */
export interface Ratings {
  imdb?: number
  imdbVotes?: number
  /** Rotten Tomatoes critics, a whole percentage. */
  tomatometer?: number
  /** Rotten Tomatoes audience, a whole percentage. */
  popcornmeter?: number
  metacritic?: number
  tmdb?: number
  tmdbVotes?: number
  /** Out of 5. */
  letterboxd?: number
  trakt?: number
}

const isSource = (v: unknown): v is RatingSource => (ratingSources as readonly unknown[]).includes(v)

/** The scores to show, in order, from the saved list. Unknown names (a newer app's) are dropped; a missing list is
 *  every source, as the apps' default. Duplicates keep their first place. */
export function shownSources(saved: readonly unknown[] | undefined): RatingSource[] {
  if (!saved) return [...ratingSources]
  return [...new Set(saved.filter(isSource))]
}

/** The score as printed under its name: one decimal for IMDb, TMDB and Letterboxd, a percentage for Rotten Tomatoes,
 *  Popcornmeter and Trakt, a whole number for Metacritic. Undefined when the source has no score. */
export function scoreText(source: RatingSource, ratings: Ratings): string | undefined {
  const v = ratings[source]
  if (v === undefined || !Number.isFinite(v)) return undefined
  switch (source) {
    case 'imdb':
    case 'letterboxd':
      return v.toFixed(1)
    case 'tmdb':
      return v > 0 ? v.toFixed(1) : undefined
    case 'metacritic':
      return String(Math.round(v))
    default:
      return `${Math.round(v)}%`
  }
}

/** What a screen reader says for a score: the site and its scale, so "78" is heard as "Metacritic, 78 out of 100". */
export function spokenScore(source: RatingSource, text: string): string {
  const n = text.replace('%', '')
  switch (source) {
    case 'imdb':
    case 'tmdb':
      return `${titles[source]}, ${n} out of 10`
    case 'letterboxd':
      return `${titles[source]}, ${n} out of 5`
    case 'metacritic':
      return `${titles[source]}, ${n} out of 100`
    case 'tomatometer':
      return `Rotten Tomatoes critics, ${n} percent`
    case 'popcornmeter':
      return 'Rotten Tomatoes audience, ' + n + ' percent'
    default:
      return `${titles[source]}, ${n} percent`
  }
}

/** Every source with the shown ones first, in their order, then the hidden ones in the apps' order: what Settings lists,
 *  so an arrow only ever reorders what is on screen. */
export const orderedSources = (shown: readonly RatingSource[]): RatingSource[] => [...shown, ...ratingSources.filter((s) => !shown.includes(s))]

/** One place up or down among the shown scores; the list as it was if the source is hidden or already at that end. */
export function moveSource(shown: readonly RatingSource[], source: RatingSource, direction: -1 | 1): RatingSource[] {
  const from = shown.indexOf(source)
  const to = from + direction
  if (from < 0 || to < 0 || to >= shown.length) return [...shown]
  const out = [...shown]
  ;[out[from], out[to]] = [out[to]!, out[from]!]
  return out
}

/** A shown score is hidden; a hidden one joins the end of the shown ones. */
export const toggleSource = (shown: readonly RatingSource[], source: RatingSource): RatingSource[] => (shown.includes(source) ? shown.filter((s) => s !== source) : [...shown, source])

export const isDefaultSources = (shown: readonly RatingSource[]) => shown.length === ratingSources.length && shown.every((s, i) => s === ratingSources[i])

/** What a link needs to know of a title. */
export interface LinkTarget {
  type: MediaType
  title: string
  tmdb?: number
  imdb?: string
}

/** Where a score leads: the site's own page for the title, as FlowKit's RatingLinks. Undefined when the site can't be
 *  reached from what is known (no IMDb id, or a series for Letterboxd, which lists only films). */
export function ratingLink(source: RatingSource, t: LinkTarget): string | undefined {
  const imdb = t.imdb?.trim() || undefined
  const name = encodeURIComponent(t.title)
  switch (source) {
    case 'imdb':
      return imdb && `https://www.imdb.com/title/${imdb}/reviews`
    case 'tomatometer':
    case 'popcornmeter':
      return `https://www.rottentomatoes.com/search?search=${name}`
    case 'metacritic':
      return `https://www.metacritic.com/search/${name}/`
    case 'tmdb':
      return t.tmdb === undefined ? undefined : `https://www.themoviedb.org/${t.type === 'movie' ? 'movie' : 'tv'}/${t.tmdb}/reviews`
    case 'letterboxd':
      return t.type === 'movie' && imdb ? `https://letterboxd.com/imdb/${imdb}/` : undefined
    case 'trakt':
      return imdb && `https://trakt.tv/search/imdb/${imdb}`
  }
}
