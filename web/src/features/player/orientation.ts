/* Auto Rotate to Landscape. A page may lock the screen's orientation only while it is full screen, and only
   Chromium on Android does it: iOS Safari has no `screen.orientation.lock`, and a desktop browser refuses it. */

type Lockable = { orientation?: { lock?: (o: 'landscape') => Promise<void>; unlock?: () => void } }

const here = (): Lockable | undefined => (typeof screen === 'undefined' ? undefined : (screen as unknown as Lockable))
const touch = () => typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches

/** Whether this device can be turned by the page: a touch device whose browser has the lock call. */
export function canAutoRotate(scr: Lockable | undefined = here(), coarsePointer: boolean = touch()): boolean {
  return coarsePointer && typeof scr?.orientation?.lock === 'function'
}

/** Landscape while the player is full screen, released on leaving. A refusal is ignored: the picture still plays. */
export function rotateForFullscreen(full: boolean, enabled: boolean, scr: Lockable | undefined = here()): void {
  const o = scr?.orientation
  if (!o) return
  if (full) {
    if (enabled && canAutoRotate(scr)) void o.lock?.('landscape').catch(() => {})
    return
  }
  try {
    o.unlock?.()
  } catch {
    // Nothing was locked.
  }
}
