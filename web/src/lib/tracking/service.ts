import { settingsStore, type Settings, type TrackerKind } from '../store/settings'

/* Which service tracks. Only one does at a time, as in the apps; the others keep their sign-in or key but sit idle.
   This file is small on purpose: the first page asks it before deciding to load any tracker's code, so the words
   Settings uses for each service are in labels.ts. */

export type { TrackerKind }

/** Whether a service can track now: signed in, or its key is there. PublicMetaDB never can from a web page: it answers
 *  with no CORS headers (checked against the live service, November 2026), so a browser throws its answers away. Its
 *  key still travels through Flow Sync to the apps, which can track with it. */
export function isAvailable(kind: TrackerKind, s: Pick<Settings, 'traktAccount' | 'simklAccount' | 'mdblistKey'>): boolean {
  switch (kind) {
    case 'trakt':
      return !!s.traktAccount
    case 'simkl':
      return !!s.simklAccount
    case 'mdblist':
      return !!s.mdblistKey?.trim()
    case 'publicMetaDB':
      return false
    case 'local':
      return true
  }
}

/** The service that tracks now. A choice whose sign-in or key has gone (signed out on another device) falls back to
 *  this device, and comes back by itself when the sign-in does. Never chosen: the first sign-in, Trakt before Simkl. */
export function activeTracker(s: Settings): TrackerKind {
  const chosen = s.tracker
  if (chosen) return isAvailable(chosen, s) ? chosen : 'local'
  if (s.traktAccount) return 'trakt'
  if (s.simklAccount) return 'simkl'
  return 'local'
}

/** The trackers with a client in lib/tracking, as opposed to Trakt (lib/trakt) and this device. */
export type OtherTracker = 'simkl' | 'mdblist'
export const isOtherTracker = (kind: TrackerKind): kind is OtherTracker => kind === 'simkl' || kind === 'mdblist'

/** The code that sends a title's rating or an un-watch to the service tracking now, loaded only when there is one.
 *  Undefined when this device tracks: nothing leaves, and nothing is downloaded. */
export function trackerEngine() {
  const kind = activeTracker(settingsStore.get())
  return kind === 'trakt' ? import('../trakt/engine') : isOtherTracker(kind) ? import('./engine') : undefined
}
