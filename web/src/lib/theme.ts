import { useSyncExternalStore } from 'react'

/* Light or dark. The page follows the system until the viewer chooses; the choice is saved per browser, in
   localStorage, not in Settings: it is a property of this screen, so it neither syncs nor travels in a backup.
   index.html runs the same resolution before first paint (keep the two in step: key, values, meta colours). */

export type Theme = 'light' | 'dark'

export const themeKey = 'flow.theme'
/** The colour of the browser's own chrome (the address bar on a phone), as --bg. */
export const themeColour: Record<Theme, string> = { light: '#ffffff', dark: '#0a0a0a' }

/** The saved choice if it is one of the two, otherwise whatever the system prefers. */
export function resolveTheme(saved: string | null | undefined, systemDark: boolean): Theme {
  return saved === 'light' || saved === 'dark' ? saved : systemDark ? 'dark' : 'light'
}

const systemDark = () => typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: dark)').matches

function readSaved(): string | null {
  try {
    return localStorage.getItem(themeKey)
  } catch {
    return null
  }
}

const listeners = new Set<() => void>()

/** The theme on screen now: what the pre-paint script set on <html>, or the resolution again where it didn't run. */
export function currentTheme(): Theme {
  const set = typeof document !== 'undefined' ? document.documentElement.dataset.theme : undefined
  return set === 'light' || set === 'dark' ? set : resolveTheme(readSaved(), systemDark())
}

function apply(theme: Theme) {
  document.documentElement.dataset.theme = theme
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', themeColour[theme])
  listeners.forEach((l) => l())
}

/** Choose a theme and remember it. */
export function setTheme(theme: Theme) {
  try {
    localStorage.setItem(themeKey, theme)
  } catch {
    // Storage can be blocked: the choice then lasts until the page closes.
  }
  apply(theme)
}

let watching = false
/** Follow the system while nothing is saved, and follow a change made in another tab. Called once, at start. */
export function watchTheme() {
  if (watching) return
  watching = true
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    if (readSaved() === null) apply(resolveTheme(null, systemDark()))
  })
  window.addEventListener('storage', (e) => {
    if (e.key === themeKey) apply(resolveTheme(e.newValue, systemDark()))
  })
}

const subscribe = (l: () => void) => {
  listeners.add(l)
  return () => void listeners.delete(l)
}

/** The theme on screen, following changes. */
export function useTheme(): Theme {
  return useSyncExternalStore(subscribe, currentTheme, () => 'light')
}
