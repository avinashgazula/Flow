/* Noticing that playback is struggling, and saying why. Pure, so the rules are tested; the player
   only feeds it what the video element reports every couple of seconds (Struggle.tsx).

   A film that stutters does it for one of two reasons the viewer can act on. The connection is too
   slow: the buffer runs dry and the picture waits. Or the device is: frames arrive in time and are
   thrown away because the decoder can't keep up, typically 4K HEVC or AV1 in software. Both look the
   same on screen, so the cause is told from the buffer: dry means the connection, healthy means the
   device. */

export type Cause = 'connection' | 'device' | 'unknown'

export const limits = {
  /** Nothing counts this long after the start or a seek: a stream is allowed to settle. */
  settleMs: 8000,
  /** Dropped frames are judged over this long, and only with enough frames to mean something. */
  windowMs: 10_000,
  minFrames: 100,
  /** More than this share of frames dropped starts a struggle; at or under `clearRatio` it ends one. */
  dropRatio: 0.08,
  clearRatio: 0.03,
  /** This many stalls in `stallWindowMs` starts one; none in it ends one. */
  stalls: 2,
  stallWindowMs: 60_000,
  /** Seconds buffered ahead: under `dryAhead` the buffer ran out, from `healthyAhead` it's fine. */
  dryAhead: 1.5,
  healthyAhead: 5,
  /** The connection only counts as the problem when it's slower than the file's own rate with this much room. */
  headroom: 1.15,
} as const

export interface Sample {
  /** Milliseconds, on any clock that only goes forward. */
  at: number
  /** `getVideoPlaybackQuality()`'s counters: they only grow, until the stream is replaced. */
  dropped: number
  total: number
  /** Seconds buffered ahead of the playhead. */
  ahead: number
}

export interface Stall {
  at: number
  /** Seconds buffered ahead when it stopped. */
  ahead: number
}

/** What the engine knows about the download, in bytes a second. Either can be unknown. */
export interface Rates {
  bytesPerSecond?: number
  bitrate?: number
}

export interface Verdict {
  struggling: boolean
  cause: Cause
  /** Share of frames dropped in the window, when it held enough frames to say. */
  dropRatio?: number
  /** Stalls in the last minute, the start and seeks left out. */
  stalls: number
}

export interface Evidence {
  now: number
  /** When the stream last started or was sought. */
  settledFrom: number
  samples: readonly Sample[]
  stalls: readonly Stall[]
  rates: Rates
  /** The verdict before this one, so a struggle doesn't end the moment a number dips. */
  was: boolean
}

const quiet: Verdict = { struggling: false, cause: 'unknown', stalls: 0 }

/** The share of frames dropped over the window, or undefined when it holds too few frames. */
export function dropRatio(samples: readonly Sample[], now: number, settledFrom: number): number | undefined {
  const from = Math.max(now - limits.windowMs, settledFrom + limits.settleMs)
  const window = samples.filter((s) => s.at >= from && s.at <= now)
  const first = window[0]
  const last = window[window.length - 1]
  if (!first || !last) return undefined
  const frames = last.total - first.total
  if (frames < limits.minFrames) return undefined
  return Math.max(0, last.dropped - first.dropped) / frames
}

/** Decides whether playback is struggling, and if so why. */
export function judge({ now, settledFrom, samples, stalls, rates, was }: Evidence): Verdict {
  if (now < settledFrom + limits.settleMs) return quiet
  const counted = stalls.filter((s) => s.at >= settledFrom + limits.settleMs && s.at >= now - limits.stallWindowMs && s.at <= now)
  const ratio = dropRatio(samples, now, settledFrom)
  const struggling = was ? counted.length > 0 || (ratio ?? 0) > limits.clearRatio : counted.length >= limits.stalls || (ratio ?? 0) > limits.dropRatio
  if (!struggling) return { struggling, cause: 'unknown', dropRatio: ratio, stalls: counted.length }

  const dry = counted.some((s) => s.ahead < limits.dryAhead)
  const { bytesPerSecond, bitrate } = rates
  // A download that outruns the file with room to spare isn't what stopped it. Unknown rates can't say so.
  const slow = !(bytesPerSecond && bitrate && bytesPerSecond >= limits.headroom * bitrate)
  if (dry && slow) return { struggling, cause: 'connection', dropRatio: ratio, stalls: counted.length }

  const recent = samples.filter((s) => s.at >= now - limits.windowMs && s.at >= settledFrom + limits.settleMs)
  const healthy = recent.length > 0 && Math.min(...recent.map((s) => s.ahead)) >= limits.healthyAhead
  const cause: Cause = (ratio ?? 0) > limits.clearRatio && healthy ? 'device' : 'unknown'
  return { struggling, cause, dropRatio: ratio, stalls: counted.length }
}

