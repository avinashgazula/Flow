import { describe, expect, it } from 'vitest'
import { AHEAD_MAX, AHEAD_MIN, AHEAD_TARGET, aheadCapFor, AheadGovernor, RateMeter } from './pacing'

const MB = 1024 * 1024

describe('aheadCapFor', () => {
  it('aims for half a minute when the bitrate is unknown', () => {
    expect(aheadCapFor(0)).toBe(AHEAD_TARGET)
  })
  it('reads at least half a minute ahead of an ordinary film', () => {
    expect(aheadCapFor(1 * MB)).toBe(AHEAD_MAX)
    expect(aheadCapFor(3 * MB)).toBeGreaterThanOrEqual(30)
  })
  it('reads less far ahead as the bitrate grows, so the browser’s quota holds it, but never under the floor', () => {
    expect(aheadCapFor(10 * MB)).toBeGreaterThan(10)
    expect(aheadCapFor(10 * MB)).toBeLessThan(15)
    expect(aheadCapFor(100 * MB)).toBe(AHEAD_MIN)
  })
})

describe('AheadGovernor', () => {
  it('starts at the cap', () => {
    expect(new AheadGovernor(30).value(0)).toBe(30)
  })

  it('drops to four fifths of what the browser held when its buffer fills, never under the floor', () => {
    const g = new AheadGovernor(30)
    g.pressure(20, 0)
    expect(g.value(0)).toBe(16)
    g.pressure(5, 100)
    expect(g.value(100)).toBe(AHEAD_MIN)
  })

  it('never rises on pressure', () => {
    const g = new AheadGovernor(30)
    g.pressure(10, 0)
    g.pressure(40, 1)
    expect(g.value(1)).toBe(8)
  })

  it('climbs back toward the cap a little at a time, and stops there', () => {
    const g = new AheadGovernor(14)
    g.pressure(10, 0)
    expect(g.value(0)).toBe(8)
    expect(g.value(9_999)).toBe(8)
    expect(g.value(10_000)).toBe(10)
    expect(g.value(19_999)).toBe(10)
    expect(g.value(20_000)).toBe(12)
    expect(g.value(30_000)).toBe(14)
    expect(g.value(300_000)).toBe(14)
    expect(g.capped).toBe(false)
  })

  it('waits twice as long before climbing again each time the buffer fills', () => {
    const g = new AheadGovernor(30)
    g.pressure(10, 0)
    g.pressure(10, 1000)
    // Two strikes: 20 s.
    expect(g.value(20_999)).toBe(8)
    expect(g.value(21_000)).toBe(10)
    g.pressure(10, 21_000)
    // Three strikes: 40 s.
    expect(g.value(60_999)).toBe(8)
    expect(g.value(61_000)).toBe(10)
  })

  it('starts over with a new file', () => {
    const g = new AheadGovernor(30)
    g.pressure(10, 0)
    g.reset(20)
    expect(g.value(1)).toBe(20)
    expect(g.capped).toBe(false)
  })
})

describe('RateMeter', () => {
  it('is zero before anything arrives', () => {
    expect(new RateMeter().rate(1000)).toBe(0)
  })

  it('divides bytes by the time requests were open', () => {
    const m = new RateMeter()
    m.setActive(true, 0)
    for (let t = 100; t <= 2000; t += 100) m.add(1_000_000, t)
    // 20 MB in 2 s.
    expect(m.rate(2000)).toBeCloseTo(10_000_000, -4)
  })

  it('doesn’t count the time nothing was asked for, so a full buffer isn’t a slow network', () => {
    const m = new RateMeter()
    m.setActive(true, 0)
    for (let t = 100; t <= 1000; t += 100) m.add(1_000_000, t)
    m.setActive(false, 1000)
    // Four idle seconds: still 10 MB/s.
    expect(m.rate(5000)).toBeCloseTo(10_000_000, -4)
  })

  it('looks only at the last window', () => {
    const m = new RateMeter(5000)
    m.setActive(true, 0)
    for (let t = 100; t <= 5000; t += 100) m.add(1_000_000, t)
    for (let t = 5100; t <= 10_000; t += 100) m.add(100_000, t)
    expect(m.rate(10_000)).toBeCloseTo(1_000_000, -4)
  })

  it('keeps the last answer when there is too little open time to say anything new', () => {
    const m = new RateMeter(5000, 250)
    m.setActive(true, 0)
    for (let t = 100; t <= 1000; t += 100) m.add(500_000, t)
    m.setActive(false, 1000)
    const known = m.rate(1000)
    expect(known).toBeGreaterThan(0)
    // Long after, the window holds no open time at all.
    expect(m.rate(60_000)).toBe(known)
  })

  it('counts several spans of open time in one window', () => {
    const m = new RateMeter()
    m.setActive(true, 0)
    m.add(1_000_000, 1000)
    m.setActive(false, 1000)
    m.setActive(true, 3000)
    m.add(1_000_000, 4000)
    m.setActive(false, 4000)
    // 2 MB over 2 s open, not over 4 s.
    expect(m.rate(4000)).toBeCloseTo(1_000_000, -4)
  })
})
