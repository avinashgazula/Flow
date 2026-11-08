/* Subtitle auto-sync, ported from the apps' FlowKit `SubtitleSync`: finds the delay that lines a subtitle file up
   with a film's dialogue. Where there's speech in the soundtrack there should be a cue on screen, so both sides
   are reduced to on/off per 100 ms frame and compared at every shift. */

export interface CueSpan {
  start: number
  end: number
}

/** Swift's `.rounded()`: halves go away from zero (Math.round sends -0.5 up). */
const round = (x: number) => Math.sign(x) * Math.round(Math.abs(x))

/** Voice activity from audio that arrives in pieces, so a long window never sits in memory as PCM: only each
 *  frame's energy is kept. */
export class SpeechAnalyzer {
  private readonly frameSamples: number
  // One-pole filters keep speech (about 150 Hz to 3.5 kHz) and drop rumble and hiss.
  private readonly highPass: number
  private readonly lowPass: number
  private hpIn = 0
  private hpOut = 0
  private lp = 0
  private sum = 0
  private count = 0
  private energies: number[] = []

  constructor(
    readonly sampleRate: number,
    readonly frame = 0.1,
  ) {
    this.frameSamples = Math.max(1, round(sampleRate * frame))
    const dt = 1 / sampleRate
    const hpRC = 1 / (2 * Math.PI * 150)
    const lpRC = 1 / (2 * Math.PI * 3500)
    this.highPass = hpRC / (hpRC + dt)
    this.lowPass = dt / (lpRC + dt)
  }

  /** Feeds consecutive mono samples. */
  append(samples: ArrayLike<number>) {
    for (let i = 0; i < samples.length; i++) {
      const x = samples[i]!
      this.hpOut = this.highPass * (this.hpOut + x - this.hpIn)
      this.hpIn = x
      this.lp += this.lowPass * (this.hpOut - this.lp)
      this.sum += this.lp * this.lp
      if (++this.count === this.frameSamples) {
        this.energies.push(this.sum / this.count)
        this.sum = 0
        this.count = 0
      }
    }
  }

  /** Frames so far, a trailing part-frame of at least half a frame included. */
  get frameCount(): number {
    return this.energies.length + (this.count * 2 >= this.frameSamples ? 1 : 0)
  }

  /** The estimate for everything fed in: a frame is speech when its energy clears a threshold set between the
   *  quiet floor and the loud end of this window, then gaps between words are bridged and blips dropped. */
  finish(): boolean[] {
    const all = [...this.energies]
    if (this.count * 2 >= this.frameSamples) all.push(this.sum / this.count)
    if (all.length < 10) return all.map(() => false)
    const db = all.map((e) => 10 * Math.log10(e + 1e-12))
    const sorted = [...db].sort((a, b) => a - b)
    const low = sorted[Math.floor((sorted.length - 1) * 0.1)]!
    const high = sorted[Math.floor((sorted.length - 1) * 0.9)]!
    // A flat window (silence, or a steady tone) has no speech to find.
    if (high - low < 6) return all.map(() => false)
    const threshold = low + 0.4 * (high - low)
    return smooth(
      db.map((d) => d > threshold),
      round(0.4 / this.frame),
      round(0.2 / this.frame),
    )
  }
}

/** Closes silences of up to `bridge` frames between speech, then drops speech shorter than `minimum`. */
export function smooth(on: boolean[], bridge: number, minimum: number): boolean[] {
  const out = [...on]
  const runs = (value: boolean): [number, number][] => {
    const found: [number, number][] = []
    let i = 0
    while (i < out.length) {
      if (out[i] !== value) {
        i++
        continue
      }
      let j = i
      while (j < out.length && out[j] === value) j++
      found.push([i, j])
      i = j
    }
    return found
  }
  for (const [from, to] of runs(false)) if (from > 0 && to < out.length && to - from <= bridge) out.fill(true, from, to)
  for (const [from, to] of runs(true)) if (to - from < minimum) out.fill(false, from, to)
  return out
}

/** Speech or not for each `frame` seconds of mono audio. */
export function speechActivity(samples: ArrayLike<number>, sampleRate: number, frame = 0.1): boolean[] {
  const analyzer = new SpeechAnalyzer(sampleRate, frame)
  analyzer.append(samples)
  return analyzer.finish()
}

/** Whether a cue is on screen at the middle of each `frame`-second frame from `from` up to `to`. */
export function cueActivity(cues: readonly CueSpan[], from: number, to: number, frame: number): boolean[] {
  const count = Math.max(0, Math.ceil((to - from) / frame))
  const out = new Array<boolean>(count).fill(false)
  for (const cue of cues) {
    if (!(cue.end > from && cue.start < to)) continue
    // Frame i is centred on from + (i + 0.5) * frame.
    const first = Math.max(0, Math.ceil((cue.start - from) / frame - 0.5))
    const last = Math.min(count - 1, Math.ceil((cue.end - from) / frame - 0.5) - 1)
    if (first <= last) out.fill(true, first, last + 1)
  }
  return out
}

export interface SyncMatch {
  offset: number
  confidence: number
}

/** The offset (seconds; positive shows subtitles later, as the delay does) at which the cues agree best with
 *  `speech`, which starts at `start` seconds of the film. Agreement is the correlation of the two on/off signals.
 *  Confidence is how far the best shift stands above the typical one; null when nothing stands out. */
export function bestOffset(
  speech: readonly boolean[],
  cues: readonly CueSpan[],
  { start = 0, frame = 0.1, range = [-15, 15], step = 0.1, minimumConfidence = 0.15 }: { start?: number; frame?: number; range?: [number, number]; step?: number; minimumConfidence?: number } = {},
): SyncMatch | null {
  if (speech.length < 100 || !speech.includes(true)) return null
  const reach = Math.ceil(Math.max(Math.abs(range[0]), Math.abs(range[1])) / frame) + 1
  const cueOnAt = cueActivity(cues, start - reach * frame, start + (speech.length + reach) * frame, frame)
  if (!cueOnAt.includes(true)) return null

  const stride = Math.max(1, round(step / frame))
  const lowest = Math.ceil(range[0] / frame)
  const highest = Math.floor(range[1] / frame)
  const n = speech.length
  const speechOn = speech.reduce((sum, on) => sum + (on ? 1 : 0), 0)
  const speechVariance = (speechOn / n) * (1 - speechOn / n)
  if (!(speechVariance > 0)) return null

  const scored: { shift: number; score: number }[] = []
  for (let shift = lowest; shift <= highest; shift += stride) {
    // Speech frame i lines up with the cue that played `shift` frames earlier.
    let cueOn = 0
    let both = 0
    for (let i = 0; i < n; i++) {
      const j = i - shift + reach
      if (j < 0 || j >= cueOnAt.length || !cueOnAt[j]) continue
      cueOn++
      if (speech[i]) both++
    }
    const cueVariance = (cueOn / n) * (1 - cueOn / n)
    if (!(cueVariance > 0)) {
      scored.push({ shift, score: 0 })
      continue
    }
    const covariance = both / n - (speechOn / n) * (cueOn / n)
    scored.push({ shift, score: covariance / Math.sqrt(speechVariance * cueVariance) })
  }
  if (scored.length === 0) return null
  const best = scored.reduce((a, b) => (b.score > a.score ? b : a))
  const middle = scored.map((s) => s.score).sort((a, b) => a - b)[Math.floor(scored.length / 2)]!
  const confidence = best.score - middle
  if (!(best.score > 0) || confidence < minimumConfidence) return null
  return { offset: best.shift * frame, confidence }
}
