/* Subtitle delay: the viewer shifts the cues Flow draws, from 10 seconds early to 10 seconds late in tenths
   (the apps nudge a quarter second at a time; a mouse and a slider make a tenth easy). Positive shows
   subtitles later, as in the apps. Kept per title for as long as the page is open. */

export const delayRange = { min: -10, max: 10, step: 0.1 } as const

/** On the grid of tenths, inside the range. */
export function clampDelay(seconds: number): number {
  if (!Number.isFinite(seconds)) return 0
  const tenths = Math.round(Math.min(delayRange.max, Math.max(delayRange.min, seconds)) * 10)
  return tenths === 0 ? 0 : tenths / 10
}

/** "+1.5 s", "−0.3 s" (a true minus sign) and "0.0 s". */
export function delayLabel(seconds: number): string {
  const d = clampDelay(seconds)
  if (d === 0) return '0.0 s'
  return `${d > 0 ? '+' : '−'}${Math.abs(d).toFixed(1)} s`
}

interface CueLike {
  startTime: number
  endTime: number
  text: string
}

/** The longest a cue is searched back for: a cue that began earlier than this and is still showing would be odd. */
const longestCue = 30

/** The text on screen at `time` when every cue is shown `delay` seconds later than it says. `cues` is in the
 *  order a text track keeps them (by start time); the search starts where the shifted clock is and looks back
 *  only as far as a cue can last, so a long film's thousand cues cost a handful of comparisons. */
export function activeCueText(cues: ArrayLike<CueLike>, time: number, delay: number): string {
  const at = time - delay
  let low = 0
  let high = cues.length
  // The first cue that starts after `at`; everything before it has begun.
  while (low < high) {
    const mid = (low + high) >> 1
    if (cues[mid]!.startTime <= at) low = mid + 1
    else high = mid
  }
  const lines: string[] = []
  for (let i = low - 1; i >= 0; i--) {
    const cue = cues[i]!
    if (cue.startTime < at - longestCue) break
    if (cue.endTime > at) lines.push(cue.text)
  }
  return lines.reverse().join('\n')
}

const remembered = new Map<string, number>()

/** The delay set for a title (a show counts once) earlier in this visit, else Settings' Sync Offset (`fallback`), else none.
 *  A title put back to none stays at none even when the Sync Offset isn't. */
export const rememberedDelay = (key: string | undefined, fallback = 0): number => (key && remembered.has(key) ? remembered.get(key)! : clampDelay(fallback))

export function rememberDelay(key: string | undefined, seconds: number) {
  if (key) remembered.set(key, seconds)
}

/** The Sync Offset choices: from 5 seconds early to 5 late in half seconds, as the apps' picker. */
export const offsetChoices: number[] = Array.from({ length: 21 }, (_, i) => (i - 10) / 2)

/** "None", else "+1.5 s" (the apps' Sync Offset labels). */
export const offsetLabel = (seconds: number): string => (seconds === 0 ? 'None' : delayLabel(seconds))