/** Keeps what `judge` needs: the recent samples and stalls since the stream last started or was sought. */
export class StruggleTracker {
  private samples: Sample[] = []
  private stalls: Stall[] = []
  private settledFrom: number
  private was = false

  constructor(now: number) {
    this.settledFrom = now
  }

  /** The stream started over (a seek, a new source): what came before says nothing about what follows. */
  restart(now: number) {
    this.settledFrom = now
    this.samples = []
    this.stalls = []
    this.was = false
  }

  /** The picture stopped for want of data. Ignored while the stream settles. */
  stall(now: number, ahead: number) {
    if (now < this.settledFrom + limits.settleMs) return
    this.stalls.push({ at: now, ahead })
    this.stalls = this.stalls.filter((s) => s.at >= now - limits.stallWindowMs)
  }

  /** Counters that went backwards mean the element started a new stream under us: begin again. */
  sample(s: Sample) {
    const last = this.samples[this.samples.length - 1]
    if (last && (s.total < last.total || s.dropped < last.dropped)) this.samples = []
    this.samples.push(s)
    this.samples = this.samples.filter((x) => x.at >= s.at - limits.windowMs - 1000)
  }

  judge(now: number, rates: Rates): Verdict {
    const verdict = judge({ now, settledFrom: this.settledFrom, samples: this.samples, stalls: this.stalls, rates, was: this.was })
    this.was = verdict.struggling
    return verdict
  }
}

// MARK: Words

/** How a picture's size is said: by what the source calls it ("2160p" is "4K"), else by the picture
 *  itself. A widescreen 4K film is 3840 by 1600, so width counts as much as height. */
export function sizeName(resolution: string | undefined, width?: number, height?: number): string | undefined {
  if (resolution) return resolution === '2160p' ? '4K' : resolution
  if (!width && !height) return undefined
  const w = width ?? 0
  const h = height ?? 0
  if (w >= 3200 || h >= 2000) return '4K'
  if (w >= 2400 || h >= 1300) return '1440p'
  if (w >= 1700 || h >= 900) return '1080p'
  if (w >= 1200 || h >= 650) return '720p'
  return h ? `${h}p` : undefined
}

/** "12.4 Mb/s": bytes a second as megabits, one decimal under ten. */
export function megabits(bytesPerSecond: number): string {
  const mb = (bytesPerSecond * 8) / 1_000_000
  return `${mb < 10 ? mb.toFixed(1) : Math.round(mb)} Mb/s`
}

export interface StruggleFacts {
  /** "4K", "1080p": see `sizeName`. */
  size?: string
  /** "HEVC", "AV1": as the source names it. */
  codec?: string
  bytesPerSecond?: number
  bitrate?: number
}

/** What the notice says, for each cause. Says only what's known: no numbers when there are none. */
export function struggleText(cause: Cause, { size, codec, bytesPerSecond, bitrate }: StruggleFacts): string {
  if (cause === 'device') {
    const what = size && codec ? `${size} ${codec}` : size ? `${size} video` : codec ? `${codec} video` : 'this video'
    return `This device can’t keep up with ${what} here.`
  }
  if (cause === 'connection') {
    if (bytesPerSecond && bitrate) return `The file isn’t arriving fast enough: about ${megabits(bytesPerSecond)}, and it needs ${megabits(bitrate)}.`
    if (bytesPerSecond) return `The file isn’t arriving fast enough: about ${megabits(bytesPerSecond)}.`
    return 'The file isn’t arriving fast enough.'
  }
  return 'Playback keeps stalling or dropping frames.'
}

// MARK: The element

/** Seconds buffered from the playhead on, in the range that holds it (0 when it isn't buffered). */
export function bufferAhead(video: { currentTime: number; buffered: { length: number; start(i: number): number; end(i: number): number } }): number {
  const t = video.currentTime
  for (let i = 0; i < video.buffered.length; i++) {
    if (video.buffered.start(i) <= t + 0.1 && video.buffered.end(i) >= t) return Math.max(0, video.buffered.end(i) - t)
  }
  return 0
}
