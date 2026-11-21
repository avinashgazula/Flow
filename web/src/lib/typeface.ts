import { settingsStore, type FontChoice } from './store/settings'

/* The typeface of the interface and body text, as an attribute on <html> that styles/tokens.css turns into --font.
   index.html sets it before first paint from the saved settings (keep the ids there in step); this keeps it
   current when Settings changes it, here or in another tab. */

export const typefaceIds: readonly FontChoice[] = ['system', 'inter', 'geist', 'manrope', 'mono']

/** A saved value as a face we have: an older build's 'ioskeley' (Ioskeley Mono) is Mono now, and anything a newer
 *  build saved that this one doesn't know reads as System, which is what shows. */
export function resolveTypeface(saved: unknown): FontChoice {
  if (saved === 'ioskeley') return 'mono'
  return typefaceIds.find((id) => id === saved) ?? 'system'
}

const apply = () => {
  document.documentElement.dataset.font = resolveTypeface(settingsStore.get().font)
}

/** Follow the setting for the life of the page. Called once, at start. */
export function watchTypeface() {
  apply()
  settingsStore.subscribe(apply)
}
