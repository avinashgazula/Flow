import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/** Each test starts from a fresh module, since the answer is cached for the page's life. */
async function load() {
  vi.resetModules()
  return import('./surround')
}

const opus = (supported: boolean) => ({ isTypeSupported: (type: string) => supported && type === 'audio/mp4; codecs="opus"' })

beforeEach(() => vi.unstubAllGlobals())
afterEach(() => vi.unstubAllGlobals())

describe('checkSurroundAudio', () => {
  function environment(options: { pieces?: boolean; mediaCapabilities?: boolean | 'missing'; channels?: number; userAgent?: string } = {}) {
    const { pieces = true, mediaCapabilities = true, channels = 6, userAgent = 'Mozilla/5.0 Chrome/140 Safari/537.36' } = options
    const isConfigSupported = vi.fn(async (config: { numberOfChannels: number }) => ({ supported: pieces || config.numberOfChannels === 2 }))
    vi.stubGlobal('AudioEncoder', Object.assign(class {}, { isConfigSupported }))
    vi.stubGlobal('MediaSource', opus(true))
    vi.stubGlobal('AudioContext', class {
      destination = { maxChannelCount: channels }
      close = vi.fn()
    })
    const decodingInfo = vi.fn(async () => ({ supported: mediaCapabilities === true }))
    vi.stubGlobal('navigator', { userAgent, mediaCapabilities: mediaCapabilities === 'missing' ? undefined : { decodingInfo } })
    return { isConfigSupported, decodingInfo }
  }

  it('is true when the encoder, MSE and the output all take six channels', async () => {
    const { isConfigSupported, decodingInfo } = environment()
    expect(await (await load()).checkSurroundAudio()).toBe(true)
    // Both kinds of encoder piece are checked, and MSE is asked about 5.1 Opus in MP4.
    expect(isConfigSupported.mock.calls.map((c) => c[0].numberOfChannels)).toContain(1)
    expect(decodingInfo).toHaveBeenCalledWith({ type: 'media-source', audio: { contentType: 'audio/mp4; codecs="opus"', channels: '5.1', samplerate: 48000 } })
  })

  it('is false when the output is stereo (headphones, laptop speakers)', async () => {
    environment({ channels: 2 })
    expect(await (await load()).checkSurroundAudio()).toBe(false)
  })

  it('is true for an 8-channel output, and trusts MSE when the browser has no MediaCapabilities', async () => {
    environment({ channels: 8, mediaCapabilities: 'missing' })
    expect(await (await load()).checkSurroundAudio()).toBe(true)
  })

  it('is false when the encoder can’t make a mono stream, or MSE refuses 5.1 Opus', async () => {
    environment({ pieces: false })
    expect(await (await load()).checkSurroundAudio()).toBe(false)
    environment({ mediaCapabilities: false })
    expect(await (await load()).checkSurroundAudio()).toBe(false)
  })

  it('is false without conversion at all, and in Safari, which stays stereo', async () => {
    vi.stubGlobal('AudioContext', class { destination = { maxChannelCount: 8 } })
    expect(await (await load()).checkSurroundAudio()).toBe(false)
    environment({ userAgent: 'Mozilla/5.0 (Macintosh) AppleWebKit/605.1.15 Version/18 Safari/605.1.15' })
    expect(await (await load()).checkSurroundAudio()).toBe(false)
  })

  it('asks once and never throws', async () => {
    const { isConfigSupported } = environment()
    const support = await load()
    await support.checkSurroundAudio()
    const calls = isConfigSupported.mock.calls.length
    await support.checkSurroundAudio()
    expect(isConfigSupported.mock.calls.length).toBe(calls)
    environment()
    vi.stubGlobal('AudioContext', class {
      constructor() {
        throw new Error('blocked')
      }
    })
    expect(await (await load()).checkSurroundAudio()).toBe(false)
  })
})
