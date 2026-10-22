/* What fits on an edge strip. A strip is a fixed band: perforations on the left, edge print after them. Print
   that doesn't fit is never cut off mid-word (an end time that reads "ENDS 1:0…" is worse than none): it is
   composed to fit instead. The facts have a priority and the lowest go first. Every fact has one spelling at
   every width ("1h44 left", "18m left"), so the same time never reads two ways on one screen.

   Priority, highest first: time left, end time, format, episode code, rating, then year, runtime, seasons.
   Everything here is a pure function of the width, so it is tested without a browser; the component measures
   the strip and calls it. */

/** One fact in edge print. `key` is the time left, the one fact in yellow. */
export interface Fact {
  text: string
  /** Lower is more important; ties drop the later one first. */
  rank: number
  key?: boolean
}

/** What a caller hands over: a plain string is white print of the lowest priority. */
export type PrintPart = string | { key: string; rank?: number } | { text: string; rank?: number }

/** The priorities, so every screen ranks the same facts the same way: `facts` is a runtime or a season count. */
export const rank = { left: 0, ends: 1, format: 2, episode: 3, rating: 4, facts: 5, year: 6 } as const

export function toFacts(parts: PrintPart[]): Fact[] {
  return parts
    .map((p): Fact => {
      if (typeof p === 'string') return { text: p, rank: rank.facts }
      if ('key' in p) return { text: p.key, rank: p.rank ?? rank.left, key: true }
      return { text: p.text, rank: p.rank ?? rank.facts }
    })
    .filter((f) => f.text !== '')
}

export type StripKind = 'lead' | 'title' | 'still' | 'poster'

/** Perforations are a 7 px hole on an 11 px pitch; the gap after them is `--space-s`. */
export const pitch = 11
export const perfsWidth = (n: number) => (n > 0 ? n * pitch - 4 : 0)
/** The gap after the perforations: `--space-s`, and a tighter 8 on a poster's narrower strip. */
export const gapAfterPerfs = (kind: StripKind) => (kind === 'poster' ? 8 : 12)

const maxPerfs: Record<StripKind, number> = { lead: 30, title: 18, still: 4, poster: 5 }
const minPerfs: Record<StripKind, number> = { lead: 8, title: 6, still: 3, poster: 3 }
/** Print room a still or a poster keeps free of perforations, so every strip in a row has the same count
 *  and the print that does fit isn't squeezed. A lead and a title page's still instead give the print what
 *  it needs and fill the rest with perforations. */
const reserve: Partial<Record<StripKind, number>> = { still: 150, poster: 100 }

/** The font the strip's print is set in: 12 px with 0.14em tracking, or 11 px and 0.1em on a poster. */
export const printFont = (kind: StripKind) => (kind === 'poster' ? { size: 11, tracking: 0.1 } : { size: 12, tracking: 0.14 })

/** A width in px for `text` in the edge face without measuring: Barlow Condensed 600, uppercase and tracked.
 *  Tabular digits run about 0.49 em before the tracking, capitals 0.45 em; spaces, dots and colons about
 *  0.32 em with it. Measured against the real font, within a few per cent (the strip checks the real thing
 *  once it has drawn, and drops one more fact if the estimate was kind). */
export function estimateWidth(text: string, kind: StripKind): number {
  const { size, tracking } = printFont(kind)
  let em = 0
  for (const ch of text) em += /[\s.,:;·'’\-–|!]/.test(ch) ? 0.32 : (/\d/.test(ch) ? 0.49 : 0.45) + tracking
  return Math.ceil(em * size)
}

export interface Layout {
  /** Perforations to draw (0: none fit). */
  perfs: number
  /** The facts to print, in their original order. */
  facts: Fact[]
}

export type Measure = (text: string) => number

/** Lays out one strip. `width` is the room inside its padding. */
export function composeStrip({ width, facts, kind, measure }: { width: number; facts: Fact[]; kind: StripKind; measure?: Measure }): Layout {
  const m: Measure = measure ?? ((t) => estimateWidth(t, kind))
  const sep = m(' · ')
  const total = (list: Fact[]) => list.reduce((sum, f) => sum + m(f.text), 0) + sep * Math.max(0, list.length - 1)
  /** The most that fits in `room`: all of it, then without the least important fact, and so on. */
  const compose = (room: number): Omit<Layout, 'perfs'> => {
    let list = facts
    for (;;) {
      if (total(list) <= room || list.length <= 1) return { facts: list }
      // Least important first; of equals, the later one.
      let drop = 0
      list.forEach((f, i) => {
        if (f.rank >= list[drop]!.rank) drop = i
      })
      list = list.filter((_, i) => i !== drop)
    }
  }
  const gap = gapAfterPerfs(kind)
  const room = (perfs: number) => width - (perfs > 0 ? perfsWidth(perfs) + gap : 0)
  const fitPerfs = (space: number) => Math.floor((space + 4) / pitch)

  if (facts.length === 0) return { perfs: Math.min(maxPerfs[kind], Math.max(0, fitPerfs(width))), facts: [] }

  const keep = reserve[kind]
  if (keep !== undefined) {
    // Stills and posters: the same count in every strip of a size, from the width alone.
    const n = Math.min(maxPerfs[kind], fitPerfs(width - keep - gap))
    const perfs = n >= minPerfs[kind] ? n : 0
    return { perfs, ...compose(room(perfs)) }
  }
  // A lead or a title's still: print in full if it fits beside the most perforations, else beside the fewest.
  const full = total(facts)
  const n = Math.min(maxPerfs[kind], fitPerfs(width - full - gap))
  if (n >= minPerfs[kind]) return { perfs: n, facts }
  const perfs = width >= perfsWidth(minPerfs[kind]) + gap + total(facts.filter((f) => f.rank <= rank.ends)) ? minPerfs[kind] : 0
  return { perfs, ...compose(room(perfs)) }
}
