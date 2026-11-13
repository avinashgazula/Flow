/* How fast a picture is being converted, and what to do about it. Pure (the clock is an argument), so the rules are tested.

   Conversion is work the device does as the film plays: decode in WebAssembly, encode with WebCodecs. The meter counts
   only the time the worker was working (not the time it waited for the buffer to drain), so "1.8x" means the device can
   convert 1.8 seconds of film for every second it spends, whatever the buffer is doing. */

/** Decoding alone (before any encoding) below this, in the first second of film, is a slideshow in the making. The first
 *  frames run on code the engine hasn't warmed up yet, so it is lower than the real-time line. */
export const MIN_START_SPEED = 0.75
/** Seconds of film decoded before the start-up check says anything. */
export const START_CHECK_SECONDS = 1

/** Whether decoding is too slow to even try: `seconds` of film came out of `workMs` of work. */
export function tooSlowToStart(seconds: number, workMs: number): boolean {
  if (seconds < START_CHECK_SECONDS || workMs <= 0) return false
  return seconds / (workMs / 1000) < MIN_START_SPEED
}

export class ConversionMeter {
  private busyMs = 0
  private since: number | null = null
  private seconds = 0
  private marks: { busy: number; seconds: number }[] = []

  /** Work begins (true) or the worker waits (false) from `now` on. */
  busy(on: boolean, now: number) {
    if (on && this.since === null) this.since = now
    else if (!on && this.since !== null) {
      this.busyMs += now - this.since
      this.since = null
    }
  }

  /** Seconds of film that came out of the encoder. */
  produced(seconds: number) {
    this.seconds += seconds
  }

  private total(now: number): number {
    return this.busyMs + (this.since === null ? 0 : now - this.since)
  }

  /** Seconds of film converted per second of work over the last several seconds of work; null until there is a second of work to judge. */
  speed(now: number): number | null {
    const busy = this.total(now)
    this.marks.push({ busy, seconds: this.seconds })
    while (this.marks.length > 2 && busy - this.marks[1]!.busy >= 8000) this.marks.shift()
    const from = this.marks[0]!
    const span = busy - from.busy
    if (span >= 1000) return (this.seconds - from.seconds) / (span / 1000)
    return busy >= 1000 ? this.seconds / (busy / 1000) : null
  }
}

/** Escalating answers to a device that can't keep up: skip frames nothing refers to, then the loop filter, then say so once. */
export class ConversionPolicy {
  level: 0 | 1 | 2 = 0
  slow = false
  private strain = 0

  /** One look, about once a second: the measured speed and the seconds buffered ahead of the playhead. Returns the new skip level when it changed. */
  look(speed: number | null, ahead: number): 0 | 1 | 2 | null {
    if (speed === null || speed >= 1.1 || ahead >= 4) {
      this.strain = 0
      return null
    }
    if (++this.strain < 2) return null
    this.strain = 0
    if (this.level < 2) {
      this.level = (this.level + 1) as 1 | 2
      return this.level
    }
    this.slow = true
    return null
  }
}
