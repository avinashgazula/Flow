/* The facts printed under a title's artwork ("S3 E7 · 18M LEFT · ENDS 21:30 · 2160P · DV"). Every fact has a
   priority, and a line with less room than its facts loses the lowest first (the line wraps and its second row is
   clipped, so what stays is always the most important at the left). Every fact has one spelling at every width
   ("1h44 left", "18m left"), so the same time never reads two ways on one screen.

   Priority, highest first: time left, episodes left (a series only), end time, format, episode code, SERVER (a title
   on the viewer's own server), rating, then year, runtime, seasons. */

/** One fact in the printed line. `key` is the time left, the one fact marked in red. */
export interface Fact {
  text: string
  /** Lower is more important; ties drop the later one first. */
  rank: number
  key?: boolean
}

/** What a caller hands over: a plain string is plain print of the lowest priority. */
export type PrintPart = string | { key: string; rank?: number } | { text: string; rank?: number }

/** The priorities, so every screen ranks the same facts the same way: `facts` is a runtime or a season count. */
export const rank = { left: 0, episodesLeft: 0.5, ends: 1, format: 2, episode: 3, rating: 4, facts: 5, year: 6 } as const

export function toFacts(parts: PrintPart[]): Fact[] {
  return parts
    .map((p): Fact => {
      if (typeof p === 'string') return { text: p, rank: rank.facts }
      if ('key' in p) return { text: p.key, rank: p.rank ?? rank.left, key: true }
      return { text: p.text, rank: p.rank ?? rank.facts }
    })
    .filter((f) => f.text !== '')
}
