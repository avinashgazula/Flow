import { rank, type PrintPart } from '../../components/stripLayout'
import type { IcsEvent } from '../../lib/ics'
import type { Library } from '../../lib/store/library'
import type { Episode, MediaDetail, MediaItem } from '../../lib/tmdb/types'
import { day, episodeId, filmDate, filmId, localDay, startOfDay, type FilmDateKind, type UpcomingFilm } from '../home/upcoming'

/* The Upcoming page, as the apps' Calendar: what is new and what is next from the shows and films the viewer follows,
   day by day. This file decides which shows to ask about, which of their episodes and films fall in the window, how
   they group into days and what each says. The page fetches the details; everything else is here, in pure functions. */

/** A week back (Just Aired), six weeks ahead for episodes, a year ahead for films. */
export const span = { pastDays: 7, futureDays: 45, filmDays: 365 } as const
/** How many followed shows are asked about. */
export const maxShows = 40

export interface CalendarEntry {
  id: string
  item: MediaItem
  /** Absent for a film. */
  episode?: { season: number; number: number; name: string; overview?: string; still?: string }
  /** The day, as TMDB gives it: "2026-10-27". */
  iso: string
  /** Local midnight of that day. */
  date: number
  /** For a film, the release it is dated by. */
  release?: FilmDateKind
}

/** Whether the day is today or earlier: out already. A day, not a moment, is all TMDB gives. */
export const hasAired = (entry: Pick<CalendarEntry, 'date'>, now: number) => entry.date <= startOfDay(now)

/** The shows worth following: Continue Watching, the watchlist, favourites and History, each once, in that order. */
export function followedShowItems(library: Pick<Library, 'progress' | 'watchlist' | 'favourites' | 'history'>, max = maxShows): MediaItem[] {
  const seen = new Set<string>()
  const out: MediaItem[] = []
  const take = (key: string, item: MediaItem) => {
    if (item.type !== 'show' || seen.has(key)) return
    seen.add(key)
    out.push(item)
  }
  for (const p of Object.values(library.progress).sort((a, b) => b.updatedAt - a.updatedAt)) take(p.key, p.item)
  for (const e of library.watchlist) take(e.key, e.item)
  for (const e of library.favourites) take(e.key, e.item)
  for (const h of library.history) take(h.key, h.item)
  return out.slice(0, max)
}

const inWindow = (iso: string | undefined, now: number): iso is string => {
  if (!iso) return false
  const date = localDay(iso)
  const today = startOfDay(now)
  return date >= today - span.pastDays * day && date <= today + span.futureDays * day
}

type Airing = Pick<MediaDetail, 'nextEpisode' | 'lastEpisode'>

/** Whether the rest of the airing season is worth asking for: the next episode falls in the window. */
export const needsSeason = (detail: Airing | undefined, now: number): number | undefined => (detail?.nextEpisode && inWindow(detail.nextEpisode.airDate, now) ? detail.nextEpisode.season : undefined)

const entryOf = (item: MediaItem, e: Episode): CalendarEntry => ({
  id: episodeId(item, e),
  item,
  episode: { season: e.season, number: e.number, name: e.name, overview: e.overview || undefined, still: e.still },
  iso: e.airDate!,
  date: localDay(e.airDate!),
})

/** A show's episodes in the window: the rest of the airing season when it is known, else just the next one, and the
 *  last one aired if it was within the week. */
export function showEntries(item: MediaItem, detail: Airing | undefined, season: readonly Episode[] | undefined, now: number): CalendarEntry[] {
  if (!detail) return []
  const found: Episode[] = []
  const next = detail.nextEpisode
  if (next && inWindow(next.airDate, now)) {
    const list = season?.length ? season : [next]
    found.push(...list.filter((e) => e.season === next.season && inWindow(e.airDate, now)))
    if (!found.some((e) => e.number === next.number)) found.push(next)
  }
  const last = detail.lastEpisode
  if (last && inWindow(last.airDate, now) && !found.some((e) => e.season === last.season && e.number === last.number)) found.push(last)
  return found.filter((e) => e.airDate).map((e) => entryOf(item, e))
}

/** Watchlisted films in the window, dated by the chosen release. Films reach a year ahead; a film out in the last
 *  week is Just Aired. */
export function filmEntries(films: readonly UpcomingFilm[], kind: FilmDateKind, region: string | undefined, now: number): CalendarEntry[] {
  const today = startOfDay(now)
  const out: CalendarEntry[] = []
  for (const film of films) {
    const iso = filmDate(film, kind, region)
    if (!iso) continue
    const date = localDay(iso)
    if (date < today - span.pastDays * day || date > today + span.filmDays * day) continue
    out.push({ id: filmId(film.item), item: film.item, iso, date, release: kind })
  }
  return out
}

/** Soonest first, then by title. */
export const sortEntries = (entries: readonly CalendarEntry[]) => [...entries].sort((a, b) => a.date - b.date || a.item.title.localeCompare(b.item.title))

export interface CalendarDay {
  date: number
  iso: string
  entries: CalendarEntry[]
}

export interface Calendar {
  /** The last seven days, most recent first. */
  justAired: CalendarEntry[]
  /** Today onward, a section for each day with something on. */
  days: CalendarDay[]
}

