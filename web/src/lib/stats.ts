import { genreNames } from './genres'
import type { HistoryEntry } from './store/library'

/* Viewing statistics ("Your Year in Flow"), computed from watch history: a port of FlowKit's WatchStats, rule for
   rule. Pure and deterministic: days are the viewer's own local days, and `now` and the first day of the week are
   passed in so tests can pin them.

   - The same episode (or film) logged twice on one day counts once; a rewatch on another day counts again.
   - Watch time is the sum of runtimes. A play's own recorded length wins (History keeps it from this version on);
     older plays take their title's typical runtime from TMDB (`runtimeOf`); a title with neither falls back to
     `defaultEpisodeMinutes` / `defaultFilmMinutes`.
   - Entries dated after today are ignored. */

export type StatsPeriod = 'thisYear' | 'last30Days' | 'allTime'

export const statsPeriods: { id: StatsPeriod; label: string }[] = [
  { id: 'thisYear', label: 'This Year' },
  { id: 'last30Days', label: 'Last 30 Days' },
  { id: 'allTime', label: 'All Time' },
]

/** Assumed length of an episode, and of a film, whose runtime is unknown. */
export const defaultEpisodeMinutes = 45
export const defaultFilmMinutes = 110

export interface GenreShare {
  name: string
  minutes: number
  /** 0 to 1 of the minutes attributed to genres. A title with several genres counts towards each. */
  share: number
}

export interface ShowCount {
  key: string
  episodes: number
}

export type Granularity = 'week' | 'month' | 'year'

/** One bar of the histogram. */
export interface Bucket {
  /** Local midnight of the bucket's first day. */
  start: number
  minutes: number
  /** The bucket that contains today. */
  isCurrent: boolean
}

export interface WatchStats {
  period: StatsPeriod
  totalMinutes: number
  /** Distinct film plays (a film watched on two different days counts twice). */
  filmsWatched: number
  episodesWatched: number
  showsWatched: number
  topGenres: GenreShare[]
  mostWatchedShows: ShowCount[]
  /** Consecutive days with at least one watch. */
  longestStreak: number
  longestStreakStart?: number
  longestStreakEnd?: number
  /** 0 (Sunday) to 6: the weekday with the most watch time. */
  busiestWeekday?: number
  histogram: Bucket[]
  histogramGranularity: Granularity
  isEmpty: boolean
}

export interface StatsOptions {
  now?: number
  /** First day of the week for weekly bars: 0 Sunday to 6. The apps use the viewer's calendar; Monday by default. */
  weekStart?: number
  /** A title's typical runtime in minutes, as TMDB gives it (a series' episode length), for plays that recorded none. */
  runtimeOf?: (key: string) => number | undefined
}

const startOfDay = (ms: number) => new Date(ms).setHours(0, 0, 0, 0)
const addDays = (ms: number, n: number) => {
  const d = new Date(ms)
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n).getTime()
}
/** A local calendar day as a whole number, so two days are consecutive when their numbers differ by one, whatever
 *  daylight saving did to the hours between them. */
const dayNumber = (ms: number) => {
  const d = new Date(ms)
  return Math.round(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 86_400_000)
}

