import { describe, expect, it } from 'vitest'
import { SpeechAnalyzer, bestOffset, cueActivity, speechActivity, type CueSpan } from './sync'

/** Small deterministic generator (mulberry32), so a failing run can be repeated. */
function generator(seed: number) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Cues of 1.5 to 4 s with 0.5 to 5 s between them, across `length` seconds. */
function makeCues(length: number, seed: number): CueSpan[] {
  const random = generator(seed)
  const cues: CueSpan[] = []
  let t = 2
  while (t < length) {
    const duration = 1.5 + random() * 2.5
    cues.push({ start: t, end: t + duration })
    t += duration + 0.5 + random() * 4.5
  }
  return cues
}

/** Dialogue that sits `delay` seconds after the cues, with a few frames flipped the way a real detector errs. */
function speechFor(cues: CueSpan[], delay: number, length: number, flips: number, seed: number): boolean[] {
  const random = generator(seed)
  const shifted = cues.map((c) => ({ start: c.start + delay, end: c.end + delay }))
  return cueActivity(shifted, 0, length, 0.1).map((on) => (random() < flips ? !on : on))
}

describe('cue activity', () => {
  it('marks the frames under a cue', () => {
    const frames = cueActivity([{ start: 1, end: 2 }], 0, 3, 0.1)
    expect(frames).toHaveLength(30)
    expect(frames.filter(Boolean)).toHaveLength(10)
    expect(frames[9]).toBe(false)
    expect(frames[10]).toBe(true)
    expect(frames[19]).toBe(true)
    expect(frames[20]).toBe(false)
  })
})

describe('best offset', () => {
  it('recovers known shifts', () => {
    const length = 180
    const cues = makeCues(length + 60, 7)
    for (const delay of [-7.3, -2.4, 0, 0.8, 3.7, 12]) {
      const result = bestOffset(speechFor(cues, delay, length, 0.1, 99), cues)
      expect(result, `no match for ${delay}`).not.toBeNull()
      expect(Math.abs(result!.offset - delay)).toBeLessThanOrEqual(0.2 + 1e-9)
      expect(result!.confidence).toBeGreaterThan(0.3)
    }
  })

  it('finds the shift in a window away from the start of the film', () => {
    const cues = makeCues(2000, 21)
    const window = speechFor(cues, 1.9, 1200, 0.1, 5)
    const result = bestOffset(window.slice(6000, 7800), cues, { start: 600 })
    expect(result).not.toBeNull()
    expect(Math.abs(result!.offset - 1.9)).toBeLessThanOrEqual(0.2 + 1e-9)
  })

  it('searches only the range it is given', () => {
    const cues = makeCues(240, 7)
    const signal = speechFor(cues, 12, 180, 0.1, 99)
    const found = bestOffset(signal, cues, { range: [-10, 10] })
    expect(found === null || Math.abs(found.offset) <= 10).toBe(true)
  })

  it('gives no match for noise', () => {
    const cues = makeCues(240, 3)
    for (let seed = 1; seed <= 5; seed++) {
      const random = generator(seed)
      const noise = Array.from({ length: 1800 }, () => random() < 0.5)
      expect(bestOffset(noise, cues), `seed ${seed}`).toBeNull()
    }
  })

  it('gives no match when there is nothing to compare', () => {
    const cues = makeCues(240, 3)
    expect(bestOffset(new Array(1800).fill(false), cues)).toBeNull()
    expect(bestOffset(new Array(1800).fill(true), cues)).toBeNull()
    expect(bestOffset([], cues)).toBeNull()
    expect(bestOffset(speechFor(cues, 0, 180, 0, 1), [])).toBeNull()
  })
})

describe('speech activity', () => {
  const rate = 16_000

  /** Tone bursts in a hiss. */
  function bursts() {
    const random = generator(11)
    const samples = new Float32Array(rate * 30)
    for (let second = 0; second < 30; second++) {
      const talking = second % 3 !== 2
      for (let n = 0; n < rate; n++) {
        const hiss = (random() * 2 - 1) * 0.01
        const t = n / rate
        const voice = talking ? 0.3 * Math.sin(2 * Math.PI * 300 * t) * (0.6 + 0.4 * Math.sin(2 * Math.PI * 4 * t)) : 0
        samples[second * rate + n] = hiss + voice
      }
    }
    return samples
  }

  it('follows the bursts, including when the audio arrives in odd-sized pieces', () => {
    const samples = bursts()
    const whole = speechActivity(samples, rate)
    expect(whole).toHaveLength(300)
    whole.forEach((on, i) => {
      // Only frames well inside a burst or a pause are judged.
      const phase = (i * 0.1) % 3
      if (phase > 0.3 && phase < 1.7) expect(on, `frame ${i}`).toBe(true)
      if (phase > 2.3 && phase < 2.7) expect(on, `frame ${i}`).toBe(false)
    })
    const analyzer = new SpeechAnalyzer(rate)
    let start = 0
    for (const size of [777, 4096, 1, 15_000, 99_999]) {
      if (start >= samples.length) break
      const end = Math.min(samples.length, start + size)
      analyzer.append(samples.subarray(start, end))
      start = end
    }
    analyzer.append(samples.subarray(start))
    expect(analyzer.finish()).toEqual(whole)
    expect(analyzer.frameCount).toBe(300)
  })

  it('does not take rumble or silence for speech', () => {
    const rumble = Float32Array.from({ length: rate * 20 }, (_, i) => 0.5 * Math.sin((2 * Math.PI * 40 * i) / rate))
    expect(speechActivity(rumble, rate)).not.toContain(true)
    expect(speechActivity(new Float32Array(rate * 20), rate)).not.toContain(true)
  })
})
