import type { MediaType } from '../tmdb/types'

/* Which server's library a title was opened from, for Play From This Library Only. A title opened from a row of a
   server's titles remembers that server for the visit (sessionStorage: it survives a reload, not a new tab), and
   the source search asks that server first. FlowKit carries the same thing as `libraryProviderID` on the route. */

const key = 'flow.libraryOrigin'
const keep = 40

const read = (): Record<string, string> => {
  try {
    const raw = sessionStorage.getItem(key)
    const parsed: unknown = raw ? JSON.parse(raw) : {}
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, string>) : {}
  } catch {
    return {}
  }
}

const titleKey = (type: MediaType, tmdbId: number) => `${type}:${tmdbId}`

export function rememberLibraryOrigin(type: MediaType, tmdbId: number, providerId: string) {
  const all = read()
  delete all[titleKey(type, tmdbId)]
  all[titleKey(type, tmdbId)] = providerId
  try {
    // Oldest out first: keys come back in the order they were added.
    sessionStorage.setItem(key, JSON.stringify(Object.fromEntries(Object.entries(all).slice(-keep))))
  } catch {
    // The visit simply searches every source, as before.
  }
}

/** The provider id of the server this title was opened from, if it was opened from one. */
export const libraryOriginFor = (type: MediaType, tmdbId: number): string | undefined => read()[titleKey(type, tmdbId)]
