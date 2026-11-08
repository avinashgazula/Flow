import { describe, expect, it } from 'vitest'
import { ListenSession, listenSeconds } from './listen'
import { cueActivity, type CueSpan } from './sync'

const rate = 8000

/** Dialogue as tone bursts wherever a cue (moved `delay` later) is on screen, over a quiet hiss. */
function dialogue(cues: CueSpan[], delay: number, from: number, seconds: number): Float32Array {
  const on = cueActivity(
    cues.map((c) => ({ start: c.start + delay, end: c.end + delay })),
    from,
    from + seconds,
    0.1,
  )
  const out = new Float32Array(seconds * rate)
  for (let i = 0; i < out.length; i++) {
    const talking = on[Math.floor(i / (rate * 0.1))]
    out[i] = ((i * 7919) % 101) / 101 * 0.004 + (talking ? 0.3 * Math.sin((2 * Math.PI * 300 * i) / rate) : 0)
  }
  return out
}

const cues: CueSpan[] = Array.from({ length: 60 }, (_, i) => ({ start: 3 + i * 4.3, end: 3 + i * 4.3 + 1.2 + (i % 3) * 0.7 }))

function feed(session: ReturnType<typeof makeSession>, audio: Float32Array) {
  for (let at = 0; at < audio.length; at += 4096) {
    const heard = session.push(audio.subarray(at, at + 4096))
    if (heard.done) return heard
  }
  return { done: false as const }
}
const makeSession = () => new ListenSession(rate, cues)

describe('listening for sync', () => {
  it('finds the delay of a stretch of dialogue, and stops once sure', () => {
    const session = makeSession()
    session.begin(40)
    const result = feed(session, dialogue(cues, 2.5, 40, listenSeconds))
    expect(result.done).toBe(true)
    if (!result.done) return
    expect(result.match).not.toBeNull()
    expect(Math.abs(result.match!.offset - 2.5)).toBeLessThanOrEqual(0.2 + 1e-9)
    expect(session.heard).toBeLessThan(listenSeconds + 1)
  })

  it('counts a restart from the new position', () => {
    const session = makeSession()
    session.begin(0)
    session.push(new Float32Array(rate * 10))
    expect(session.heard).toBe(10)
    session.begin(100)
    expect(session.heard).toBe(0)
    const result = feed(session, dialogue(cues, -3, 100, listenSeconds))
    expect(result.done && result.match && Math.abs(result.match.offset + 3) <= 0.2 + 1e-9).toBe(true)
  })

  it('ends with no match when it only hears silence', () => {
    const session = makeSession()
    session.begin(40)
    // Quiet is not the same as nothing at all: this hiss is a real soundtrack with no dialogue in it.
    const hiss = Float32Array.from({ length: rate * listenSeconds }, (_, i) => (((i * 7919) % 101) / 101 - 0.5) * 0.01)
    session.begin(40)
    expect(feed(session, hiss)).toEqual({ done: true, match: null })
  })

  it('says so when the sound is withheld', () => {
    const session = makeSession()
    session.begin(40)
    const result = feed(session, new Float32Array(rate * listenSeconds))
    expect(result).toEqual({ done: true, match: null, silent: true })
    expect(session.heard).toBeLessThan(20)
  })
})
