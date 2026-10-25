import { describe, expect, it, vi } from 'vitest'
import { fadeLevel, SleepTimer, sleepChoices, sleepSetNotice, sleepTitle } from './sleepTimer'

describe('the sleep timer’s choices', () => {
  it('are the apps’, with 90 minutes between an hour and the end of the episode', () => {
    expect(sleepChoices.map(sleepTitle)).toEqual(['15 Minutes', '30 Minutes', '45 Minutes', '1 Hour', '90 Minutes', 'End of Episode or Movie'])
    expect(sleepTitle(120)).toBe('2 Hours')
  })

  it('say what will happen, as the apps do', () => {
    expect(sleepSetNotice(30)).toBe('Flow will pause in 30 minutes.')
    expect(sleepSetNotice('end')).toBe('The player will close when this ends.')
  })
})

describe('the fade', () => {
  it('leaves the volume alone until the last 30 seconds, then goes straight down', () => {
    expect(fadeLevel(60_000)).toBe(1)
    expect(fadeLevel(30_000)).toBe(1)
    expect(fadeLevel(15_000)).toBeCloseTo(0.5)
    expect(fadeLevel(3_000)).toBeCloseTo(0.1)
    expect(fadeLevel(0)).toBe(0)
    expect(fadeLevel(-500)).toBe(0)
  })
})

describe('SleepTimer', () => {
  it('counts the minutes from when it was set, fades, then fires', () => {
    const timer = new SleepTimer()
    timer.set(15, 1_000_000)
    expect(timer.check(1_000_000 + 10 * 60_000)).toEqual({ fire: false, level: 1 })
    const fading = timer.check(1_000_000 + 15 * 60_000 - 10_000)!
    expect(fading.fire).toBe(false)
    expect(fading.level).toBeCloseTo(1 / 3)
    expect(timer.check(1_000_000 + 15 * 60_000)).toEqual({ fire: true, level: 0 })
  })

  it('has nothing to check when off or waiting for the end of the episode', () => {
    const timer = new SleepTimer()
    expect(timer.check()).toBeNull()
    timer.set('end')
    expect(timer.choice).toBe('end')
    expect(timer.check()).toBeNull()
    timer.set(null)
    expect(timer.choice).toBeNull()
  })

  it('starts again when set again, and tells those who are listening', () => {
    const timer = new SleepTimer()
    const heard = vi.fn()
    timer.subscribe(heard)
    timer.set(15, 0)
    timer.set(30, 5 * 60_000)
    expect(timer.check(5 * 60_000 + 29 * 60_000)!.fire).toBe(false)
    expect(timer.check(5 * 60_000 + 30 * 60_000)!.fire).toBe(true)
    timer.clear()
    timer.clear()
    expect(heard).toHaveBeenCalledTimes(3)
  })
})
