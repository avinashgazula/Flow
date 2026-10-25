import type { Channel, Programme } from '../../lib/livetv/types'

/* What the Live TV screens decide, apart from drawing it: groups, the favourites chip, search, the
   guide's window and a programme's timing line. Wording follows the apps (LiveTVView, GuideView). */

/** The chip for the viewer's starred channels. Not a group name a provider could use. */
export const favouritesGroup = '*favourites'

/** Group names in the order the channels first use them. */
export function groupsOf(channels: Channel[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const c of channels) if (!seen.has(c.group)) (seen.add(c.group), out.push(c.group))
  return out
}

export interface ViewFilter {
  group?: string
  favourites: ReadonlySet<string>
  search: string
}

/** The channels to show. With the last favourite gone its chip is too, so the list falls back to every
 *  channel rather than staying blank. */
export function visibleChannels(channels: Channel[], { group, favourites, search }: ViewFilter): Channel[] {
  let list = channels
  if (group === favouritesGroup) {
    const starred = channels.filter((c) => favourites.has(c.id))
    if (starred.length > 0) list = starred
  } else if (group) {
    list = channels.filter((c) => c.group === group)
  }
  const needle = search.trim().toLowerCase()
  return needle ? list.filter((c) => c.name.toLowerCase().includes(needle)) : list
}

/** The channel `offset` places along the lineup, wrapping at either end. Undefined when there is nowhere to go. */
export function neighbour(lineup: Channel[], currentID: string, offset: number): Channel | undefined {
  if (lineup.length < 2) return undefined
  const at = lineup.findIndex((c) => c.id === currentID)
  if (at < 0) return lineup[0]
  return lineup[(((at + offset) % lineup.length) + lineup.length) % lineup.length]
}

/** Up to two capitals from a channel's name: what stands in for a missing logo. */
export function monogram(name: string): string {
  const words = name.replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/).filter(Boolean)
  if (words.length === 0) return '?'
  const letters = words.length === 1 ? [...words[0]!].slice(0, 2) : [[...words[0]!][0]!, [...words[1]!][0]!]
  return letters.join('').toUpperCase()
}

const halfHour = 30 * 60_000

/** Where the guide starts: the half hour before now, then another half hour back, so what is on has begun. */
export const guideStart = (now: number) => Math.floor(now / halfHour) * halfHour - halfHour

export const guideHours = 12

const clock = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' })
export const timeText = (ms: number) => clock.format(ms)
export const timeRange = (p: Pick<Programme, 'start' | 'end'>) => `${timeText(p.start)} – ${timeText(p.end)}`

const isSameDay = (a: number, b: number) => new Date(a).toDateString() === new Date(b).toDateString()

/** "7:00 – 8:00 PM · 23 min left of 60", "Starts in 1 h 5 min" or "Ended", as the apps word it. */
export function timingText(p: Programme, now: number): string {
  const day = isSameDay(p.start, now) ? '' : `${new Date(p.start).toLocaleDateString(undefined, { weekday: 'long' })} · `
  const range = timeRange(p)
  const minutes = Math.round((p.end - p.start) / 60_000)
  if (p.start > now) {
    const until = Math.floor((p.start - now) / 60_000)
    const starts = until < 60 ? `Starts in ${Math.max(1, until)} min` : `Starts in ${Math.floor(until / 60)} h ${until % 60} min`
    return `${day}${range} · ${starts}`
  }
  if (p.end <= now) return `${day}${range} · Ended`
  const left = Math.floor((p.end - now) / 60_000)
  return `${range} · ${Math.max(1, left)} min left of ${minutes}`
}
