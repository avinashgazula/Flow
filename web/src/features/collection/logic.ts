import type { MediaItem } from '../../lib/tmdb/types'

/** "2 films", "1 film". */
export const filmCount = (n: number) => `${n} ${n === 1 ? 'film' : 'films'}`

/** The years a collection spans, "2021 – 2024", or one year when they are the same; nothing when no film has a date. */
export function yearSpan(parts: readonly Pick<MediaItem, 'year'>[]): string | undefined {
  const years = parts.map((p) => p.year).filter((y): y is number => y !== undefined)
  if (years.length === 0) return undefined
  const first = Math.min(...years)
  const last = Math.max(...years)
  return first === last ? String(first) : `${first} – ${last}`
}
