import { describe, expect, it } from 'vitest'
import { fingerprint, isFresh } from './cache'
import { demoChannels, demoProvider } from './demo'
import { nowAndNext } from './epg'
import { liveState, loadLiveTV, providersKey } from './load'

describe('loading the sample provider', () => {
  it('lists its channels in order and fills the guide for every one', async () => {
    await loadLiveTV([demoProvider], { refreshHours: 12 })
    const { status, channels, epg, error, guideError } = liveState()
    expect(status).toBe('ready')
    expect(error).toBeUndefined()
    expect(guideError).toBeUndefined()
    expect(channels.map((c) => c.name)).toEqual(demoChannels.map((c) => c.name))
    for (const channel of channels) expect(nowAndNext(epg, channel.epgID).now, channel.name).toBeDefined()
  })

  it('shows nothing, ready, when every provider is off', async () => {
    await loadLiveTV([{ ...demoProvider, enabled: false }], { refreshHours: 12 })
    expect(liveState()).toMatchObject({ status: 'ready', channels: [] })
  })
})

describe('keeping what was downloaded', () => {
  const hour = 3_600_000
  it('is fresh until the refresh time, not from the future, and tries an empty guide again after an hour', () => {
    const now = 100 * hour
    expect(isFresh(now - 11 * hour, 12, now)).toBe(true)
    expect(isFresh(now - 13 * hour, 12, now)).toBe(false)
    expect(isFresh(now + 5 * hour, 12, now)).toBe(false)
    expect(isFresh(now - 2 * hour, 12, now, false)).toBe(false)
    expect(isFresh(now - 0.5 * hour, 12, now, false)).toBe(true)
  })

  it('names a set of providers the same way every time, and differently when one changes', () => {
    expect(fingerprint('a')).toBe(fingerprint('a'))
    expect(fingerprint('a')).not.toBe(fingerprint('b'))
    const key = providersKey([demoProvider])
    expect(providersKey([demoProvider])).toBe(key)
    expect(providersKey([{ ...demoProvider, password: 'x' }])).not.toBe(key)
  })
})
