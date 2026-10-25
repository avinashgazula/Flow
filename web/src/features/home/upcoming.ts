import type { Episode, MediaItem } from '../../lib/tmdb/types'
import { formatShortDay } from '../../lib/time'

/* The Upcoming shelf: the next episodes of shows the viewer follows, and season premieres from the
   watchlist. As FlowKit's UpcomingBuilder, for series; the website leaves films to the Calendar. Pure: Home
   gathers each show's detail, and this picks and orders. */

const day = 24 * 60 * 60_000
const localDay = (iso: string) => {
  const [y = 1970, m = 1, d = 1] = iso.split('-').map(Number)
  return new Date(y, m - 1, d).getTime()
}

export interface UpcomingShow {
  item: MediaItem
  nextEpisode?: Pick<Episode, 'season' | 'number' | 'name' | 'airDate' | 'id'>
  /** Everything that has aired is watched, and something has been. */
  caughtUp: boolean
  onWatchlist: boolean
}

export interface UpcomingEntry {
  id: string
  item: MediaItem
  episode: { season: number; number: number; name: string }
  /** Local midnight of the air day. */
  date: number
  /** A season's first episode is a premiere. */
  kind: 'episode' | 'premiere'
}

/** Entries from today through `withinDays` days out, soonest first. A show the viewer is caught up on lists its
 *  next episode; with `includeWatchlistPremieres`, a watchlisted show that is not caught up lists a season
 *  premiere too. */
export function buildUpcoming(shows: readonly UpcomingShow[], now: number, opts: { withinDays: number; includeWatchlistPremieres: boolean }): UpcomingEntry[] {
  const start = new Date(now).setHours(0, 0, 0, 0)
  const end = now + opts.withinDays * day
  const seen = new Set<string>()
  const entries: UpcomingEntry[] = []
  for (const show of shows) {
    const next = show.nextEpisode
    if (!next?.airDate) continue
    const date = localDay(next.airDate)
    if (date < start || date > end) continue
    const premiere = next.number === 1
    if (!show.caughtUp && !(opts.includeWatchlistPremieres && show.onWatchlist && premiere)) continue
    const id = `${show.item.type}:${show.item.id}:s${next.season}e${next.number}`
    if (seen.has(id)) continue
    seen.add(id)
    entries.push({ id, item: show.item, episode: { season: next.season, number: next.number, name: next.name }, date, kind: premiere ? 'premiere' : 'episode' })
  }
  return entries.sort((a, b) => a.date - b.date || a.item.title.localeCompare(b.item.title))
}

/** The air day as the strip prints it: "Today", "Tomorrow", else "Tue 27". */
export function airLabel(date: number, now: number, locale?: string): string {
  const days = Math.round((date - new Date(now).setHours(0, 0, 0, 0)) / day)
  if (days <= 0) return 'Today'
  if (days === 1) return 'Tomorrow'
  return formatShortDay(date, locale)
}

/** The same for a screen reader: "today", "tomorrow", "on Tuesday 27 October". */
export function airSpoken(date: number, now: number, locale?: string): string {
  const days = Math.round((date - new Date(now).setHours(0, 0, 0, 0)) / day)
  if (days <= 0) return 'today'
  if (days === 1) return 'tomorrow'
  return `on ${new Intl.DateTimeFormat(locale, { weekday: 'long', day: 'numeric', month: 'long' }).format(date)}`
}
