import { describe, expect, it } from 'vitest'
import { activeCueText, clampDelay, delayLabel, rememberDelay, rememberedDelay } from './subtitleDelay'

const cue = (startTime: number, endTime: number, text: string) => ({ startTime, endTime, text })

describe('the delay', () => {
  it('stays on the grid of tenths, inside ten seconds either way', () => {
    expect(clampDelay(0.1 + 0.2)).toBe(0.3)
    expect(clampDelay(12)).toBe(10)
    expect(clampDelay(-99)).toBe(-10)
    expect(clampDelay(Number.NaN)).toBe(0)
    expect(Object.is(clampDelay(-0.04), 0)).toBe(true)
  })

  it('reads as a signed number of seconds', () => {
    expect(delayLabel(0)).toBe('0.0 s')
    expect(delayLabel(1.5)).toBe('+1.5 s')
    expect(delayLabel(-0.3)).toBe('−0.3 s')
    expect(delayLabel(10)).toBe('+10.0 s')
  })

  it('is remembered for a title, and forgotten when put back to none', () => {
    expect(rememberedDelay('show:1')).toBe(0)
    rememberDelay('show:1', 2.5)
    expect(rememberedDelay('show:1')).toBe(2.5)
    expect(rememberedDelay('movie:2')).toBe(0)
    rememberDelay('show:1', 0)
    expect(rememberedDelay('show:1')).toBe(0)
    rememberDelay(undefined, 3)
    expect(rememberedDelay(undefined)).toBe(0)
  })
})

describe('which subtitles show with a delay', () => {
  const cues = [cue(10, 12, 'One'), cue(11, 14, 'Two'), cue(20, 22, 'Three'), cue(100, 101, 'Four')]

  it('shows them as written with none', () => {
    expect(activeCueText(cues, 9.9, 0)).toBe('')
    expect(activeCueText(cues, 10, 0)).toBe('One')
    expect(activeCueText(cues, 11.5, 0)).toBe('One\nTwo')
    expect(activeCueText(cues, 12, 0)).toBe('Two')
    expect(activeCueText(cues, 14, 0)).toBe('')
  })

  it('shows them later with a positive delay', () => {
    expect(activeCueText(cues, 10.5, 1)).toBe('')
    expect(activeCueText(cues, 11, 1)).toBe('One')
    expect(activeCueText(cues, 13.5, 1)).toBe('Two')
    expect(activeCueText(cues, 22.9, 1)).toBe('Three')
    expect(activeCueText(cues, 23, 1)).toBe('')
  })

  it('shows them earlier with a negative one', () => {
    expect(activeCueText(cues, 19, -1)).toBe('Three')
    expect(activeCueText(cues, 18.9, -1)).toBe('')
    expect(activeCueText(cues, 99.5, -0.5)).toBe('Four')
  })

  it('copes with no cues and with a long cue still showing', () => {
    expect(activeCueText([], 50, 0)).toBe('')
    expect(activeCueText([cue(0, 25, 'Long'), cue(30, 31, 'x')], 20, 0)).toBe('Long')
  })
})
