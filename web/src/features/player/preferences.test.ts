import { describe, expect, it } from 'vitest'
import { isMetered, overLimit, playbackPreferences, remembersChoices, resolutionLimit } from './preferences'

describe('playbackPreferences', () => {
  it('has the apps’ defaults', () => {
    expect(playbackPreferences({})).toEqual({ askToResume: true, watchedAt: 0.9, seekBack: 10, seekForward: 10, countdown: 10 })
  })

  it('reads what was chosen, and ignores values the pickers don’t offer', () => {
    expect(playbackPreferences({ askToResume: false, watchedThresholdPercent: 95, seekBackwardSeconds: 5, seekForwardSeconds: 30, nextEpisodeCountdownSeconds: 20 })).toEqual({ askToResume: false, watchedAt: 0.95, seekBack: 5, seekForward: 30, countdown: 20 })
    expect(playbackPreferences({ watchedThresholdPercent: 50, seekForwardSeconds: 7, nextEpisodeCountdownSeconds: 0 })).toMatchObject({ watchedAt: 0.9, seekForward: 10, countdown: 10 })
  })
})

describe('remembersChoices', () => {
  it('turns off for shows only', () => {
    expect(remembersChoices('show:1', false)).toBe(false)
    expect(remembersChoices('show:1', undefined)).toBe(true)
    expect(remembersChoices('show:1', true)).toBe(true)
    expect(remembersChoices('movie:2', false)).toBe(true)
    expect(remembersChoices(undefined, false)).toBe(true)
  })
})

describe('Resolution on Cellular', () => {
  it('applies when the browser reports Data Saver, a slow link or cellular', () => {
    expect(isMetered(undefined)).toBe(false)
    expect(isMetered({ effectiveType: '4g' })).toBe(false)
    expect(isMetered({ effectiveType: '3g' })).toBe(true)
    expect(isMetered({ saveData: true, effectiveType: '4g' })).toBe(true)
    expect(isMetered({ type: 'cellular' })).toBe(true)
    expect(isMetered({ type: 'wifi', effectiveType: '4g' })).toBe(false)
  })

  it('limits only when capped and metered, and 4K is no limit', () => {
    const slow = { effectiveType: '2g' }
    expect(resolutionLimit('720p', slow)).toBe(720)
    expect(resolutionLimit('720p', { effectiveType: '4g' })).toBeUndefined()
    expect(resolutionLimit(undefined, slow)).toBeUndefined()
    expect(resolutionLimit('2160p', slow)).toBeUndefined()
  })

  it('marks sources taller than the limit, and lets unlabelled ones through', () => {
    expect(overLimit('1080p', 720)).toBe(true)
    expect(overLimit('720p', 720)).toBe(false)
    expect(overLimit('SD', 720)).toBe(false)
    expect(overLimit(undefined, 720)).toBe(false)
    expect(overLimit('2160p', undefined)).toBe(false)
  })
})
