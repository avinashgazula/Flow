import { afterEach, describe, expect, it, vi } from 'vitest'
import { ENCODER_NUDGE_MS, ENCODER_STALL_MS, type EncoderApi, type EncoderConfig, PictureConverter } from './transcode'

/* A browser that says it encodes H.264 and then never hands a picture back (Firefox on a machine with no H.264 encoder behind
   WebCodecs) must end in a message, not a spinner. */

const config: EncoderConfig = { codec: 'avc1.64001E', width: 16, height: 16, bitrate: 1e6, framerate: 15, latencyMode: 'realtime', avc: { format: 'avc' } }

function silentApi(): EncoderApi {
  return {
    create: () => ({ configure: () => {}, encode: () => {}, flush: () => new Promise<void>(() => {}), close: () => {}, encodeQueueSize: 9, state: 'configured' }),
    frame: (_data: unknown, init: object) => ({ ...init, close: () => {} }) as never,
    isConfigSupported: async () => ({ supported: true }),
  } as unknown as EncoderApi
}

const frame = { data: new Uint8Array(16 * 16 * 1.5), width: 16, height: 16, timestamp: 0, duration: 66_000, matrix: 1, sarNumerator: 1, sarDenominator: 1, interlaced: false, fullRange: false }

describe('an encoder that holds frames back until it is flushed', () => {
  afterEach(() => vi.useRealTimers())

  it('is asked to flush when it has been quiet, so frames come out instead of the queue never draining', async () => {
    vi.useFakeTimers()
    let flushes = 0
    let queue = 9
    const api = {
      create: ({ output }: { output: (chunk: unknown, meta?: unknown) => void }) => ({
        configure: () => {},
        encode: () => {},
        get encodeQueueSize() {
          return queue
        },
        flush: async () => {
          flushes++
          queue = 0
          output({ type: 'key', timestamp: 0, byteLength: 1, copyTo: () => {} }, { decoderConfig: { description: new ArrayBuffer(4) } })
        },
        close: () => {},
      }),
      frame: (_data: unknown, init: object) => ({ ...init, close: () => {} }),
      isConfigSupported: async () => ({ supported: true }),
    } as unknown as EncoderApi
    const converter = new PictureConverter(api, config, { videoOpen: () => {}, videoPacket: () => {} })
    converter.submit(frame)
    const ready = converter.ready(new AbortController().signal)
    await vi.advanceTimersByTimeAsync(ENCODER_NUDGE_MS + 200)
    await ready
    expect(flushes).toBe(1)
    expect(converter.packets).toBe(1)
    expect(converter.failure).toBeNull()
  })
})

describe('an encoder that never answers', () => {
  afterEach(() => vi.useRealTimers())

  it('fails with what to do next once it has had pictures for too long and produced none', async () => {
    vi.useFakeTimers()
    const converter = new PictureConverter(silentApi(), config, { videoOpen: () => {}, videoPacket: () => {} })
    converter.submit(frame)
    const waiting = converter.ready(new AbortController().signal)
    const outcome = expect(waiting).rejects.toThrow(/video encoder didn’t produce any picture.*Try another source/)
    await vi.advanceTimersByTimeAsync(ENCODER_STALL_MS + 1000)
    await outcome
  })

  it('keeps waiting while it is still inside the grace period', async () => {
    vi.useFakeTimers()
    const converter = new PictureConverter(silentApi(), config, { videoOpen: () => {}, videoPacket: () => {} })
    converter.submit(frame)
    let settled = false
    void converter.ready(new AbortController().signal).then(
      () => (settled = true),
      () => (settled = true),
    )
    await vi.advanceTimersByTimeAsync(ENCODER_STALL_MS - 2000)
    expect(settled).toBe(false)
    converter.close()
  })
})
