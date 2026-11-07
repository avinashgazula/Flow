import type { ListDestination, Settings, TrackerKind } from '../store/settings'
import type { Op } from '../trakt/store'
import { activeTracker, isAvailable } from './service'

/* Where each list is saved (Settings → Account → Watchlist Saved To, Favourites Saved To). Tracking With picks the one
   service that keeps history, progress and ratings; the two lists can each go to a service of their own, as in the apps,
   so Trakt can track while MDBList holds the watchlist. This file decides which service does which job, and the
   engines (trakt/engine.ts, engine.ts) do only the jobs they are given. It is small and pure; the first page
   asks it which engine to load. */

export type { ListDestination }

export type ListKind = 'watchlist' | 'favourites'

/** What a service does for this browser right now. */
export interface Roles {
  /** History, watched episodes, resume points, ratings. */
  track: boolean
  watchlist: boolean
  favourites: boolean
}

/** Only Trakt keeps favourites; the apps offer no other service for them either. */
export const keepsFavourites = (kind: TrackerKind) => kind === 'trakt'

/** The destinations a person can choose for a list, in the apps' order: services that are signed in or have their key, then this device. */
export function destinationChoices(list: ListKind, s: Pick<Settings, 'traktAccount' | 'simklAccount' | 'mdblistKey'>): ListDestination[] {
  const services: ListDestination[] = list === 'favourites' ? ['trakt'] : ['trakt', 'simkl', 'mdblist']
  return [...services.filter((k) => isAvailable(k, s)), 'local']
}

const narrow = (kind: TrackerKind): ListDestination => (kind === 'trakt' || kind === 'simkl' || kind === 'mdblist' ? kind : 'local')

/** Where a list is saved now. A choice whose sign-in or key has gone falls back to this device and returns with the
 *  sign-in, as `activeTracker` does. Never chosen: the watchlist goes where tracking goes (what the website did before
 *  this was a setting), and favourites stay here. */
export function listDestination(s: Settings, list: ListKind): ListDestination {
  const chosen = list === 'watchlist' ? s.watchlistDestination : s.favouritesDestination
  const kind = chosen ?? (list === 'watchlist' ? narrow(activeTracker(s)) : 'local')
  if (kind === 'local') return 'local'
  return isAvailable(kind, s) && (list === 'watchlist' || keepsFavourites(kind)) ? kind : 'local'
}

export function rolesOf(kind: TrackerKind, s: Settings): Roles {
  return {
    track: activeTracker(s) === kind,
    watchlist: listDestination(s, 'watchlist') === kind,
    favourites: listDestination(s, 'favourites') === kind,
  }
}

export const hasRole = (r: Roles) => r.track || r.watchlist || r.favourites
export const sameRoles = (a: Roles | undefined, b: Roles | undefined) => !!a && !!b && a.track === b.track && a.watchlist === b.watchlist && a.favourites === b.favourites

/** The changes a service with these roles should hear: list changes only if it holds that list, everything else only if
 *  it tracks. This is the whole routing rule; a change made here goes to every service that has a use for it. */
export function opsFor(ops: Op[], roles: Roles): Op[] {
  return ops.filter((o) => (o.kind === 'watchlist' ? roles.watchlist : o.kind === 'favourite' ? roles.favourites : roles.track))
}
