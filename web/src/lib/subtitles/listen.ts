import { SpeechAnalyzer, bestOffset, type CueSpan, type SyncMatch } from './sync'

/* How long auto-sync listens, and when it has heard enough. The apps read three minutes of the soundtrack
   straight from the file; a browser can only hear what plays, in real time, so it listens for a minute and
   stops sooner when the answer is already clear. */

export const listenSeconds = 60
const firstCheck = 30
const checkEvery = 10
/** Stricter than the final answer, since stopping early means no second chance. */
const earlyConfidence = 0.3
/** The page's own delay stops at ten seconds either way. */
const reach: [number, number] = [-10, 10]

/** `silent`: every sample was exactly zero, which a real soundtrack never is for this long but a stream the browser
 *  won't let the page hear always is. */
export type Heard = { done: false } | { done: true; match: SyncMatch | null; silent?: true }

/** Seconds of pure zeros before it counts as the browser withholding the sound. */
const deafAfter = 15

export class ListenSession {
  private analyzer: SpeechAnalyzer
  private samples = 0
  private checkedAt = 0
  private start = 0
  private quiet = true

  constructor(
    private sampleRate: number,
    private cues: readonly CueSpan[],
  ) {
    this.analyzer = new SpeechAnalyzer(sampleRate)
  }

  /** Starts over from `at` seconds of the film: the audio before was cut off by a pause, a seek or a stall,
   *  and frames either side of a gap wouldn't be in time with each other. */
  begin(at: number) {
    this.analyzer = new SpeechAnalyzer(this.sampleRate)
    this.samples = 0
    this.checkedAt = 0
    this.start = at
    this.quiet = true
  }

  /** Seconds of audio heard since `begin`. */
  get heard(): number {
    return this.samples / this.sampleRate
  }

  push(samples: ArrayLike<number>): Heard {
    this.analyzer.append(samples)
    this.samples += samples.length
    if (this.quiet) for (let i = 0; i < samples.length; i++) if (samples[i] !== 0) { this.quiet = false; break }
    const heard = this.heard
    if (this.quiet && heard >= deafAfter) return { done: true, match: null, silent: true }
    if (heard >= listenSeconds) return { done: true, match: this.match(0.15) }
    if (heard >= firstCheck && heard - this.checkedAt >= checkEvery) {
      this.checkedAt = heard
      const match = this.match(earlyConfidence)
      if (match) return { done: true, match }
    }
    return { done: false }
  }

  private match(minimumConfidence: number): SyncMatch | null {
    return bestOffset(this.analyzer.finish(), this.cues, { start: this.start, range: reach, minimumConfidence })
  }
}
