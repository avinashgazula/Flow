import { describe, expect, it } from 'vitest'
import { endLabel } from './format'
import { gapFractions, gapMask, otherMode } from './scrubberLayout'

describe('gapFractions', () => {
  it('cuts the track at every chapter after the opening', () => {
    const chapters = [{ title: 'One', start: 0 }, { title: 'Two', start: 25 }, { title: 'Three', start: 50 }]
    expect(gapFractions(chapters, [], 100)).toEqual([0.25, 0.5])
  })

  it('cuts at both ends of a skippable segment, and merges what lies together', () => {
    const chapters = [{ title: 'Intro', start: 10 }]
    const segments = [{ start: 10, end: 20 }, { start: 90, end: 100 }]
    // The credits end with the stream, which needs no cut; the intro begins where the chapter does.
    expect(gapFractions(chapters, segments, 100)).toEqual([0.1, 0.2, 0.9])
  })

  it('is empty until the length is known, or past the chapter limit', () => {
    expect(gapFractions([{ title: 'a', start: 5 }], [], Number.NaN)).toEqual([])
    expect(gapFractions([{ title: 'a', start: 5 }], [], 0)).toEqual([])
    const many = Array.from({ length: 60 }, (_, i) => ({ title: `${i}`, start: i * 10 }))
    expect(gapFractions(many, [], 1000)).toEqual([])
  })

  it('ignores a segment that begins at the very start', () => {
    expect(gapFractions([], [{ start: 0, end: 30 }], 120)).toEqual([0.25])
  })
})

describe('gapMask', () => {
  it('has none without gaps', () => {
    expect(gapMask([])).toBeUndefined()
  })

  it('leaves a 2px hole centred on each fraction', () => {
    const mask = gapMask([0.25])!
    expect(mask).toContain('#000 calc(25.000% - 1px)')
    expect(mask).toContain('transparent calc(25.000% - 1px) calc(25.000% + 1px)')
    expect(mask.startsWith('linear-gradient(to right, #000 0')).toBe(true)
    expect(mask.endsWith('#000 100%)')).toBe(true)
  })
})

describe('endLabel', () => {
  it('shows what is left with a minus sign, or the whole length', () => {
    expect(endLabel('remaining', 15, 60)).toBe('−0:45')
    expect(endLabel('total', 15, 3725)).toBe('1:02:05')
  })

  it('never goes below zero and shows dashes before the length is known', () => {
    expect(endLabel('remaining', 70, 60)).toBe('−0:00')
    expect(endLabel('remaining', 0, Number.NaN)).toBe('--:--')
  })
})

describe('otherMode', () => {
  it('toggles', () => {
    expect(otherMode('remaining')).toBe('total')
    expect(otherMode('total')).toBe('remaining')
  })
})
