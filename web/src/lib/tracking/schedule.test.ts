import { describe, expect, it } from 'vitest'
import { defaultSyncInterval, oldestSync, syncDue, syncIntervalLabel, syncIntervalOf, syncIntervals } from './schedule'

const now = Date.parse('2026-11-07T12:00:00Z')
const ago = (seconds: number) => new Date(now - seconds * 1000).toISOString()

describe('the Sync Interval', () => {
  it('has the apps’ six choices with their names, and three hours when nothing is saved', () => {
    expect(syncIntervals.map((n) => syncIntervalLabel[n])).toEqual(['Every Launch', '15 Minutes', '1 Hour', '3 Hours', '12 Hours', '1 Day'])
    expect(syncIntervalOf({})).toBe(defaultSyncInterval)
    expect(defaultSyncInterval).toBe(10800)
    expect(syncIntervalOf({ syncInterval: 3600 })).toBe(3600)
    expect(syncIntervalOf({ syncInterval: 0 })).toBe(0)
    // A value from a backup that isn't one of the six reads as the default.
    expect(syncIntervalOf({ syncInterval: 7 })).toBe(defaultSyncInterval)
  })
})

describe('when a sync is due', () => {
  it('is due when nothing has ever synced', () => {
    expect(syncDue(null, 3600, now)).toBe(true)
    expect(syncDue(undefined, 3600, now)).toBe(true)
    expect(syncDue('not a date', 3600, now)).toBe(true)
  })

  it('waits until the interval has passed, and is due exactly then', () => {
    expect(syncDue(ago(3599), 3600, now)).toBe(false)
    expect(syncDue(ago(3600), 3600, now)).toBe(true)
    expect(syncDue(ago(86_400 - 1), 86_400, now)).toBe(false)
  })

  it('is always due with Every Launch', () => {
    expect(syncDue(ago(0), 0, now)).toBe(true)
    expect(syncDue(ago(5), 0, now)).toBe(true)
  })

  it('is due when the last sync is in the future, as after a clock change', () => {
    expect(syncDue(ago(-600), 3600, now)).toBe(true)
  })
})

describe('several services', () => {
  it('goes by the one that is furthest behind, and by none if one never synced', () => {
    expect(oldestSync([ago(60), ago(7200)])).toBe(ago(7200))
    expect(oldestSync([ago(60), null])).toBeNull()
    expect(oldestSync([])).toBeNull()
  })
})
