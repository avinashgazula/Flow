import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { settingsStore } from '../store/settings'
import { fixedCapabilities } from './capabilities'
import { searchSources, type Provider } from './index'
import { scoreSource } from './rank'
import { defaultSourceOrdering, isSourceOrdering, normaliseSourceOrdering } from './sourceSettings'
import type { PlaybackRequest, Source } from './types'

const caps = fixedCapabilities({})
const dune: PlaybackRequest = { type: 'movie', tmdbId: 1, item: { type: 'movie', id: 1, title: 'Dune', year: 2024, overview: '', genres: [] } }
const source = (id: string, extra: Partial<Source> = {}): Source => ({ id, origin: 'addon', provider: 'aio', providerId: 'aio', title: id, url: `https://x.test/${id}.mp4`, engine: 'native', resolution: '1080p', ...extra })

describe('the source preferences', () => {
  it('default to the website’s auto-play, the apps’ 15 seconds and playable audio first', () => {
    expect(defaultSourceOrdering).toMatchObject({ autoPlayFirstSource: true, timeoutSeconds: 15, preferPlayableAudio: true })
    expect(normaliseSourceOrdering(undefined)).toMatchObject({ autoPlayFirstSource: true, timeoutSeconds: 15, preferPlayableAudio: true })
    // Settings saved before these existed load with the defaults.
    expect(normaliseSourceOrdering({ useCustomOrdering: true })).toMatchObject({ timeoutSeconds: 15, preferPlayableAudio: true })
  })

  it('keep what was saved, and fall back for what is wrong', () => {
    expect(normaliseSourceOrdering({ autoPlayFirstSource: false, timeoutSeconds: 30, preferPlayableAudio: false })).toMatchObject({ autoPlayFirstSource: false, timeoutSeconds: 30, preferPlayableAudio: false })
    expect(normaliseSourceOrdering({ timeoutSeconds: 0, autoPlayFirstSource: 'no' })).toMatchObject({ timeoutSeconds: 15, autoPlayFirstSource: true })
    expect(isSourceOrdering({ timeoutSeconds: 20 })).toBe(true)
    expect(isSourceOrdering({ timeoutSeconds: -1 })).toBe(false)
    expect(isSourceOrdering({ timeoutSeconds: 'soon' })).toBe(false)
    expect(isSourceOrdering({ preferPlayableAudio: 1 })).toBe(false)
  })
})

describe('Prefer Sources With Playable Audio', () => {
  const converted = source('a', { convertsAudio: true })
  const plain = source('b')
  it('scores a source that needs converting a little lower, and not at all when off', () => {
    expect(scoreSource(converted, { preferredQuality: '1080p' }, caps)).toBeLessThan(scoreSource(plain, { preferredQuality: '1080p' }, caps))
    expect(scoreSource(converted, { preferredQuality: '1080p', preferPlayableAudio: false }, caps)).toBe(scoreSource(plain, { preferredQuality: '1080p' }, caps))
  })
})

describe('Provider Timeout', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    settingsStore.set({ sources: undefined })
  })
  afterEach(() => {
    vi.useRealTimers()
    settingsStore.set({ sources: undefined })
  })

  /** A provider that answers after `ms`. */
  const slow = (ms: number): Provider => ({
    id: 'slow',
    name: 'Slow',
    kind: 'addon',
    search: (_r, _c, signal) =>
      new Promise((resolve, reject) => {
        const timer = setTimeout(() => resolve({ sources: [source('late')] }), ms)
        signal.addEventListener('abort', () => (clearTimeout(timer), reject(new Error('aborted'))))
      }),
  })

  it('gives each provider the saved number of seconds, then goes on without it', async () => {
    settingsStore.set({ sources: { timeoutSeconds: 5 } as never })
    const done = searchSources(dune, { capabilities: caps, providers: [slow(8000)] })
    await vi.advanceTimersByTimeAsync(5100)
    const result = await done
    expect(result.providers[0]).toMatchObject({ state: 'failed', error: 'Didn’t answer in time.' })
  })

  it('waits the full fifteen seconds by default', async () => {
    const done = searchSources(dune, { capabilities: caps, providers: [slow(14_000)] })
    await vi.advanceTimersByTimeAsync(14_100)
    expect((await done).sources.map((s) => s.id)).toEqual(['late'])
  })
})
