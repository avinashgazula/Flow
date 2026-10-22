import type { MouseEvent } from 'react'

/** Names the tapped card's artwork for the View Transitions zoom into its page, like the TV app's
 *  card that grows into the title. Only one element may hold the name, so it's cleared afterwards. */
export function markZoomSource(event: MouseEvent<HTMLElement>) {
  const art = event.currentTarget.querySelector<HTMLElement>('[data-zoom]')
  if (!art || !document.startViewTransition) return
  // The page being left may hold the name already (a title page's own artwork).
  document.querySelectorAll<HTMLElement>('[style*="title-art"]').forEach((el) => (el.style.viewTransitionName = ''))
  art.style.viewTransitionName = 'title-art'
  setTimeout(() => (art.style.viewTransitionName = ''), 700)
}
