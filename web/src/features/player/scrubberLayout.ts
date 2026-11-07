/* Where the progress bar is cut. Chapters and the ends of skippable segments (an intro, the credits) show as small gaps in the
   one track, as on YouTube, rather than as ticks on it. Pure, so it is tested without a browser. */

import { markedChapters } from './chapters'
import type { Chapter, SkipSegment } from './segments'

/** Gaps closer together than this (a fraction of the length) are one: an intro that begins where a chapter does. */
const MIN_APART = 0.003

/** Where the track is cut, as fractions of the length, sorted: every marked chapter's start and the start and end of each
 *  segment, left out at the very ends (a cut there is just a shorter track) and where the length isn't known yet. */
export function gapFractions(chapters: readonly Chapter[], segments: readonly Pick<SkipSegment, 'start' | 'end'>[], duration: number): number[] {
  if (!(duration > 0) || !Number.isFinite(duration)) return []
  const points = [...markedChapters(chapters).map((c) => c.start), ...segments.flatMap((x) => [x.start, x.end])]
  const found: number[] = []
  for (const at of points.map((t) => t / duration).sort((a, b) => a - b)) {
    if (!(at > MIN_APART) || !(at < 1 - MIN_APART)) continue
    if (found.length === 0 || at - found[found.length - 1]! >= MIN_APART) found.push(at)
  }
  return found
}

const pct = (fraction: number) => `${(fraction * 100).toFixed(3)}%`

/** A CSS mask for the track that is opaque everywhere but `gap` pixels centred on each fraction. Undefined with none, so the
 *  track carries no mask at all. */
export function gapMask(fractions: readonly number[], gap = 2): string | undefined {
  if (fractions.length === 0) return undefined
  const half = gap / 2
  const stops = ['#000 0']
  for (const f of fractions) stops.push(`#000 calc(${pct(f)} - ${half}px)`, `transparent calc(${pct(f)} - ${half}px) calc(${pct(f)} + ${half}px)`, `#000 calc(${pct(f)} + ${half}px)`)
  stops.push('#000 100%')
  return `linear-gradient(to right, ${stops.join(', ')})`
}

/** The time at the bar's right end: what is left ("−0:42") or the whole length ("1:00"), as Netflix lets you choose. */
export type TimeMode = 'remaining' | 'total'

export function otherMode(mode: TimeMode): TimeMode {
  return mode === 'remaining' ? 'total' : 'remaining'
}
