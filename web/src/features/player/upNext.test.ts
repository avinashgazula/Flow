import { describe, expect, it } from 'vitest'
import { secondsToEnd, upNextDueAt } from './UpNext'

describe('when Up Next comes up', () => {
  it('is as the credits begin when a segment says where', () => {
    expect(upNextDueAt(2700, 2600)).toBe(2600)
  })

  it('is the last 30 seconds without one', () => {
    expect(upNextDueAt(2700, undefined)).toBe(2670)
  })

  it('waits for the length, and for a stream long enough to have a tail', () => {
    expect(upNextDueAt(Number.NaN, 2600)).toBeUndefined()
    expect(upNextDueAt(45, undefined)).toBeUndefined()
    expect(upNextDueAt(45, 30)).toBe(30)
    expect(upNextDueAt(25, 10)).toBeUndefined()
  })
})

describe('Wait for the Episode to End', () => {
  it('brings the card up just early enough for its countdown to end with the episode, credits or not', () => {
    expect(upNextDueAt(2700, 2600, true)).toBe(2689)
    expect(upNextDueAt(2700, undefined, true)).toBe(2689)
  })

  it('still waits for the length, and for something longer than a minute', () => {
    expect(upNextDueAt(Number.NaN, 2600, true)).toBeUndefined()
    expect(upNextDueAt(45, 30, true)).toBeUndefined()
  })

  it('counts what is left of the episode, ten seconds at most', () => {
    expect(secondsToEnd(2700, 2689)).toBe(10)
    expect(secondsToEnd(2700, 2690.2)).toBe(10)
    expect(secondsToEnd(2700, 2695.5)).toBe(5)
    expect(secondsToEnd(2700, 2699.9)).toBe(1)
    expect(secondsToEnd(2700, 2700)).toBe(0)
    expect(secondsToEnd(2700, 2650)).toBe(10)
  })
})
