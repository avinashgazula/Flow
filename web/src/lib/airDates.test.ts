import { describe, expect, it } from 'vitest'
import { airDay, isBareDay } from './airDates'

describe('airDay', () => {
  it('places an evening broadcast in the viewer’s own day', () => {
    // 01:00 UTC on the 22nd is still the evening of the 21st in Los Angeles and already the morning of the 22nd in Tokyo.
    expect(airDay('2026-10-22T01:00:00.000Z', true, 'America/Los_Angeles')).toBe('2026-10-21')
    expect(airDay('2026-10-22T01:00:00.000Z', true, 'Asia/Tokyo')).toBe('2026-10-22')
  })
  it('keeps the source’s UTC day when the setting is off', () => {
    expect(airDay('2026-10-22T01:00:00.000Z', false, 'America/Los_Angeles')).toBe('2026-10-22')
  })
  it('never moves a bare day', () => {
    expect(airDay('2026-10-21', true, 'America/Los_Angeles')).toBe('2026-10-21')
    expect(airDay('2026-10-21T00:00:00.000Z', true, 'America/Los_Angeles')).toBe('2026-10-21')
  })
  it('says nothing without a date', () => {
    expect(airDay(null, true)).toBeUndefined()
    expect(airDay('', true)).toBeUndefined()
  })
})

describe('isBareDay', () => {
  it('is true for a date with no time of day', () => {
    expect(isBareDay('2026-10-21')).toBe(true)
    expect(isBareDay('2026-10-21T00:00:00Z')).toBe(true)
    expect(isBareDay('2026-10-21T02:30:00Z')).toBe(false)
  })
})
