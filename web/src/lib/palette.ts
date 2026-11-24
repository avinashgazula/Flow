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

const apply = () => {
  document.documentElement.dataset.palette = resolvePalette(settingsStore.get().palette)
  // The browser's own chrome (the address bar on a phone) takes the paper of the theme now showing.
  const paper = getComputedStyle(document.documentElement).getPropertyValue('--bg').trim()
  if (paper) document.querySelector('meta[name="theme-color"]')?.setAttribute('content', paper)
}

/** Follow the setting for the life of the page. Called once, at start. */
export function watchPalette() {
  apply()
  settingsStore.subscribe(apply)
}
