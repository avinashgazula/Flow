import { createStore, useStore } from '../../lib/store/createStore'
import { pushRecent } from './logic'

/** Recent searches, on this device only, as the apps' recentSearches. */
const recentStore = createStore<{ terms: string[] }>('recentSearches', { terms: [] })

export const useRecentSearches = () => useStore(recentStore, (s) => s.terms)

export const recentSearches = {
  remember: (term: string) => recentStore.set((s) => ({ terms: pushRecent(s.terms, term) })),
  forget: (term: string) => recentStore.set((s) => ({ terms: s.terms.filter((t) => t !== term) })),
  clear: () => recentStore.set({ terms: [] }),
}
