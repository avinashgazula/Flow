import { orderTabs } from '../../lib/tabs'

/* The keyboard, in one place: the Go shortcuts and what the shortcuts sheet lists. The Mac app's Go menu has Command-1 to
   5 for its tabs, Command-F for Search, Command-U for Upcoming and Option-Command-P for Continue Watching. A browser keeps
   Ctrl or Command with a digit, and Alt with a letter, for its own tabs and menus, so here Go is a chord, as in the
   sites that have one: press G, then a key. Typing in a field never triggers any of it. */

/** How long G waits for the key that finishes it. */
export const chordMs = 1500

export interface GoTarget {
  to: string
  search?: Record<string, string>
}

/** Where `G` then `key` goes: a letter for a place, a digit for the tabs in the order Settings gives them. */
export function goTarget(key: string, saved: readonly string[] = []): GoTarget | undefined {
  const k = key.toLowerCase()
  const tabs = orderTabs(saved)
  if (/^[1-9]$/.test(k)) {
    const tab = tabs[Number(k) - 1]
    return tab && { to: tab.to }
  }
  switch (k) {
    case 'h':
      return { to: '/' }
    case 'e':
      return { to: '/explore' }
    case 'l':
      return { to: '/library' }
    case 't':
      return { to: '/live' }
    case 'u':
      return { to: '/library', search: { list: 'upcoming' } }
    case 'c':
      return { to: '/continue' }
    case 's':
      return { to: '/settings' }
    default:
      return undefined
  }
}

export interface Chord {
  /** When G was pressed, or 0 when nothing is waiting. */
  armedAt: number
  /** The key that finished a chord (to pass to `goTarget`). */
  finished?: string
}

/** One key press through the chord: G arms it, the next key within `chordMs` finishes it, anything else clears it.
 *  A second G starts over. */
export function chordStep(armedAt: number, key: string, now: number): Chord {
  const k = key.toLowerCase()
  const waiting = armedAt > 0 && now - armedAt <= chordMs
  if (waiting && k !== 'g') return { armedAt: 0, finished: k }
  return { armedAt: k === 'g' ? now : 0 }
}

/** Whether a key press belongs to a field the person is typing in. */
export function isTyping(target: { tagName?: string; isContentEditable?: boolean } | null): boolean {
  return !!target && (!!target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName ?? ''))
}
