import { describe, expect, it } from 'vitest'
import { planReplay, replayDone } from './replay'

const en = { id: 'in:0', label: 'English', language: 'en' }
const fr = { id: 'in:1', label: 'French', language: 'fr' }
const forced = { id: 'in:2', label: 'English (Forced)', language: 'en' }
const broken = { id: 'in:3', label: 'German', language: 'de', unavailable: 'Picture subtitles aren’t supported yet' }

describe('What Did They Say? chooses', () => {
  it('only to go back when full subtitles are already on', () => {
    expect(planReplay([en, fr], 'in:1', ['en'])).toEqual({ kind: 'seek' })
  })

  it('a full track in the viewer’s language when they are off', () => {
    expect(planReplay([fr, en], null, ['en'])).toEqual({ kind: 'show', track: en })
    expect(planReplay([en, fr], null, ['fr', 'en'])).toEqual({ kind: 'show', track: fr })
  })

  it('the first full track when none is in their language', () => {
    expect(planReplay([fr], null, ['en'])).toEqual({ kind: 'show', track: fr })
  })

  it('counts the forced track as off, and never offers it or one that can’t be drawn', () => {
    expect(planReplay([forced, en], 'in:2', ['en'])).toEqual({ kind: 'show', track: en })
    expect(planReplay([forced, broken], null, ['en'])).toEqual({ kind: 'none' })
    expect(planReplay([], null, ['en'])).toEqual({ kind: 'none' })
  })
})

describe('when the replay ends', () => {
  const base = { startedAt: 1000, until: 100 }
  it('is a moment after the point where it was asked', () => {
    expect(replayDone({ ...base, now: 3000, time: 95 })).toBe(false)
    expect(replayDone({ ...base, now: 12000, time: 100.4 })).toBe(false)
    expect(replayDone({ ...base, now: 12000, time: 100.8 })).toBe(true)
  })
  it('is when the viewer goes back further, or after twenty seconds', () => {
    expect(replayDone({ ...base, now: 2000, time: 60 })).toBe(true)
    expect(replayDone({ ...base, now: 25000, time: 95 })).toBe(true)
  })
})
