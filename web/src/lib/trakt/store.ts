import type { MediaType } from '../tmdb/types'
import { createStore, useStore } from '../store/createStore'

/* What this browser remembers about Trakt apart from the sign-in itself (which is a setting, because Flow Sync
   carries it): who is signed in, how the last sync went, the changes still waiting to reach Trakt, and the
   lists as they stood at the last sync, which is how a removal on either side is told from a title that
   was never there. It stays on this device. */

/** One change made here that Trakt hasn't heard yet. Kept across reloads until it is sent. */
export type Op =
  | { kind: 'watchlist'; type: MediaType; id: number; on: boolean }
  | { kind: 'watched'; type: MediaType; id: number; season?: number; episode?: number; at: string }
  | { kind: 'unplayback'; type: MediaType; id: number }
  | { kind: 'rate'; type: MediaType; id: number; rating: number | null }

export interface TraktState {
  /** Who is signed in; null until Trakt has said. */
  username: string | null
  /** The last time the library finished syncing with Trakt, ISO 8601. */
  lastSyncAt: string | null
  /** What went wrong, in words with what to do next. Cleared by the next success. */
  error: string | null
  /** The refresh token is spent or revoked, so only a new sign-in helps. */
  signInAgain: boolean
  ops: Op[]
  /** Watchlist keys as they stood at the last sync; null before the first. */
  watchlistBaseline: string[] | null
  /** Only history after this (ISO 8601) is asked for once the first pull is done. */
  historyThrough: string | null
  /** Trakt's ids for the resume points seen, so removing one here can remove it there. */
  playbackIds: Record<string, number>
}

export const emptyState: TraktState = { username: null, lastSyncAt: null, error: null, signInAgain: false, ops: [], watchlistBaseline: null, historyThrough: null, playbackIds: {} }

export const traktStore = createStore<TraktState>('trakt', emptyState)
export const useTrakt = <S,>(selector: (s: TraktState) => S) => useStore(traktStore, selector)
