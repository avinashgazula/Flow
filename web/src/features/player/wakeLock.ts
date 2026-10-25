/* Keeps the screen awake while a film plays, with the Screen Wake Lock API: a phone or laptop would
   otherwise dim and sleep in the middle of a scene nobody touched the screen during. The lock is wanted only
   while the picture is playing and the page is showing; the browser drops it by itself when the page is
   hidden, so it is asked for again when the page comes back. Browsers without the API just go on as before. */

interface Sentinel {
  released: boolean
  release(): Promise<void>
  addEventListener(type: 'release', listener: () => void): void
}
export interface WakeLockApi {
  request(type: 'screen'): Promise<Sentinel>
}

/** Whether the lock is wanted: playing (not paused, not ended) and the page is on screen. */
export const wantsWakeLock = ({ paused, ended, hidden }: { paused: boolean; ended: boolean; hidden: boolean }): boolean => !paused && !ended && !hidden

export class ScreenAwake {
  private sentinel: Sentinel | null = null
  private wanted = false
  private asking = false

  constructor(private api: WakeLockApi | undefined = typeof navigator === 'undefined' ? undefined : (navigator as Navigator & { wakeLock?: WakeLockApi }).wakeLock) {}

  /** Says whether the lock is wanted now; takes it, or lets it go, to match. Safe to call as often as events come. */
  async update(wanted: boolean) {
    this.wanted = wanted
    if (!this.api) return
    if (!wanted) {
      const held = this.sentinel
      this.sentinel = null
      await held?.release().catch(() => {})
      return
    }
    if (this.sentinel && !this.sentinel.released) return
    if (this.asking) return
    this.asking = true
    try {
      const sentinel = await this.api.request('screen')
      // It may have stopped being wanted while the browser was answering.
      if (!this.wanted) {
        await sentinel.release().catch(() => {})
        return
      }
      sentinel.addEventListener('release', () => {
        if (this.sentinel === sentinel) this.sentinel = null
      })
      this.sentinel = sentinel
    } catch {
      // Refused (low battery, a policy, a background tab): the screen behaves as it would have.
    } finally {
      this.asking = false
    }
  }

  release() {
    return this.update(false)
  }
}
