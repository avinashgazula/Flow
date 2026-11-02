import { useEffect, type RefObject } from 'react'
import { settingsStore } from '../../lib/store/settings'
import { activeTracker, isOtherTracker } from '../../lib/tracking/service'
import type { Reading } from '../../lib/trakt/scrobble'

/** Tells the service that tracks (Trakt, Simkl or MDBList, as chosen in Settings → Account) what is playing: start,
 *  pause and stop with how far in, from the video element's own events. Nothing loads when this device tracks; each
 *  scrobbler is its own chunk. `read` says what is playing and how far in (the player keeps those in refs), and null
 *  before there is anything. */
export function useTraktScrobble(video: RefObject<HTMLVideoElement | null>, active: boolean, read: () => Reading | null) {
  useEffect(() => {
    // Sample streams are not something to tell a tracker about.
    const s = settingsStore.get()
    const kind = activeTracker(s)
    if (!active || s.demo || kind === 'local') return
    let stop: (() => void) | undefined
    let gone = false
    const started = (start: (el: HTMLVideoElement) => () => void) => {
      if (!gone && video.current) stop = start(video.current)
    }
    if (isOtherTracker(kind)) void import('../../lib/tracking/scrobble').then((m) => started((el) => m.startTrackerScrobbling(kind, el, read)))
    else void import('../../lib/trakt/scrobble').then((m) => started((el) => m.startScrobbling(el, read)))
    return () => {
      gone = true
      stop?.()
    }
    // `read` only looks at refs, so the first one is as good as the latest.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active])
}
