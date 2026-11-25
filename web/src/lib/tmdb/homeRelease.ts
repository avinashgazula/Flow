import type { MovieRelease } from './types'

/* Where a film is in its release, for the source picker: a title still in cinemas has no sources because nothing is
   out at home yet, not because something is broken. As FlowKit's HomeRelease. Pure: dates are calendar days
   ("2026-10-16"), compared as days, so a release counts from the first moment of its day. */

export type HomeReleaseStatus =
  /** A digital, physical or TV release has passed somewhere, so copies exist. */
  | { status: 'available' }
  /** Out in cinemas, with no home release yet; `digitalOn` is the next home date TMDB knows of. */
  | { status: 'inCinemas'; since: string; digitalOn: string | null }
  /** Not out anywhere yet; `on` is the first cinema date TMDB lists. */
  | { status: 'upcoming'; on: string | null }
  /** No release data at all: callers keep their ordinary wording. */
  | { status: 'unknown' }

/** TMDB's release types: 1 premiere, 2 limited theatrical, 3 theatrical, 4 digital, 5 physical, 6 TV. */
const isHome = (type: number) => type === 4 || type === 5 || type === 6
const isCinema = (type: number) => type === 1 || type === 2 || type === 3

/** A home release in any country counts as available, since a copy made anywhere plays anywhere; the viewer's `region`
 *  only picks which cinema and digital dates are named. `now` is the viewer's day. */
export function homeReleaseStatus(releases: readonly MovieRelease[], region: string | undefined, now: string): HomeReleaseStatus {
  if (releases.length === 0) return { status: 'unknown' }
  if (releases.some((r) => isHome(r.type) && r.date <= now)) return { status: 'available' }

  const earliest = (list: readonly MovieRelease[]): string | null => {
    const local = region ? list.filter((r) => r.country === region) : []
    const dates = (local.length ? local : list).map((r) => r.date).sort()
    return dates[0] ?? null
  }
  const cinema = releases.filter((r) => isCinema(r.type))
  const since = earliest(cinema.filter((r) => r.date <= now))
  if (since) {
    const ahead = releases.filter((r) => r.date > now)
    return { status: 'inCinemas', since, digitalOn: earliest(ahead.filter((r) => r.type === 4)) ?? earliest(ahead.filter((r) => r.type === 5)) }
  }
  return { status: 'upcoming', on: earliest(cinema) }
}

/** A day as "October 16", or "October 16, 2027" when it isn't this year, in the viewer's locale. TMDB's days have no
 *  time zone, so the day is formatted as it was written. */
export function formatReleaseDay(day: string, now: string, locale?: string): string {
  const [y = 1970, m = 1, d = 1] = day.split('-').map(Number)
  const sameYear = day.slice(0, 4) === now.slice(0, 4)
  return new Intl.DateTimeFormat(locale, { month: 'long', day: 'numeric', ...(sameYear ? {} : { year: 'numeric' }), timeZone: 'UTC' }).format(Date.UTC(y, m - 1, d))
}

/** What the source picker says when its search found nothing, or undefined to keep the ordinary wording.
 *  The words are the apps' too. */
export function noSourcesNotice(status: HomeReleaseStatus, now: string, locale?: string): { title: string; text: string } | undefined {
  const on = (day: string) => formatReleaseDay(day, now, locale)
  if (status.status === 'inCinemas') {
    const text = `In cinemas since ${on(status.since)}. It has no digital release yet, so your sources don't have it.`
    return { title: 'In Cinemas', text: status.digitalOn ? `${text} Digital release on ${on(status.digitalOn)}.` : text }
  }
  if (status.status === 'upcoming') return { title: 'Not Out Yet', text: status.on ? `Comes to cinemas on ${on(status.on)}.` : 'Release date not announced.' }
  return undefined
}
