import { useSyncExternalStore } from 'react'

const query = '(max-width: 720px)'
const subscribe = (listener: () => void) => {
  const media = matchMedia(query)
  media.addEventListener('change', listener)
  return () => media.removeEventListener('change', listener)
}

/** True at phone width, where the title page puts the actions before the ratings so Play is on the first screen.
 *  It changes the order in the page itself, not just on screen, so Tab and a screen reader follow what is seen. */
export const usePhone = () =>
  useSyncExternalStore(
    subscribe,
    () => matchMedia(query).matches,
    () => false,
  )
