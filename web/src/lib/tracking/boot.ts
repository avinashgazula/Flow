/* The only part of the tracker code the first page carries: a few lines that notice which service has a job (tracking,
   or holding the watchlist or favourites; destinations.ts) and load its engine. The sign-in may be in storage already,
   or arrive later (made in Settings, or brought by Marquee Sync), and the choices may change, so this looks now and again
   at every settings change until each engine has started once. Each engine then follows the settings itself. */

import { settingsStore } from '../store/settings'
import { hasRole, rolesOf } from './destinations'

export function bootTrackers() {
  let trakt = false
  let other = false
  const check = () => {
    const s = settingsStore.get()
    if (!trakt && hasRole(rolesOf('trakt', s))) {
      trakt = true
      void import('../trakt/engine').then(({ startTrakt }) => startTrakt())
    }
    if (!other && (hasRole(rolesOf('simkl', s)) || hasRole(rolesOf('mdblist', s)))) {
      other = true
      void import('./engine').then(({ startTracking }) => startTracking())
    }
  }
  check()
  settingsStore.subscribe(check)
}