/** Entries split at today: the week behind is Just Aired, the rest groups into days. */
export function arrange(entries: readonly CalendarEntry[], now: number): Calendar {
  const today = startOfDay(now)
  const sorted = sortEntries(entries)
  const byDay = new Map<number, CalendarDay>()
  for (const e of sorted) {
    if (e.date < today) continue
    const have = byDay.get(e.date)
    if (have) have.entries.push(e)
    else byDay.set(e.date, { date: e.date, iso: e.iso, entries: [e] })
  }
  return { justAired: sorted.filter((e) => e.date < today).reverse(), days: [...byDay.values()] }
}

/** The day strip: today and the thirteen after it, as local midnights, each marked when something is on. Stepping by
 *  the calendar rather than by 24 hours keeps a daylight-saving change from shifting the days. */
export function stripDays(now: number, marked: ReadonlySet<number>, count = 14): { date: number; today: boolean; marked: boolean }[] {
  const today = new Date(startOfDay(now))
  return Array.from({ length: count }, (_, i) => {
    const date = new Date(today.getFullYear(), today.getMonth(), today.getDate() + i).getTime()
    return { date, today: i === 0, marked: marked.has(date) }
  })
}

/** "Today", "Tomorrow", "Yesterday", a weekday within a week either way, else "Oct 30". */
export function relativeDay(date: number, now: number, locale?: string): string {
  const days = Math.round((date - startOfDay(now)) / day)
  if (days === 0) return 'Today'
  if (days === 1) return 'Tomorrow'
  if (days === -1) return 'Yesterday'
  if ((days >= 2 && days <= 6) || (days <= -2 && days >= -6)) return new Intl.DateTimeFormat(locale, { weekday: 'long' }).format(date)
  return new Intl.DateTimeFormat(locale, { month: 'short', day: 'numeric' }).format(date)
}

/** "Tuesday, October 27". */
export const fullDate = (date: number, locale?: string) => new Intl.DateTimeFormat(locale, { weekday: 'long', month: 'long', day: 'numeric' }).format(date)

/** What is special about an entry, if anything: a premiere, a film's day, or a new episode. */
export function label(entry: CalendarEntry, now: number): string | undefined {
  const { episode } = entry
  const aired = hasAired(entry, now)
  if (!episode) return aired ? 'Out Now' : 'Release'
  if (episode.number === 1) return episode.season === 1 ? 'Series Premiere' : 'Season Premiere'
  return aired ? 'New' : undefined
}

/** The line under the title: the episode's name, or a film's year and which release it is. */
export function meta(entry: CalendarEntry): string {
  if (entry.episode) return entry.episode.name
  return [entry.item.year, entry.release === 'theatrical' ? 'In cinemas' : 'Digital release'].filter(Boolean).join(' · ')
}

export const code = (e: { season: number; number: number }) => `S${e.season} E${e.number}`

/** The edge print under an entry's still, as the apps' EdgePrint.calendar: the episode (or "Film"), what is special
 *  about it, and the day when the row isn't already under a day's heading. A new episode you can watch now carries its
 *  label as the key fact (yellow); one you have seen says Watched in plain print. */
export function stripPrint(entry: CalendarEntry, opts: { now: number; watched: boolean; day?: string }): PrintPart[] {
  const text = label(entry, opts.now)
  const parts: PrintPart[] = [{ text: entry.episode ? code(entry.episode) : 'Film', rank: rank.episode }]
  if (opts.watched) parts.push({ text: 'Watched', rank: rank.format })
  else if (text && hasAired(entry, opts.now)) parts.push({ key: text, rank: rank.left })
  else if (text) parts.push({ text, rank: rank.format })
  if (opts.day) parts.push({ text: opts.day, rank: rank.ends })
  return parts
}

/** What a screen reader says for an entry: "Breaking Bad, season 3 episode 7, New, Yesterday, watched". */
export function spoken(entry: CalendarEntry, opts: { now: number; watched: boolean; day?: string }): string {
  const { item, episode } = entry
  const what = episode ? `${item.title}, season ${episode.season} episode ${episode.number}` : `${item.title}, film`
  return [what, label(entry, opts.now), opts.day, opts.watched ? 'watched' : undefined].filter(Boolean).join(', ')
}

// MARK: Add to Calendar

const tmdbPage = (entry: CalendarEntry) => {
  const { item, episode } = entry
  if (item.type === 'show') return episode ? `https://www.themoviedb.org/tv/${item.id}/season/${episode.season}/episode/${episode.number}` : `https://www.themoviedb.org/tv/${item.id}`
  return `https://www.themoviedb.org/movie/${item.id}`
}

/** The calendar event for an entry, as the apps title it: "Show — S2E5 · Episode Title", or "Film — in cinemas". The UID
 *  comes from the show and episode (or the film), so it is the same each time. */
export function icsEvent(entry: CalendarEntry): IcsEvent {
  const { item, episode } = entry
  const title = episode ? `${item.title} — S${episode.season}E${episode.number} · ${episode.name}` : `${item.title} — ${entry.release === 'theatrical' ? 'in cinemas' : 'out now'}`
  const description = (episode?.overview || item.overview || '').trim() || undefined
  return { uid: `${entry.id.replace(/[^a-z0-9]+/gi, '-')}@flow-web`, title, day: entry.iso, description, url: tmdbPage(entry) }
}

/** The file name for one entry, or for several. */
export const eventFileName = (entry: CalendarEntry) => (entry.episode ? `${entry.item.title} ${code(entry.episode).replace(' ', '')}` : entry.item.title)