export function computeStats(period: StatsPeriod, entries: readonly HistoryEntry[], options: StatsOptions = {}): WatchStats {
  const now = options.now ?? Date.now()
  const weekStart = options.weekStart ?? 1
  const today = startOfDay(now)
  const yearStart = new Date(new Date(now).getFullYear(), 0, 1).getTime()
  const yearEnd = new Date(new Date(now).getFullYear() + 1, 0, 1).getTime()
  let lower: number | undefined
  let upper = addDays(today, 1)
  if (period === 'thisYear') {
    lower = yearStart
    upper = Math.min(upper, yearEnd)
  } else if (period === 'last30Days') lower = addDays(today, -29)

  // One play per title, episode and day. Newest first, which the show tie-break below relies on.
  interface Play {
    key: string
    show: boolean
    day: number
    minutes: number
    genres: string[]
  }
  const seen = new Set<string>()
  const plays: Play[] = []
  for (const e of [...entries].sort((a, b) => b.watchedAt - a.watchedAt)) {
    if (e.watchedAt >= upper || (lower !== undefined && e.watchedAt < lower)) continue
    const day = startOfDay(e.watchedAt)
    const id = `${e.key}|${e.episode ? `${e.episode.season}x${e.episode.episode}` : ''}|${day}`
    if (seen.has(id)) continue
    seen.add(id)
    const film = e.item.type === 'movie'
    const known = [e.runtime, options.runtimeOf?.(e.key)].find((m): m is number => typeof m === 'number' && m > 0)
    plays.push({ key: e.key, show: !film, day, minutes: known ?? (film ? defaultFilmMinutes : defaultEpisodeMinutes), genres: genreNames(e.item.genres ?? [], e.item.type) })
  }

  const totalMinutes = plays.reduce((n, p) => n + p.minutes, 0)
  const filmsWatched = plays.filter((p) => !p.show).length
  const episodePlays = plays.filter((p) => p.show)

  // Genres, by watch time. Ties by name.
  const genreMinutes = new Map<string, number>()
  for (const p of plays) for (const g of p.genres) genreMinutes.set(g, (genreMinutes.get(g) ?? 0) + p.minutes)
  const attributed = [...genreMinutes.values()].reduce((n, m) => n + m, 0)
  const topGenres = [...genreMinutes]
    .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
    .slice(0, 5)
    .map(([name, minutes]) => ({ name, minutes, share: attributed > 0 ? minutes / attributed : 0 }))

  // Shows, by episodes watched; ties go to the more recently watched show, then the key.
  const counts = new Map<string, number>()
  const recency = new Map<string, number>()
  episodePlays.forEach((p, i) => {
    counts.set(p.key, (counts.get(p.key) ?? 0) + 1)
    if (!recency.has(p.key)) recency.set(p.key, i)
  })
  const mostWatchedShows = [...counts]
    .sort((a, b) => b[1] - a[1] || recency.get(a[0])! - recency.get(b[0])! || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
    .slice(0, 5)
    .map(([key, episodes]) => ({ key, episodes }))

  // Streak: the longest run of consecutive calendar days.
  const days = [...new Set(plays.map((p) => p.day))].sort((a, b) => a - b)
  let bestLength = 0
  let bestStart: number | undefined
  let bestEnd: number | undefined
  let run = 0
  let runStart: number | undefined
  let previous: number | undefined
  for (const day of days) {
    if (previous !== undefined && dayNumber(day) - dayNumber(previous) === 1) run++
    else {
      run = 1
      runStart = day
    }
    if (run > bestLength) {
      bestLength = run
      bestStart = runStart
      bestEnd = day
    }
    previous = day
  }

  // Busiest weekday, by watch time (the earlier weekday wins a tie).
  const weekdayMinutes = new Map<number, number>()
  for (const p of plays) weekdayMinutes.set(new Date(p.day).getDay(), (weekdayMinutes.get(new Date(p.day).getDay()) ?? 0) + p.minutes)
  let busiestWeekday: number | undefined
  for (const [weekday, minutes] of [...weekdayMinutes].sort((a, b) => a[0] - b[0])) {
    if (busiestWeekday === undefined || minutes > weekdayMinutes.get(busiestWeekday)!) busiestWeekday = weekday
  }

  // Histogram: months for a year, weeks for 30 days, months (or years past two) for everything.
  const earliest = days[0]
  let granularity: Granularity
  if (period === 'thisYear') granularity = 'month'
  else if (period === 'last30Days') granularity = 'week'
  else granularity = earliest !== undefined && monthsBetween(earliest, now) > 24 ? 'year' : 'month'
  const bucketStart = (ms: number) => startOfBucket(ms, granularity, weekStart)
  const first = period === 'thisYear' ? yearStart : (lower ?? earliest)
  const histogram: Bucket[] = []
  if (first !== undefined) {
    // A year shows all twelve months, so the bars keep their place as the year fills in.
    const last = period === 'thisYear' ? yearEnd - 1 : now
    const currentStart = bucketStart(now)
    const byBucket = new Map<number, number>()
    for (const p of plays) byBucket.set(bucketStart(p.day), (byBucket.get(bucketStart(p.day)) ?? 0) + p.minutes)
    for (let cursor = bucketStart(first); cursor <= last; cursor = nextBucket(cursor, granularity)) {
      histogram.push({ start: cursor, minutes: byBucket.get(cursor) ?? 0, isCurrent: cursor === currentStart })
    }
  }

  return {
    period,
    totalMinutes,
    filmsWatched,
    episodesWatched: episodePlays.length,
    showsWatched: new Set(episodePlays.map((p) => p.key)).size,
    topGenres,
    mostWatchedShows,
    longestStreak: bestLength,
    longestStreakStart: bestStart,
    longestStreakEnd: bestEnd,
    busiestWeekday,
    histogram,
    histogramGranularity: granularity,
    isEmpty: filmsWatched + episodePlays.length === 0,
  }
}

/** Whole calendar months from `from` to `to`, as Calendar.dateComponents([.month]) counts them. */
function monthsBetween(from: number, to: number): number {
  const a = new Date(from)
  const b = new Date(to)
  let months = (b.getFullYear() - a.getFullYear()) * 12 + (b.getMonth() - a.getMonth())
  if (b.getDate() < a.getDate()) months--
  return months
}

function startOfBucket(ms: number, granularity: Granularity, weekStart: number): number {
  const d = new Date(ms)
  if (granularity === 'year') return new Date(d.getFullYear(), 0, 1).getTime()
  if (granularity === 'month') return new Date(d.getFullYear(), d.getMonth(), 1).getTime()
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() - ((d.getDay() - weekStart + 7) % 7)).getTime()
}

function nextBucket(start: number, granularity: Granularity): number {
  const d = new Date(start)
  if (granularity === 'year') return new Date(d.getFullYear() + 1, 0, 1).getTime()
  if (granularity === 'month') return new Date(d.getFullYear(), d.getMonth() + 1, 1).getTime()
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + 7).getTime()
}

/** "45 minutes", "20 hours" or "3 days 4 hours": the hero line. */
export function durationText(minutes: number): string {
  const unit = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`
  const hours = Math.floor(minutes / 60)
  if (hours >= 48) {
    const rest = hours % 24
    return rest === 0 ? unit(Math.floor(hours / 24), 'day') : `${unit(Math.floor(hours / 24), 'day')} ${unit(rest, 'hour')}`
  }
  if (hours >= 1) return unit(hours, 'hour')
  return unit(minutes, 'minute')
}

/** The line above the hero number. */
export const statsLead: Record<StatsPeriod, string> = {
  thisYear: 'This year you’ve watched',
  last30Days: 'In the last 30 days you’ve watched',
  allTime: 'In total you’ve watched',
}

export const histogramTitle: Record<Granularity, string> = { week: 'Hours by Week', month: 'Hours by Month', year: 'Hours by Year' }
