import { createStore, useStore } from '../store/createStore'
import type { Op } from '../trakt/store'
import type { OtherTracker } from './service'

/* What this browser remembers about each other tracker apart from the sign-in or key itself (which are settings):
   who is signed in, how the last sync went, the changes still waiting to reach the service, and the watchlist as it
   stood at the last sync. One record for each, so choosing another service and coming back picks up where it left
   off. It stays on this device. The same fields as lib/trakt/store.ts, which is what lib/trakt/merge.ts reads. */

export interface ServiceState {
  username: string | null
  /** The last time the library finished syncing with the service, ISO 8601. */
  lastSyncAt: string | null
  /** What went wrong, in words with what to do next. Cleared by the next success. */
  error: string | null
  /** The sign-in is spent or was revoked, so only a new sign-in helps. */
  signInAgain: boolean
  ops: Op[]
  /** Watchlist keys as they stood at the last sync; null before the first. */
  watchlistBaseline: string[] | null
  /** Only plays after this (ISO 8601) are asked for once the first pull is done. */
  historyThrough: string | null
  /** The service's ids for the resume points seen, so removing one here can remove it there. */
  playbackIds: Record<string, number>
}

export const emptyService: ServiceState = { username: null, lastSyncAt: null, error: null, signInAgain: false, ops: [], watchlistBaseline: null, historyThrough: null, playbackIds: {} }

export interface TrackingState {
  services: Partial<Record<OtherTracker, ServiceState>>
}

export const trackingStore = createStore<TrackingState>('tracking', { services: {} })

export const serviceState = (kind: OtherTracker): ServiceState => ({ ...emptyService, ...trackingStore.get().services[kind] })

/** Changes one service's record and leaves the others alone. */
export function setService(kind: OtherTracker, patch: Partial<ServiceState> | ((s: ServiceState) => Partial<ServiceState>)) {
  trackingStore.set((all) => {
    const now = { ...emptyService, ...all.services[kind] }
    return { services: { ...all.services, [kind]: { ...now, ...(typeof patch === 'function' ? patch(now) : patch) } } }
  })
}

/** The stored record itself (or the empty one), so a selector that returns it doesn't make a new object every time. */
export const useService = <S,>(kind: OtherTracker, selector: (s: ServiceState) => S) => useStore(trackingStore, (all) => selector(all.services[kind] ?? emptyService))
