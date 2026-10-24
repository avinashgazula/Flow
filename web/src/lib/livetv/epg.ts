import type { EPG, Programme } from './types'

/* Looking things up in a guide (FlowKit's EPG). Each channel's programmes are sorted by start, so a
   window of the schedule is a prefix scan that stops at the first programme after it. */

export const isAiring = (p: Programme, at: number) => p.start <= at && at < p.end

/** 0 to 1: how far through the programme `at` is. */
export function progress(p: Programme, at: number): number {
  const total = p.end - p.start
  return total > 0 ? Math.min(1, Math.max(0, (at - p.start) / total)) : 0
}

const lowerIndexes = new WeakMap<EPG, Map<string, string>>()

/** The programmes for a channel's guide id. Guides and playlists don't always agree on capitals, so a
 *  lowercased id on either side still finds it. */
export function programmesFor(epg: EPG, epgID: string | undefined): Programme[] | undefined {
  if (!epgID) return undefined
  const exact = epg.programmes[epgID] ?? epg.programmes[epgID.toLowerCase()]
  if (exact) return exact
  let index = lowerIndexes.get(epg)
  if (!index) {
    index = new Map(Object.keys(epg.programmes).map((key) => [key.toLowerCase(), key]))
    lowerIndexes.set(epg, index)
  }
  const key = index.get(epgID.toLowerCase())
  return key === undefined ? undefined : epg.programmes[key]
}

export function nowAndNext(epg: EPG, epgID: string | undefined, at: number = Date.now()): { now?: Programme; next?: Programme } {
  const list = programmesFor(epg, epgID)
  if (!list) return {}
  const index = list.findIndex((p) => p.end > at)
  if (index < 0) return {}
  const current = isAiring(list[index]!, at) ? list[index] : undefined
  return { now: current, next: list[current ? index + 1 : index] }
}

/** The programmes that overlap the `hours` after `from`. */
export function schedule(epg: EPG, epgID: string | undefined, from: number, hours: number): Programme[] {
  const list = programmesFor(epg, epgID)
  if (!list) return []
  const to = from + hours * 3_600_000
  const out: Programme[] = []
  for (const p of list) {
    // Sorted by start, so nothing after `to` can overlap the window.
    if (p.start >= to) break
    if (p.end > from) out.push(p)
  }
  return out
}

/** Adds another guide to this one. Two providers often carry the same channel; a start time that is
 *  already listed is the same programme. */
export function mergeEPG(into: EPG, other: EPG): EPG {
  const programmes = { ...into.programmes }
  for (const [key, more] of Object.entries(other.programmes)) {
    const seen = new Set<number>()
    programmes[key] = [...(programmes[key] ?? []), ...more]
      .sort((a, b) => a.start - b.start)
      .filter((p) => {
        if (seen.has(p.start)) return false
        seen.add(p.start)
        return true
      })
  }
  return { programmes, displayNames: { ...other.displayNames, ...into.displayNames } }
}

export const isEmptyEPG = (epg: EPG) => Object.keys(epg.programmes).length === 0

/** "12 min left" or "1 h 5 min left": the time a programme has left. */
export function remainingText(ms: number): string {
  const minutes = Math.max(1, Math.ceil(ms / 60_000))
  if (minutes < 60) return `${minutes} min left`
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  return m ? `${h} h ${m} min left` : `${h} h left`
}
