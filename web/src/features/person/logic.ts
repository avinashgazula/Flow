import type { MediaItem, MediaType } from '../../lib/tmdb/types'

/** TMDB gives birthdays as bare days. Read as UTC dates and compared with today's local date as a
 *  UTC day, so the age turns over on the birthday itself in every time zone (as PersonView). */
const utcDay = (date: string) => {
  const [y, m, d] = date.split('-').map(Number)
  return y && m && d ? { y, m, d } : undefined
}

export function age(birthday: string, today = new Date()): number | undefined {
  const b = utcDay(birthday)
  if (!b) return undefined
  const y = today.getFullYear()
  const m = today.getMonth() + 1
  const d = today.getDate()
  const years = y - b.y - (m < b.m || (m === b.m && d < b.d) ? 1 : 0)
  return years >= 0 ? years : undefined
}

export function formatDay(date: string, locale?: string): string | undefined {
  const b = utcDay(date)
  if (!b) return undefined
  return new Date(Date.UTC(b.y, b.m - 1, b.d)).toLocaleDateString(locale, { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' })
}

/** "Born 12 April 1985 (age 41) · Los Angeles, California" */
export function lifeLine(person: { birthday?: string; placeOfBirth?: string }, today = new Date(), locale?: string): string | undefined {
  const parts: string[] = []
  if (person.birthday) {
    const day = formatDay(person.birthday, locale)
    const years = age(person.birthday, today)
    if (day) parts.push(years !== undefined ? `Born ${day} (age ${years})` : `Born ${day}`)
  }
  if (person.placeOfBirth) parts.push(person.placeOfBirth)
  return parts.length ? parts.join(' · ') : undefined
}

export type CreditSort = 'year' | 'popular'
export const creditSorts = [
  { id: 'year', label: 'Newest' },
  { id: 'popular', label: 'Popular' },
] as const

/** The filmography, one type or both. "Popular" keeps the client's ranking (rating weighted by
 *  age); "Newest" is by release date, undated titles last, as PersonView sorts it. */
export function filmography(credits: MediaItem[], type: MediaType | undefined, sort: CreditSort): MediaItem[] {
  const list = type ? credits.filter((c) => c.type === type) : [...credits]
  if (sort === 'popular') return list
  const key = (m: MediaItem) => m.date ?? (m.year ? String(m.year) : '0000')
  return list.sort((a, b) => key(b).localeCompare(key(a)))
}
