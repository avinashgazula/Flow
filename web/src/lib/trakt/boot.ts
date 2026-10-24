/* The only part of the Trakt code the first page carries: a few lines that notice a sign-in and load the rest.
   The sign-in may be in storage already, or arrive later (made in Settings, or brought by Flow Sync), so this
   looks now and again at every settings change until it has started the library sync once. */

import { settingsStore } from '../store/settings'

export function bootTrakt() {
  let loading = false
  const check = () => {
    if (loading || !settingsStore.get().traktAccount) return
    loading = true
    void import('./engine').then(({ startTrakt }) => startTrakt())
  }
  check()
  settingsStore.subscribe(check)
}
