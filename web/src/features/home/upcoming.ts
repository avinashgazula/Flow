import type { Episode, MediaItem, MovieRelease } from '../../lib/tmdb/types'
import { formatShortDay } from '../../lib/time'

/* What is coming up: the next episodes of shows the viewer follows, season premieres from the watchlist, and
   watchlisted films about to come out. As FlowKit's UpcomingBuilder. Pure: Home and the Upcoming page gather each
   show's and film's details, and this picks and orders. */

export const day = 24 * 60 * 60_000
/** TMDB dates are calendar days, not instants: read one as local midnight. */
export const localDay = (iso: string) => {
  const [y = 1970, m = 1, d = 1] = iso.split('-').map(Number)
  return new Date(y, m - 1, d).getTime()
}
export const startOfDay = (ms: number) => new Date(ms).setHours(0, 0, 0, 0)

/** Which release a film is dated by (Settings → Shelves → Film Dates; the apps' FilmDateKind). */
export type FilmDateKind = 'digital' | 'theatrical'
export const filmDateKinds: { value: FilmDateKind; label: string }[] = [
  { value: 'digital', label: 'Digital Release' },
  { value: 'theatrical', label: 'Theatrical Release' },
]

export interface UpcomingShow {
  item: MediaItem
  nextEpisode?: Pick<Episode, 'season' | 'number' | 'name' | 'airDate' | 'id'>
  /** Everything that has aired is watched, and something has been. */
  caughtUp: boolean
  onWatchlist: boolean
}

/** A watchlisted film with its per-country release dates. */
export interface UpcomingFilm {
  item: MediaItem
  releases: readonly MovieRelease[]
}

export interface UpcomingEntry {
  id: string
  item: MediaItem
  /** Absent for a film. */
  episode?: { season: number; number: number; name: string }
  /** Local midnight of the air day. */
  date: number
  /** A season's first episode is a premiere. */
  kind: 'episode' | 'premiere' | 'film'
  /** For a film, the release it is dated by. */
  release?: FilmDateKind
}

/** TMDB's release types: 1 premiere, 2 limited theatrical, 3 theatrical, 4 digital, 5 physical, 6 TV. */
const typesOf = (kind: FilmDateKind) => (kind === 'digital' ? [4] : [2, 3])

/** The day a film counts as out: its digital release, or its theatrical one. Prefers the viewer's region, then any
 *  country. Without release data, a theatrical date falls back to the date on the item itself; a digital one has no
 *  such fallback. As FlowKit's UpcomingBuilder.filmDate. */
export function filmDate(film: UpcomingFilm, kind: FilmDateKind, region?: string): string | undefined {
  const matching = film.releases.filter((r) => typesOf(kind).includes(r.type))
  const local = region ? matching.filter((r) => r.country === region) : []
  const candidates = local.length ? local : matching
  const earliest = candidates.map((r) => r.date).sort()[0]
  return earliest ?? (kind === 'theatrical' ? film.item.date : undefined)
}

export interface UpcomingOptions {
  withinDays: number
  includeWatchlistPremieres: boolean
  filmDates?: FilmDateKind
  region?: string
}

/** Entries from today through `withinDays` days out, soonest first. A show the viewer is caught up on lists its
 *  next episode; with `includeWatchlistPremieres`, a watchlisted show that is not caught up lists a season
 *  premiere too, and watchlisted films that are not out yet are listed on the day they come out. */
export function buildUpcoming(shows: readonly UpcomingShow[], now: number, opts: UpcomingOptions, films: readonly UpcomingFilm[] = []): UpcomingEntry[] {
  const start = startOfDay(now)
  const end = now + opts.withinDays * day
  const seen = new Set<string>()
  const entries: UpcomingEntry[] = []
  const add = (entry: UpcomingEntry) => {
    if (seen.has(entry.id)) return
    seen.add(entry.id)
    entries.push(entry)
  }
  for (const show of shows) {
    const next = show.nextEpisode
    if (!next?.airDate) continue
    const date = localDay(next.airDate)
    if (date < start || date > end) continue
    const premiere = next.number === 1
    if (!show.caughtUp && !(opts.includeWatchlistPremieres && show.onWatchlist && premiere)) continue
    add({ id: episodeId(show.item, next), item: show.item, episode: { season: next.season, number: next.number, name: next.name }, date, kind: premiere ? 'premiere' : 'episode' })
  }
  if (opts.includeWatchlistPremieres) {
    const release = opts.filmDates ?? 'digital'
    for (const film of films) {
      const iso = filmDate(film, release, opts.region)
      if (!iso) continue
      const date = localDay(iso)
      if (date < start || date > end) continue
      add({ id: filmId(film.item), item: film.item, date, kind: 'film', release })
    }
  }
  return entries.sort((a, b) => a.date - b.date || a.item.title.localeCompare(b.item.title))
}

/** The watchlisted films worth asking about: ones with no date yet, or whose theatrical date is within the span a
 *  film can still be waiting for its digital release (about half a year after) or its cinema release (a year ahead).
 *  Most recently added first, at most `max`. */
export function filmCandidates(watchlist: readonly { item: MediaItem }[], now: number, max: number): MediaItem[] {
  return watchlist
    .map((e) => e.item)
    .filter((item) => {
      if (item.type !== 'movie') return false
      if (!item.date) return true
      const when = localDay(item.date)
      return when >= now - 200 * day && when <= now + 400 * day
    })
    .slice(0, max)
}

export const episodeId = (item: MediaItem, e: Pick<Episode, 'season' | 'number'>) => `${item.type}:${item.id}:s${e.season}e${e.number}`
export const filmId = (item: MediaItem) => `${item.type}:${item.id}`

/** The air day as the strip prints it: "Today", "Tomorrow", else "Tue 27". */
export function airLabel(date: number, now: number, locale?: string): string {
  const days = Math.round((date - startOfDay(now)) / day)
  if (days <= 0) return 'Today'
  if (days === 1) return 'Tomorrow'
  return formatShortDay(date, locale)
}

/** The same for a screen reader: "today", "tomorrow", "on Tuesday 27 October". */
export function airSpoken(date: number, now: number, locale?: string): string {
  const days = Math.round((date - startOfDay(now)) / day)
  if (days <= 0) return 'today'
  if (days === 1) return 'tomorrow'
  return `on ${new Intl.DateTimeFormat(locale, { weekday: 'long', day: 'numeric', month: 'long' }).format(date)}`
}
