import { useRouter } from '@tanstack/react-router'
import { useSyncExternalStore, type ComponentType } from 'react'
import type { MediaItem } from '../../lib/tmdb/types'
import type { EpisodeRef, Progress } from '../../lib/store/library'

/* The first page draws Continue Watching before the shelves' chunk arrives. That chunk holds the card menu, and when it
   loads it puts the menu here, so each card gains its More button a moment later with no request of its own. A page
   that never loads the shelves (Explore, Search, a person) asks for the menu itself once it is idle. */

/** Opens the player; given by the card's side, so the menu's own chunk imports no router. */
export type Play = (type: MediaItem['type'], id: number, at?: { season: number; episode: number }) => void

export interface CardMenuProps {
  item: MediaItem
  play?: Play
  entry?: { progress?: Progress; episode?: EpisodeRef }
}

let menu: ComponentType<CardMenuProps> | undefined
const listeners = new Set<() => void>()

export function provideCardMenu(component: ComponentType<CardMenuProps>) {
  menu = component
  listeners.forEach((on) => on())
}

const subscribe = (on: () => void) => (listeners.add(on), () => void listeners.delete(on))

export function LazyCardMenu(props: CardMenuProps) {
  // useRouter, not useNavigate: the first page's code (this file) importing useNavigate makes the bundler pull the router out of
  // the entry chunk, which costs about 3 KB on every first load.
  const { navigate } = useRouter()
  const Menu = useSyncExternalStore(subscribe, () => menu, () => undefined)
  const play: Play = (type, id, at) => void navigate({ to: '/watch/$type/$id', params: { type, id }, search: at })
  return Menu ? <Menu {...props} play={play} /> : null
}
