import { useEffect, useSyncExternalStore, type ComponentType } from 'react'
import type { MediaItem } from '../../lib/tmdb/types'
import type { EpisodeRef, Progress } from '../../lib/store/library'

/* The first page draws Continue Watching before the shelves' chunk arrives. That chunk holds the card menu, and when it
   loads it puts the menu here, so each card gains its More button a moment later with no request of its own. A page
   that never loads the shelves (Explore, Search, a person) asks for the menu itself once it is idle. */

export interface CardMenuProps {
  item: MediaItem
  entry?: { progress?: Progress; episode?: EpisodeRef }
}

let menu: ComponentType<CardMenuProps> | undefined
const listeners = new Set<() => void>()

export function provideCardMenu(component: ComponentType<CardMenuProps>) {
  menu = component
  listeners.forEach((on) => on())
}

let loading = false
function loadWhenIdle() {
  if (menu || loading) return
  loading = true
  const load = () => void import('./CardMenu').then((m) => provideCardMenu(m.default))
  setTimeout(load, 300)
}

const subscribe = (on: () => void) => (listeners.add(on), () => void listeners.delete(on))

export function LazyCardMenu(props: CardMenuProps) {
  const Menu = useSyncExternalStore(subscribe, () => menu, () => undefined)
  useEffect(loadWhenIdle, [])
  return Menu ? <Menu {...props} /> : null
}
