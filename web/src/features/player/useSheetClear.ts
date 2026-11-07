import { useEffect, useRef } from 'react'
import type { PlayerController } from './controller'

/** Tells the player where a panel stands (controller.setSheetClear), so the subtitles keep clear of it, and when it
 *  goes. Put the returned ref on the panel's element. */
export function useSheetClear<E extends HTMLElement>(controller: PlayerController, kind: 'panel' | 'shelf' | 'info') {
  const ref = useRef<E>(null)
  useEffect(() => {
    const el = ref.current
    const player = controller.root
    if (!el || !player) return
    const measure = () => controller.setSheetClear(kind, { width: el.offsetWidth, room: player.getBoundingClientRect().bottom - el.getBoundingClientRect().top })
    measure()
    if (typeof ResizeObserver === 'undefined') return () => controller.setSheetClear(kind, null)
    const watch = new ResizeObserver(measure)
    watch.observe(el)
    watch.observe(player)
    return () => {
      watch.disconnect()
      controller.setSheetClear(kind, null)
    }
  }, [controller, kind])
  return ref
}
