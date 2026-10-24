import { useEffect, type RefObject } from 'react'
import { settingsStore } from '../../lib/store/settings'
import type { Reading } from '../../lib/trakt/scrobble'

/** Tells Trakt what is playing while the viewer is signed in to it: start, pause and stop with how far in, from
 *  the video element's own events. Nothing loads for a viewer who isn't signed in; the scrobbler is its own chunk.
 *  `read` says what is playing and how far in (the player keeps those in refs), and null before there is anything. */
export function useTraktScrobble(video: RefObject<HTMLVideoElement | null>, active: boolean, read: () => Reading | null) {
  useEffect(() => {
    // Sample streams are not something to tell Trakt about.
    const s = settingsStore.get()
    if (!active || !s.traktAccount || s.demo) return
    let stop: (() => void) | undefined
    let gone = false
    void import('../../lib/trakt/scrobble').then(({ startScrobbling }) => {
      if (!gone && video.current) stop = startScrobbling(video.current, read)
    })
    return () => {
      gone = true
      stop?.()
    }
    // `read` only looks at refs, so the first one is as good as the latest.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active])
}
