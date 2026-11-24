import { settingsStore, type PaletteChoice } from './store/settings'

/* The colour theme, as an attribute on <html> that styles/tokens.css turns into the colours. index.html sets it before
   first paint from the saved settings (keep the ids there in step); this keeps it current when Settings changes it, here
   or in another tab. Light or dark is separate (lib/theme.ts). */

export const defaultPalette: PaletteChoice = 'admitOne'
export const paletteIds: readonly PaletteChoice[] = ['admitOne', 'index', 'openingNight']

/** A saved value as a theme we have: one a newer build saved that this one doesn't know reads as the default, as the apps do. */
export function resolvePalette(saved: unknown): PaletteChoice {
  return paletteIds.find((id) => id === saved) ?? defaultPalette
}

const root = () => document.documentElement

/** Puts the saved theme on <html>. At start index.html has already done it, and the address bar's colour with it, so
 *  nothing is read back from the page then: reading a style before the first frame would only force an early layout. */
const apply = () => {
  const next = resolvePalette(settingsStore.get().palette)
  if (root().dataset.palette === next) return
  root().dataset.palette = next
  // The browser's own chrome (the address bar on a phone) takes the paper of the theme now showing.
  const paper = getComputedStyle(root()).getPropertyValue('--bg').trim()
  if (paper) document.querySelector('meta[name="theme-color"]')?.setAttribute('content', paper)
}

/** Follow the setting for the life of the page. Called once, at start. */
export function watchPalette() {
  apply()
  settingsStore.subscribe(apply)
}
