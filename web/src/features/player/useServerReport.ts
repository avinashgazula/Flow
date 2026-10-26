import { useEffect, type RefObject } from 'react'
import type { Source } from '../../lib/sources/types'
import { settingsStore } from '../../lib/store/settings'

/** Tells a media server what is playing when the source comes from one: started, progress, paused and stopped with
 *  how far in, so its Continue Watching and watched mark follow. Nothing loads for any other source, for the sample streams,
 *  or with Track Only With Your Tracking Service on; the reporter is its own chunk. `read` is the player's position
 *  and length (it keeps those in refs), and null before there is anything. */
export function useServerReport(video: RefObject<HTMLVideoElement | null>, active: boolean, source: Source | null, read: () => { position: number; duration: number } | null) {
  useEffect(() => {
    const s = settingsStore.get()
    const server = source && s.servers.find((v) => v.id === source.providerId && v.enabled)
    if (!active || !source || !server || s.trackOnlyWithTracker || source.origin === 'demo') return
    let stop: (() => void) | undefined
    let gone = false
    void import('../../lib/sources/report').then(({ startReporting }) => {
      if (!gone && video.current) stop = startReporting(video.current, server, source.id, read)
    })
    return () => {
      gone = true
      stop?.()
    }
    // `read` only looks at refs, so the first one is as good as the latest.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, source?.id])
}
