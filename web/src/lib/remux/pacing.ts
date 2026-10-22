/* Two small pieces of arithmetic the remux worker keeps: how fast the network is delivering, and how
   far ahead of the playhead it may read. Pure (the clock is an argument), so both are tested. */

/** Seconds of media to keep buffered ahead of the playhead: at most this, at least the floor, and
 *  between the two whatever the browser's buffer quota allows at the file's bitrate. */
export const AHEAD_MAX = 60
export const AHEAD_MIN = 8
/** What to aim for when the bitrate isn't known. */
export const AHEAD_TARGET = 30
/** What Flow expects the browser to hold ahead of the playhead, in bytes. Chrome's quota for video
 *  is about 150 MB for everything buffered, and measured in Chrome it fills at about 128 MB of
 *  buffer ahead (15 s of an 70 Mb/s file), so this stays under that: at 10 MB/s (an 80 Mb/s remux)
 *  it is about 11 s, at 3 MB/s a full 30. A browser that holds less says so (`pressure`) and the
 *  worker reads less far ahead; one that holds more is simply not used up. */
export const AHEAD_BUDGET_BYTES = 112 * 1024 * 1024

/** The most seconds worth reading ahead for a file averaging `bitrate` bytes per second (0 when unknown). */
export function aheadCapFor(bitrate: number): number {
  if (!(bitrate > 0)) return AHEAD_TARGET
  return Math.min(AHEAD_MAX, Math.max(AHEAD_MIN, Math.floor(AHEAD_BUDGET_BYTES / bitrate)))
}

/** How far ahead to read right now. It starts at the cap, drops when the browser's buffer says it is
 *  full, and climbs back toward the cap a little at a time, so a full buffer that was only full of
 *  played data (or of another tab's) isn't a limit for the rest of the film. Each time the buffer
 *  fills again the wait before the next climb doubles, so a real quota is probed rarely rather than hit every few seconds. */
export class AheadGovernor {
  private current: number
  private last = 0
  private strikes = 0

  constructor(
    private cap: number,
    private readonly min = AHEAD_MIN,
    private readonly step = 2,
    private readonly every = 10_000,
  ) {
    this.current = cap
  }

  /** A new file (or a new cap): back to full. */
  reset(cap: number) {
    this.cap = cap
    this.current = cap
    this.strikes = 0
  }

  /** The browser's buffer is full with `measured` seconds ahead of the playhead. */
  pressure(measured: number, now: number) {
    this.current = Math.max(this.min, Math.min(this.current, Math.floor(measured * 0.8)))
    this.strikes = Math.min(this.strikes + 1, 4)
    this.last = now
  }

  /** Seconds to read ahead at `now`. */
  value(now: number): number {
    if (this.current < this.cap && now - this.last >= this.every * 2 ** (this.strikes - 1)) {
      this.current = Math.min(this.cap, this.current + this.step)
      this.last = now
      if (this.current >= this.cap) this.strikes = 0
    }
    return this.current
  }

  get capped(): boolean {
    return this.current < this.cap
  }
}

/** Download rate over a moving window: bytes received divided by the time requests were open,
 *  not by wall time, so reading that stops while the buffer is full doesn't read as a slow network. */
export class RateMeter {
  private bytes: { t: number; n: number }[] = []
  private spans: { from: number; to: number | null }[] = []
  private held = 0

  constructor(
    private readonly window = 5000,
    /** Less open time than this in the window says nothing: the last answer stands. */
    private readonly minActive = 250,
  ) {}

  add(n: number, now: number) {
    this.bytes.push({ t: now, n })
  }

  /** Requests are open (true) or none are (false) from `now` on. */
  setActive(active: boolean, now: number) {
    const open = this.spans[this.spans.length - 1]
    const isOpen = open !== undefined && open.to === null
    if (active && !isOpen) this.spans.push({ from: now, to: null })
    else if (!active && isOpen) open.to = now
  }

  /** Bytes per second, 0 before anything has been measured. */
  rate(now: number): number {
    const from = now - this.window
    while (this.bytes.length && this.bytes[0]!.t <= from) this.bytes.shift()
    while (this.spans.length && (this.spans[0]!.to ?? Infinity) < from) this.spans.shift()
    let active = 0
    for (const s of this.spans) active += Math.min(s.to ?? now, now) - Math.max(s.from, from)
    if (active < this.minActive) return this.held
    let total = 0
    for (const b of this.bytes) total += b.n
    this.held = (total / active) * 1000
    return this.held
  }
}
