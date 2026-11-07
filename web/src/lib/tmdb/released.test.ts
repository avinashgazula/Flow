import { describe, expect, it, vi } from 'vitest'
import { filterReleased, isHomeReleased, quickDecision, today } from './released'
import type { MovieRelease } from './types'

const now = '2026-11-07'
const film = (id: number, date?: string) => ({ type: 'movie' as const, id, date })
const show = (id: number, date?: string) => ({ type: 'show' as const, id, date })
const release = (type: number, date: string): MovieRelease => ({ country: 'US', type, date })

describe('quickDecision', () => {
  it('drops a title dated in the future and keeps an old film', () => {
    expect(quickDecision(film(1, '2026-12-01'), now)).toBe(false)
    expect(quickDecision(show(2, '2026-12-01'), now)).toBe(false)
    expect(quickDecision(film(3, '2025-01-01'), now)).toBe(true)
  })
  it('keeps a show whose first episode has aired, with or without a date', () => {
    expect(quickDecision(show(4, '2026-11-01'), now)).toBe(true)
    expect(quickDecision(show(5), now)).toBe(true)
  })
  it('drops a film with no date, and asks about a recent one', () => {
    expect(quickDecision(film(6), now)).toBe(false)
    expect(quickDecision(film(7, '2026-09-01'), now)).toBeUndefined()
  })
})

describe('isHomeReleased', () => {
  it('counts digital, physical and TV releases that have passed, not cinema ones', () => {
    expect(isHomeReleased([release(3, '2026-09-01')], now)).toBe(false)
    expect(isHomeReleased([release(3, '2026-09-01'), release(4, '2026-10-20')], now)).toBe(true)
    expect(isHomeReleased([release(5, '2026-12-20')], now)).toBe(false)
  })
  it('says nothing without data', () => {
    expect(isHomeReleased([], now)).toBeUndefined()
  })
})

describe('filterReleased', () => {
  it('keeps playable titles in order and looks each recent film up once', async () => {
    const lookup = vi.fn(async (id: number) => (id === 10 ? [release(4, '2026-10-30')] : [release(3, '2026-10-01')]))
    const cache = new Map<number, boolean>()
    const list = [film(10, '2026-09-01'), film(11, '2026-09-15'), film(12, '2026-12-25'), show(13, '2026-01-01')]
    const kept = await filterReleased(list, lookup, now, cache)
    expect(kept.map((x) => x.id)).toEqual([10, 13])
    await filterReleased(list, lookup, now, cache)
    expect(lookup).toHaveBeenCalledTimes(2)
  })

  it('treats a recent film with no dates as not out, and does not remember a failed lookup', async () => {
    const lookup = vi.fn().mockResolvedValueOnce([]).mockRejectedValueOnce(new Error('offline')).mockResolvedValue([release(4, '2026-10-30')])
    const cache = new Map<number, boolean>()
    expect(await filterReleased([film(20, '2026-09-01')], lookup, now, cache)).toEqual([])
    cache.clear()
    expect(await filterReleased([film(21, '2026-09-01')], lookup, now, cache)).toEqual([])
    expect(await filterReleased([film(21, '2026-09-01')], lookup, now, cache)).toHaveLength(1)
  })
})

describe('today', () => {
  it('is the local calendar day', () => {
    expect(today(new Date(2026, 10, 7, 23, 59).getTime())).toBe('2026-11-07')
  })
})
