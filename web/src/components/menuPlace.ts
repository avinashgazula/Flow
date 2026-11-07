/* Where a menu opens and how the keyboard moves in it, as plain functions so they can be tested without a browser. */

export interface Anchor {
  left: number
  top: number
  right: number
  bottom: number
}

/** A point (a right-click, a long press) is an anchor with no size. */
export const pointAnchor = (x: number, y: number): Anchor => ({ left: x, top: y, right: x, bottom: y })

/** The menu's top-left corner: under its anchor and starting at the anchor's left edge; flush with the anchor's right
 *  edge when that would run off the screen; above the anchor when there is no room below and there is above; always
 *  at least `margin` from every edge. */
export function placeMenu(anchor: Anchor, size: { width: number; height: number }, view: { width: number; height: number }, margin = 8, gap = 4): { left: number; top: number } {
  let left = anchor.left
  if (left + size.width > view.width - margin) left = anchor.right - size.width
  left = Math.max(margin, Math.min(left, view.width - margin - size.width))
  let top = anchor.bottom + gap
  if (top + size.height > view.height - margin && anchor.top - gap - size.height >= margin) top = anchor.top - gap - size.height
  top = Math.max(margin, Math.min(top, view.height - margin - size.height))
  return { left, top }
}

/** The item to focus after a key, or undefined when the key isn't one that moves: arrows wrap, Home and End go to the ends. */
export function nextItem(current: number, key: string, count: number): number | undefined {
  if (count < 1) return undefined
  switch (key) {
    case 'ArrowDown':
      return (current + 1) % count
    case 'ArrowUp':
      return (current - 1 + count) % count
    case 'Home':
      return 0
    case 'End':
      return count - 1
    default:
      return undefined
  }
}

/** How far a finger may drift during a long press before it is a scroll instead. */
export const pressSlop = 8
/** How long a finger rests before it is a long press. */
export const pressMs = 500

/** Whether a finger that has moved this far from where it landed has stopped pressing. */
export const drifted = (from: { x: number; y: number }, to: { x: number; y: number }) => Math.hypot(to.x - from.x, to.y - from.y) > pressSlop
