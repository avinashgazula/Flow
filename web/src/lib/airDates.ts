/* The day an episode airs, as FlowKit's AirDateFormatting. Trakt's `first_aired` is a real moment in UTC, so an
   evening show reads a day late for a viewer in the Americas unless it is placed in their own day. TMDB and TVDB
   give a bare day with no time; that day is always shown as it is, since moving it would show the evening before. */

/** A bare day is midnight UTC (or no time at all): there is no moment to convert. */
export function isBareDay(moment: string): boolean {
  if (moment.length <= 10) return true
  const time = new Date(moment)
  return Number.isNaN(time.getTime()) || (time.getUTCHours() === 0 && time.getUTCMinutes() === 0 && time.getUTCSeconds() === 0)
}

/** "2026-10-21" for an air moment, or undefined for none. With `local` on, a moment with a time of day is dated in the
 *  viewer's time zone (`timeZone`, the browser's own when omitted); otherwise it is the UTC day the source gave. */
export function airDay(moment: string | null | undefined, local: boolean, timeZone?: string): string | undefined {
  if (!moment) return undefined
  const utcDay = moment.slice(0, 10)
  if (!local || isBareDay(moment)) return utcDay
  // en-CA writes year-month-day, which is the form the rest of the site compares.
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(moment))
}
