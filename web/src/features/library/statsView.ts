import type { Bucket, WatchStats } from '../../lib/stats'

/* The words and proportions Stats puts on screen, apart from the page so they are tested. */

const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString()} ${n === 1 ? one : many}`

/** What the time was spent on: "12 films and 183 episodes of 14 shows", "3 films", "5 episodes of 2 shows". */
export function leadSentence(stats: Pick<WatchStats, 'filmsWatched' | 'episodesWatched' | 'showsWatched'>): string {
  const parts: string[] = []
  if (stats.filmsWatched > 0) parts.push(plural(stats.filmsWatched, 'film'))
  if (stats.episodesWatched > 0) parts.push(`${plural(stats.episodesWatched, 'episode')} of ${plural(stats.showsWatched, 'show')}`)
  return parts.join(' and ')
}

/** Bar heights from 0 to 1 against the tallest; anything watched shows at least a sliver. */
export function bars(histogram: readonly Bucket[]): number[] {
  const tallest = Math.max(0, ...histogram.map((b) => b.minutes))
  return histogram.map((b) => (b.minutes <= 0 || tallest <= 0 ? 0 : Math.max(0.03, b.minutes / tallest)))
}

/** Which bars carry an axis label: all of them, or every third once there are more than twelve. */
export const shownLabels = (count: number): boolean[] => Array.from({ length: count }, (_, i) => count <= 12 || i % 3 === 0)

/** The first day of the week for a locale, 0 Sunday to 6 Saturday; Monday where the browser can't say. */
export function firstWeekday(locale?: string): number {
  try {
    const l = new Intl.Locale(locale ?? 'en-US') as Intl.Locale & { weekInfo?: { firstDay: number }; getWeekInfo?: () => { firstDay: number } }
    const first = l.getWeekInfo?.().firstDay ?? l.weekInfo?.firstDay
    // Intl numbers the week from Monday as 1 to Sunday as 7.
    return first === undefined ? 1 : first % 7
  } catch {
    return 1
  }
}

export interface HabitLine {
  label: string
  value: string
  detail?: string
}

/** The longest streak, with its dates when it was more than a day, and the favourite weekday. */
export function habitLines(stats: Pick<WatchStats, 'period' | 'longestStreak' | 'longestStreakStart' | 'longestStreakEnd' | 'busiestWeekday'>, locale?: string): HabitLine[] {
  const format = new Intl.DateTimeFormat(locale, stats.period === 'allTime' ? { month: 'short', day: 'numeric', year: 'numeric' } : { month: 'short', day: 'numeric' })
  const range = stats.longestStreak > 1 && stats.longestStreakStart !== undefined && stats.longestStreakEnd !== undefined ? `${format.format(stats.longestStreakStart)} – ${format.format(stats.longestStreakEnd)}` : undefined
  const weekday = stats.busiestWeekday === undefined ? undefined : new Intl.DateTimeFormat(locale, { weekday: 'long' }).format(new Date(2023, 0, 1 + stats.busiestWeekday))
  return [
    { label: 'Longest Streak', value: plural(stats.longestStreak, 'day'), detail: range },
    { label: 'Favourite Day', value: weekday ?? '–', detail: weekday ? 'Most watch time' : undefined },
  ]
}
