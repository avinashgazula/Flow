import { useSyncExternalStore } from 'react'

/** Whether a CSS media query matches right now, following it as the window changes. Use it when a layout
 *  swaps whole pieces (one image, not two hidden ones) rather than restyling them: plain CSS does the rest. */
export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (notify) => {
      const list = matchMedia(query)
      list.addEventListener('change', notify)
      return () => list.removeEventListener('change', notify)
    },
    () => matchMedia(query).matches,
    () => false,
  )
}
