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

  it('still waits for the length, and for a stream long enough to have a tail', () => {
    expect(upNextDueAt(Number.NaN, 2600, true)).toBeUndefined()
    expect(upNextDueAt(25, 10, true)).toBeUndefined()
    expect(upNextDueAt(60, undefined, true)).toBe(49)
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

describe('Countdown seconds', () => {
  it('moves the card earlier for a countdown longer than the last 30 seconds, and never later', () => {
    expect(upNextDueAt(2700, undefined, false, 5)).toBe(2670)
    expect(upNextDueAt(2700, undefined, false, 30)).toBe(2670)
    expect(upNextDueAt(2700, 2600, false, 30)).toBe(2600)
  })

  it('starts the wait-for-the-end card a countdown plus a second before the end', () => {
    expect(upNextDueAt(2700, 2600, true, 5)).toBe(2694)
    expect(upNextDueAt(2700, 2600, true, 30)).toBe(2669)
  })

  it('counts what is left of the episode, up to the countdown', () => {
    expect(secondsToEnd(2700, 2650, 30)).toBe(30)
    expect(secondsToEnd(2700, 2680.5, 30)).toBe(20)
    expect(secondsToEnd(2700, 2690, 5)).toBe(5)
  })
})
