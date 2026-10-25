import { QueryClient } from '@tanstack/react-query'
import { createAsyncStoragePersister } from '@tanstack/query-async-storage-persister'
import { del, get, set } from 'idb-keyval'

const minute = 60_000
const hour = 60 * minute

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Catalogue data barely changes within an hour; served from cache, refreshed quietly after.
      staleTime: hour,
      // Kept for a week so a repeat visit paints from IndexedDB before the network answers.
      gcTime: 7 * 24 * hour,
      retry: (count, error: any) => count < 2 && !(error?.status >= 400 && error?.status < 500),
      refetchOnWindowFocus: false,
    },
  },
})

/** The query cache, saved to IndexedDB (off the main thread's storage path) and restored at launch. */
export const persister = createAsyncStoragePersister({
  storage: { getItem: (k) => get(k), setItem: (k, v) => set(k, v), removeItem: (k) => del(k) },
  key: 'flow.queries.v1',
  throttleTime: 2000,
  serialize: (data) => data as any,
  deserialize: (data) => data as any,
})

/** Bumped when normalised shapes change, so an old cache is dropped instead of misread. */
export const cacheBuster = 'v3'
