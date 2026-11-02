import type { Settings, TrackerKind } from '../store/settings'
import { isAvailable } from './service'

/* What Settings says about each service, as the apps' Tracking With list does. Kept apart from service.ts so the
   first page doesn't carry the words. */

/** The apps' order. */
export const trackerOrder: readonly TrackerKind[] = ['trakt', 'simkl', 'publicMetaDB', 'mdblist', 'local']

export const trackerName: Record<TrackerKind, string> = {
  trakt: 'Trakt',
  simkl: 'Simkl',
  publicMetaDB: 'PublicMetaDB',
  mdblist: 'MDBList',
  local: 'This Device',
}

/** The apps' sentence for each, with the parts that differ in a browser changed (there is no iCloud here, and no
 *  MDBList shelves yet). */
export const trackerBlurb: Record<TrackerKind, string> = {
  trakt: 'Your Trakt account: history, watchlist, ratings and scrobbling.',
  simkl: 'Your Simkl account: history, watchlist, ratings and scrobbling.',
  publicMetaDB: 'Tracks against your PublicMetaDB API key. No sign-in.',
  mdblist: 'Tracks against your own MDBList API key. No sign-in.',
  local: 'Kept in this browser. No account needed.',
}

/** Why a service can't be chosen yet, in words that say what to do; undefined when it can. */
export function unavailable(kind: TrackerKind, s: Pick<Settings, 'traktAccount' | 'simklAccount' | 'mdblistKey'>): string | undefined {
  if (isAvailable(kind, s)) return undefined
  switch (kind) {
    case 'trakt':
      return 'Sign in to Trakt below first.'
    case 'simkl':
      return 'Sign in to Simkl below first.'
    case 'mdblist':
      return 'Add an MDBList API key in Settings → Metadata first.'
    default:
      return 'Web pages can’t reach PublicMetaDB, so only the apps track with it.'
  }
}
