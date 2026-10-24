import type { IconName } from '../components/Icon'

/* The sections of the top bar and the phone's tab bar, in their default order. Navigation is driven by this
   list and the saved order (Settings → Appearance → Tab Order), so a new section is one entry here: someone
   whose saved order doesn't know it yet gets it at its default position. */

export type TabPath = '/' | '/explore' | '/library' | '/live' | '/search'

export interface Tab {
  /** Stable name saved in Settings. Never the label or the address, which can change. */
  id: string
  to: TabPath
  label: string
  icon: IconName
}

export const tabs: readonly Tab[] = [
  { id: 'home', to: '/', label: 'Home', icon: 'home' },
  { id: 'explore', to: '/explore', label: 'Explore', icon: 'explore' },
  { id: 'library', to: '/library', label: 'Library', icon: 'library' },
  { id: 'live', to: '/live', label: 'Live TV', icon: 'live' },
  { id: 'search', to: '/search', label: 'Search', icon: 'search' },
]

export const defaultTabOrder: readonly string[] = tabs.map((t) => t.id)

/** The tabs in the order a person chose. A saved id that no longer exists is ignored, a repeated one counts
 *  once, and a tab the saved order has never heard of (one added since) goes in at its default position, or
 *  at the end if the list is shorter than that. */
export function orderTabs(saved: readonly string[], all: readonly Tab[] = tabs): Tab[] {
  const byId = new Map(all.map((t) => [t.id, t]))
  const ordered: Tab[] = []
  for (const id of saved) {
    const tab = byId.get(id)
    if (tab && !ordered.includes(tab)) ordered.push(tab)
  }
  all.forEach((tab, index) => {
    if (!ordered.includes(tab)) ordered.splice(Math.min(index, ordered.length), 0, tab)
  })
  return ordered
}

/** The order after moving a tab one place up (-1) or down (1). Moving past either end changes nothing. */
export function moveTab(saved: readonly string[], id: string, delta: -1 | 1, all: readonly Tab[] = tabs): string[] {
  const ids = orderTabs(saved, all).map((t) => t.id)
  const from = ids.indexOf(id)
  const to = from + delta
  if (from < 0 || to < 0 || to >= ids.length) return ids
  ;[ids[from], ids[to]] = [ids[to]!, ids[from]!]
  return ids
}

/** Whether the order is the default, so Settings knows when a reset has anything to do. */
export const isDefaultOrder = (saved: readonly string[], all: readonly Tab[] = tabs) => orderTabs(saved, all).every((t, i) => t === all[i])

/** What a backup may hold: a short list of distinct, non-empty names. Names this build doesn't know are
 *  allowed, because they may belong to a newer one. */
export const isTabOrder = (v: unknown): v is string[] => Array.isArray(v) && v.length <= 24 && v.every((x) => typeof x === 'string' && x.length > 0 && x.length <= 40) && new Set(v).size === v.length
