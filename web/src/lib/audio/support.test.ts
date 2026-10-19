import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/** Each test starts from a fresh module, since the answer is cached for the page's life. */
async function load() {
  vi.resetModules()
  return import('./support')
}

const opus = (supported: boolean) => ({ isTypeSupported: (type: string) => supported && type === 'audio/mp4; codecs="opus"' })

beforeEach(() => vi.unstubAllGlobals())
afterEach(() => vi.unstubAllGlobals())

describe('canConvertAudio', () => {
  it('is false without an audio encoder', async () => {
    vi.stubGlobal('MediaSource', opus(true))
    expect((await load()).canConvertAudio()).toBe(false)
  })

  it('is false when MSE won’t take Opus in MP4', async () => {
    vi.stubGlobal('AudioEncoder', class {})
    vi.stubGlobal('MediaSource', opus(false))
    expect((await load()).canConvertAudio()).toBe(false)
  })

  it('is false with no MSE at all', async () => {
    vi.stubGlobal('AudioEncoder', class {})
    expect((await load()).canConvertAudio()).toBe(false)
  })

  it('is true with an encoder and MSE Opus, and Safari’s ManagedMediaSource counts', async () => {
    vi.stubGlobal('AudioEncoder', class {})
    vi.stubGlobal('MediaSource', opus(true))
    expect((await load()).canConvertAudio()).toBe(true)
    vi.stubGlobal('MediaSource', undefined)
    vi.stubGlobal('ManagedMediaSource', opus(true))
    expect((await load()).canConvertAudio()).toBe(true)
  })
})

describe('checkConvertAudio', () => {
  const encoder = (answer: () => Promise<{ supported: boolean }>) => {
    const isConfigSupported = vi.fn(answer)
    vi.stubGlobal('AudioEncoder', Object.assign(class {}, { isConfigSupported }))
    vi.stubGlobal('MediaSource', opus(true))
    return isConfigSupported
  }

  it('asks the encoder for the settings Flow uses, and keeps its answer', async () => {
    const ask = encoder(async () => ({ supported: false }))
    const support = await load()
    expect(support.canConvertAudio()).toBe(true)
    expect(await support.checkConvertAudio()).toBe(false)
    expect(support.canConvertAudio()).toBe(false)
    expect(ask).toHaveBeenCalledWith({ codec: 'opus', sampleRate: 48000, numberOfChannels: 2, bitrate: 160000 })
  })

  it('confirms a working encoder, asking only once', async () => {
    const ask = encoder(async () => ({ supported: true }))
    const support = await load()
    expect(await support.checkConvertAudio()).toBe(true)
    expect(await support.checkConvertAudio()).toBe(true)
    expect(support.canConvertAudio()).toBe(true)
    expect(ask).toHaveBeenCalledTimes(1)
  })

  it('says no, without throwing, when the encoder fails to answer', async () => {
    encoder(async () => {
      throw new Error('nope')
    })
    const support = await load()
    expect(await support.checkConvertAudio()).toBe(false)
    expect(support.canConvertAudio()).toBe(false)
  })

  it('doesn’t ask when the quick check already said no', async () => {
    const support = await load()
    expect(await support.checkConvertAudio()).toBe(false)
  })
})
