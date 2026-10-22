import type { MediaItem, SearchResult } from '../../lib/tmdb/types'

export type MediaResult = Extract<SearchResult, { kind: 'media' }>
export type PersonResult = Extract<SearchResult, { kind: 'person' }>

/** Searches start at two characters: one letter matches half the catalogue. */
export const minimumQuery = 2

/** The first title, when it's a confident match: its name starts with what was typed, or a word in
 *  it does. As SearchView.topResult on the other platforms. */
export function topResult(results: SearchResult[], text: string): MediaResult | undefined {
  const query = text.trim().toLowerCase()
  const first = results.find((r): r is MediaResult => r.kind === 'media')
  if (!first || query.length < 3 || !first.poster) return undefined
  const title = first.title.toLowerCase()
  return title.startsWith(query) || title.includes(` ${query}`) ? first : undefined
}

/** Results split into rows, leaving out the top result, which the card above already shows. */
export function groupResults(results: SearchResult[], top?: MediaItem) {
  const movies: MediaResult[] = []
  const shows: MediaResult[] = []
  const people: PersonResult[] = []
  for (const r of results) {
    if (r.kind === 'person') people.push(r)
    else if (top && r.type === top.type && r.id === top.id) continue
    else (r.type === 'movie' ? movies : shows).push(r)
  }
  return { movies, shows, people }
}

/** Puts a search at the front of the recent list, once, ignoring case, and keeps the list short. */
export function pushRecent(list: string[], term: string, max = 10): string[] {
  const t = term.trim()
  if (t.length < minimumQuery) return list
  return [t, ...list.filter((x) => x.toLowerCase() !== t.toLowerCase())].slice(0, max)
}

// MARK: Arrow keys across results

export interface Box {
  left: number
  top: number
  right: number
  bottom: number
}

export type Direction = 'left' | 'right' | 'up' | 'down'

/** Which box an arrow key moves to from box `from`, judged by where they are on screen, so a wrapped grid, a
 *  list and a lone top result all walk the way they look. Left and right stay in the row the two share; up
 *  and down go to the nearest row in that direction, then the nearest column. */
export function neighbour(boxes: Box[], from: number, direction: Direction): number | undefined {
  const cur = boxes[from]
  if (!cur) return undefined
  const centre = (b: Box) => (b.left + b.right) / 2
  let best: number | undefined
  let bestScore = Infinity
  boxes.forEach((b, i) => {
    if (i === from) return
    const sharesRow = b.top < cur.bottom && b.bottom > cur.top
    let score: number
    if (direction === 'right' || direction === 'left') {
      const gap = direction === 'right' ? b.left - cur.right : cur.left - b.right
      if (!sharesRow || gap < -2) return
      score = Math.abs(gap)
    } else {
      const gap = direction === 'down' ? b.top - cur.top : cur.top - b.top
      // The same row (within a few pixels) is not above or below.
      if (gap <= 4 || sharesRow) return
      score = Math.round(gap / 8) * 10_000 + Math.abs(centre(b) - centre(cur))
    }
    if (score < bestScore) {
      bestScore = score
      best = i
    }
  })
  return best
}
