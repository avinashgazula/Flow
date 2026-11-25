/* How the lead turns: which slide a step or a swipe lands on. Pure, so the pointer code in Lead.tsx only measures. */

/** The slide `delta` steps from `at`, going round: past the last is the first. */
export const turnTo = (at: number, delta: number, count: number) => (count <= 0 ? 0 : (((at + delta) % count) + count) % count)

/** What a finished swipe does: -1 for the previous slide, 1 for the next, 0 to settle back. A swipe left (a negative
 *  `dx`) brings the next slide in, as a page turns. It takes a fifth of the width, or a quick flick in the same direction
 *  (`velocity`, in px per second), so a short slow drag that changes its mind doesn't turn the page. */
export function swipeTurn(dx: number, velocity: number, width: number): -1 | 0 | 1 {
  if (width <= 0 || dx === 0) return 0
  const far = Math.abs(dx) >= width * 0.2
  const flick = Math.abs(velocity) >= 500 && Math.sign(velocity) === Math.sign(dx)
  if (!far && !flick) return 0
  return dx < 0 ? 1 : -1
}
