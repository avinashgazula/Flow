/* Scrobbling to Simkl or MDBList: the same start, pause and stop the player sends Trakt (lib/trakt/scrobble.ts),
   with the service's own client behind them.

   Simkl records a play by itself when a stop comes in at 80 % or more, as Trakt does, so the library's own mark of the
   same play isn't sent too. MDBList's reading of a scrobble couldn't be checked without a real key, so for it the
   library's mark always travels, as the apps send both; a service that keeps the same play once is the better of two
   ways to be wrong than a play that never arrives. */

import { startScrobbling, type Reading } from '../trakt/scrobble'
import { backendFor } from './session'
import type { OtherTracker } from './service'

export function startTrackerScrobbling(kind: OtherTracker, video: HTMLVideoElement, read: () => Reading | null): () => void {
  const backend = backendFor(kind)
  return startScrobbling(video, read, (action, target, percent, keepalive) => backend.scrobble(action, target, percent, keepalive), kind === 'simkl')
}
