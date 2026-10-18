import type { HistoryEntry, ListEntry } from '../../lib/store/library'
import type { MediaType } from '../../lib/tmdb/types'

export type LibraryList = 'continue' | 'watchlist' | 'favourites' | 'history'
export const libraryLists: LibraryList[] = ['continue', 'watchlist', 'favourites', 'history']

export const listTitles: Record<LibraryList, string> = {
  continue: 'Continue Watching',
  watchlist: 'Watchlist',
  favourites: 'Favourites',
  history: 'History',
}

// MARK: History by day

export type DayGroup = 'Today' | 'Yesterday' | 'This Week' | 'Earlier'

/** Which day heading a watch falls under, by the local calendar: "This Week" is the five days
 *  before yesterday, so the three recent headings together cover the last seven days. */
export function dayGroup(watchedAt: number, now: number): DayGroup {
  const today = new Date(now)
  today.setHours(0, 0, 0, 0)
  const daysBefore = (n: number) => {
    const d = new Date(today)
    d.setDate(d.getDate() - n)
    return d.getTime()
  }
  if (watchedAt >= today.getTime()) return 'Today'
  if (watchedAt >= daysBefore(1)) return 'Yesterday'
  if (watchedAt >= daysBefore(6)) return 'This Week'
  return 'Earlier'
}

export interface HistoryGroup {
  label: DayGroup
  entries: HistoryEntry[]
}

/** History newest first, under day headings; headings with nothing under them are left out. */
export function groupHistory(entries: HistoryEntry[], now: number): HistoryGroup[] {
  const order: DayGroup[] = ['Today', 'Yesterday', 'This Week', 'Earlier']
  const groups = new Map<DayGroup, HistoryEntry[]>()
  for (const e of [...entries].sort((a, b) => b.watchedAt - a.watchedAt)) {
    const label = dayGroup(e.watchedAt, now)
    const list = groups.get(label)
    if (list) list.push(e)
    else groups.set(label, [e])
  }
  return order.filter((l) => groups.has(l)).map((label) => ({ label, entries: groups.get(label)! }))
}

export type HistoryRow = { kind: 'header'; label: DayGroup; count: number } | { kind: 'entry'; entry: HistoryEntry }

/** Headings and entries as one flat list, for a virtualised list that renders only what's on screen. */
export function historyRows(groups: HistoryGroup[]): HistoryRow[] {
  const rows: HistoryRow[] = []
  for (const g of groups) {
    rows.push({ kind: 'header', label: g.label, count: g.entries.length })
    for (const entry of g.entries) rows.push({ kind: 'entry', entry })
  }
  return rows
}

/** "S3 E7 · One Minute", or "S3 E7" until the name is known. */
export function episodeLabel(episode: { season: number; episode: number }, name?: string) {
  const code = `S${episode.season} E${episode.episode}`
  return name ? `${code} · ${name}` : code
}

// MARK: Watchlist and Favourites

export const listSorts = [
  { id: 'added', label: 'Recently Added' },
  { id: 'title', label: 'Title' },
  { id: 'year', label: 'Release Date' },
  { id: 'rating', label: 'Rating' },
] as const
export type ListSort = (typeof listSorts)[number]['id']

export const parseListSort = (value: unknown): ListSort => (listSorts.some((s) => s.id === value) ? (value as ListSort) : 'added')

export function sortEntries(entries: ListEntry[], sort: ListSort, type?: MediaType): ListEntry[] {
  const list = type ? entries.filter((e) => e.item.type === type) : [...entries]
  const byTitle = (a: ListEntry, b: ListEntry) => a.item.title.localeCompare(b.item.title, undefined, { sensitivity: 'base', ignorePunctuation: true, numeric: true })
  switch (sort) {
    case 'title':
      return list.sort(byTitle)
    case 'year':
      return list.sort((a, b) => (b.item.date ?? String(b.item.year ?? '')).localeCompare(a.item.date ?? String(a.item.year ?? '')) || byTitle(a, b))
    case 'rating':
      return list.sort((a, b) => (b.item.rating ?? 0) - (a.item.rating ?? 0) || byTitle(a, b))
    default:
      return list.sort((a, b) => b.addedAt - a.addedAt)
  }
}

/** "1 title", "12 titles". */
export const titles = (n: number) => (n === 1 ? '1 title' : `${n.toLocaleString()} titles`)
