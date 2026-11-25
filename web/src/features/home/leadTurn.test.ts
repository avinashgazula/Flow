import { describe, expect, it } from 'vitest'
import { swipeTurn, turnTo } from './leadTurn'

describe('turning the lead', () => {
  it('goes round in both directions', () => {
    expect(turnTo(0, 1, 10)).toBe(1)
    expect(turnTo(9, 1, 10)).toBe(0)
    expect(turnTo(0, -1, 10)).toBe(9)
    expect(turnTo(0, 1, 0)).toBe(0)
  })

  it('turns on a long swipe, left for the next slide and right for the previous', () => {
    expect(swipeTurn(-120, 0, 390)).toBe(1)
    expect(swipeTurn(120, 0, 390)).toBe(-1)
  })

  it('settles back from a short, slow drag', () => {
    expect(swipeTurn(-40, -100, 390)).toBe(0)
    expect(swipeTurn(0, 0, 390)).toBe(0)
    expect(swipeTurn(-40, 0, 0)).toBe(0)
  })

  it('turns on a quick flick, but not one that goes the other way from the drag', () => {
    expect(swipeTurn(-30, -900, 390)).toBe(1)
    expect(swipeTurn(-30, 900, 390)).toBe(0)
  })
})
