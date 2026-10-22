import { useEffect, useRef, useState } from 'react'
import { Icon } from '../../components/Icon'
import type { Source } from '../../lib/sources'
import { keepFocus } from './Controls'
import type { PlayerController } from './controller'
import { codecName } from './format'
import { struggleDismissals } from './session'
import { bufferAhead, StruggleTracker, struggleText, type Cause, type StruggleFacts } from './struggle'
import s from './Controls.module.css'

const everyMs = 2000

interface Shown {
  cause: Cause
  facts: StruggleFacts
  /** The best source of a lower resolution that plays, when there is one. */
  lower: Source | undefined
}

/** Watches the picture while it plays and, when it stalls or drops frames for long enough, says so
 *  and offers a way out: a lower-resolution source if there is one, else another source. It looks
 *  at the element every two seconds into a tracker (struggle.ts has the rules) and re-renders only
 *  when it decides. It speaks once per playback, and never again for a title whose viewer chose Keep
 *  Watching. Mounted per source, so a new source starts a new watch. */
export function StruggleNotice({ controller, titleKey, sources, findLower, suppressed, onSwitch, onTryAnother }: {
  controller: PlayerController
  /** The title (a show counts once), for remembering Keep Watching. */
  titleKey: string
  /** The source list, so the offer is worked out again when more sources arrive. */
  sources: Source[]
  findLower: () => Source | undefined
  /** Another notice is up (No Sound): this one waits behind it. */
  suppressed: boolean
  onSwitch: (source: Source) => void
  onTryAnother: () => void
}) {
  const [shown, setShown] = useState<Shown | null>(null)
  const finished = useRef(struggleDismissals.has(titleKey))
  // The latest offer-finder, for the watch below, which is set up once.
  const lowerNow = useRef(findLower)
  useEffect(() => {
    lowerNow.current = findLower
  })

  useEffect(() => {
    const video = controller.video
    if (!video || finished.current) return
    const tracker = new StruggleTracker(performance.now())
    const counting = () => !video.paused && !video.seeking && document.visibilityState === 'visible'
    // One stall per stretch of waiting: the element says `waiting` once, and the poll below backs it up.
    let stalled = false
    const stall = () => {
      if (stalled || !counting()) return
      stalled = true
      tracker.stall(performance.now(), bufferAhead(video))
    }
    const settle = () => {
      stalled = false
      tracker.restart(performance.now())
    }
    const rates = () => {
      const net = controller.engine?.netStats?.()
      return { bytesPerSecond: net?.bytesPerSecond, bitrate: net?.bitrate }
    }
    let up = false
    const sample = () => {
      if (finished.current) return clearInterval(timer)
      if (!counting()) return
      if (video.readyState < 3) stall()
      const now = performance.now()
      const quality = video.getVideoPlaybackQuality?.()
      if (quality) tracker.sample({ at: now, dropped: quality.droppedVideoFrames, total: quality.totalVideoFrames, ahead: bufferAhead(video) })
      const verdict = tracker.judge(now, rates())
      if (verdict.struggling && !up) {
        up = true
        const { bytesPerSecond, bitrate } = rates()
        const info = controller.engine?.videoInfo?.()
        setShown({ cause: verdict.cause, facts: { height: video.videoHeight, codec: controller.source?.videoCodec ?? codecName(info?.codec), bytesPerSecond, bitrate }, lower: lowerNow.current() })
      } else if (!verdict.struggling && up) {
        // It passed: the notice goes, and doesn't come back for this playback.
        finished.current = true
        setShown(null)
        clearInterval(timer)
      }
    }
    const events: [string, EventListener][] = [
      ['waiting', stall],
      ['playing', () => (stalled = false)],
      ['seeking', settle],
      ['play', settle],
      ['visibilitychange', settle],
    ]
    for (const [name, fn] of events) (name === 'visibilitychange' ? document : video).addEventListener(name, fn)
    const timer = setInterval(sample, everyMs)
    return () => {
      clearInterval(timer)
      for (const [name, fn] of events) (name === 'visibilitychange' ? document : video).removeEventListener(name, fn)
    }
  }, [controller])

  // More sources can arrive after the notice is up: the offer follows them.
  useEffect(() => {
    setShown((now) => (now ? { ...now, lower: lowerNow.current() } : now))
  }, [sources])

  if (!shown || suppressed) return null
  const { cause, facts, lower } = shown
  const keepWatching = () => {
    finished.current = true
    struggleDismissals.add(titleKey)
    setShown(null)
  }
  return (
    <aside className={s.noSound} aria-label="Playback is struggling" role="status">
      <h2 className={s.noSoundTitle}>
        <Icon name="warning" size={18} strokeWidth={2.2} /> Playback Is Struggling
      </h2>
      <p className={s.noSoundText}>{struggleText(cause, facts)}</p>
      <div className={s.noSoundActions}>
        <button className="btn btn-primary btn-compact" onClick={lower ? () => onSwitch(lower) : onTryAnother} onMouseDown={keepFocus}>
          {lower?.resolution ? `Switch to ${lower.resolution}` : 'Try Another Source'}
        </button>
        <button className="btn btn-glass btn-compact" onClick={keepWatching} onMouseDown={keepFocus}>
          Keep Watching
        </button>
      </div>
    </aside>
  )
}
