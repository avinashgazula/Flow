import { useEffect, type RefObject } from 'react'
import { settingsStore } from '../../../lib/store/settings'
import type { PlayerController } from '../controller'
import { pauseOpensXRay } from './xray'

/** How long the picture stays stopped before X-Ray comes up, so a pause that is really the start of a seek or a
 *  scrub, or that Play undoes straight away, doesn't flash a panel at the viewer. */
export const pauseDelay = 400

/** Brings X-Ray up when the viewer pauses (Settings → Playback → Show X-Ray When Paused), and takes it away again on
 *  Play if it came up by itself. This is all of X-Ray that loads with the player; the panel is its own chunk, fetched
 *  the first time it opens. `blocked` says whether something else has the viewer's attention. */
export function useXRayOnPause(controller: PlayerController, video: RefObject<HTMLVideoElement | null>, active: boolean, blocked: () => boolean) {
  useEffect(() => {
    const el = video.current
    if (!el || !active) return
    let timer = 0
    const paused = () => {
      clearTimeout(timer)
      timer = window.setTimeout(() => {
        const open = pauseOpensXRay({
          enabled: settingsStore.get().xrayWhenPaused !== false,
          paused: el.paused,
          ended: el.ended,
          scrubbing: controller.scrubbing,
          seeking: el.seeking,
          hidden: document.hidden,
          blocked: blocked(),
          panel: controller.get().panel,
        })
        if (open) controller.openXRay(true)
      }, pauseDelay)
    }
    const play = () => {
      clearTimeout(timer)
      if (controller.xrayAuto && controller.get().panel === 'xray') controller.setPanel(null)
    }
    el.addEventListener('pause', paused)
    el.addEventListener('play', play)
    return () => {
      clearTimeout(timer)
      el.removeEventListener('pause', paused)
      el.removeEventListener('play', play)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [controller, active])
}
