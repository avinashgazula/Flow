/* The only part of the tracker code the first page carries: a few lines that notice which service tracks and load
   its engine. The sign-in may be in storage already, or arrive later (made in Settings, or brought by Flow Sync), and
   the choice may change, so this looks now and again at every settings change until each engine has started once.
   Each engine then follows the settings itself. */

import { settingsStore } from '../store/settings'
import { activeTracker } from './service'

export function bootTrackers() {
  let trakt = false
  let other = false
  const check = () => {
    const active = activeTracker(settingsStore.get())
    if (active === 'trakt' && !trakt) {
      trakt = true
      void import('../trakt/engine').then(({ startTrakt }) => startTrakt())
    } else if ((active === 'simkl' || active === 'mdblist') && !other) {
      other = true
      void import('./engine').then(({ startTracking }) => startTracking())
    }
  }
  check()
  settingsStore.subscribe(check)
}
