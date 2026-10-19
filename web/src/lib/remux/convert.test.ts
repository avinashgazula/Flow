import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/* The converter's timeline, fragments and failure handling, with the decoder, the encoder and the
   muxer replaced by fakes that behave the way the real ones are documented to: the decoder turns each
   input byte into one stereo frame, the encoder makes a 960-frame packet for every 960 frames it is
   given (and pads the last one when flushed), and the muxer records what it was asked to wrap. */

const decoderState = { throwOn: Infinity, calls: 0, closed: 0, flushed: 0, tail: 0 }
vi.mock('../audio/decoder', () => ({
  loadAudioDecoders: async () => ({
    open: () => ({
      decode(bytes: Uint8Array) {
        if (++decoderState.calls >= decoderState.throwOn) throw new Error('wasm trapped')
        return new Float32Array(bytes.length * 2)
      },
      flush: () => void decoderState.flushed++,
      finish: () => new Float32Array(decoderState.tail * 2),
      close: () => void decoderState.closed++,
    }),
  }),
}))

const muxed: { base: number; sizes: number[]; durations: number[] }[] = []
let preSkipSeen = -1
vi.mock('./pkg/flow_remux.js', () => ({
  OpusMuxer: class {
    constructor(_channels: number, preSkip: number) {
      preSkipSeen = preSkip
    }
    init = () => new Uint8Array([1, 2, 3])
    fragment(base: number, data: Uint8Array, sizes: Uint32Array, durations: Uint32Array) {
      muxed.push({ base, sizes: [...sizes], durations: [...durations] })
      return new Uint8Array(data.length + 8)
    }
  },
}))

const encoders: FakeEncoder[] = []
class FakeEncoder {
  state = 'unconfigured'
  encodeQueueSize = 0
  resets = 0
  configured = 0
  /** Frames waiting for a whole packet, and the timestamp (µs) of the first of them. */
  private pending = 0
  private at = 0
  constructor(private init: { output: (chunk: unknown, metadata?: unknown) => void; error: (e: Error) => void }) {
    encoders.push(this)
  }
  configure() {
    this.state = 'configured'
    this.configured++
  }
  reset() {
    this.resets++
    this.pending = 0
    this.state = 'unconfigured'
  }
  close() {
    this.state = 'closed'
  }
  encode(data: { numberOfFrames: number; timestamp: number }) {
    if (this.pending === 0) this.at = data.timestamp
    this.pending += data.numberOfFrames
    while (this.pending >= 960) this.emit()
  }
  async flush() {
    if (this.pending > 0) this.emit()
  }
  private emit() {
    const metadata = encoders.length === 1 && !this.emitted ? { decoderConfig: { description: opusHead(400) } } : undefined
    this.emitted = true
    this.pending = Math.max(0, this.pending - 960)
    this.init.output({ timestamp: this.at, duration: 20000, byteLength: 4, copyTo: (to: Uint8Array) => to.fill(7) }, metadata)
    this.at += 20000
  }
  private emitted = false
}

const opusHead = (preSkip: number) => {
  const head = new Uint8Array(19)
  head.set([0x4f, 0x70, 0x75, 0x73, 0x48, 0x65, 0x61, 0x64])
  head[10] = preSkip & 255
  head[11] = preSkip >> 8
  return head
}

const given: { timestamp: number; frames: number }[] = []
class FakeAudioData {
  timestamp: number
  numberOfFrames: number
  constructor(init: { timestamp: number; numberOfFrames: number }) {
    this.timestamp = init.timestamp
    this.numberOfFrames = init.numberOfFrames
    given.push({ timestamp: init.timestamp, frames: init.numberOfFrames })
  }
  close() {}
}

const { AudioConverter, preSkipOf } = await import('./convert')

function host() {
  const events: { type: string; epoch: number; start?: number; end?: number; message?: string }[] = []
  let needInit = true
  return {
    events,
    initNeeded: () => needInit,
    init: (epoch: number) => {
      needInit = false
      events.push({ type: 'init', epoch })
    },
    fragment: (epoch: number, start: number, end: number) => events.push({ type: 'fragment', epoch, start, end }),
    failed: (epoch: number, message: string) => events.push({ type: 'failed', epoch, message }),
    wantInit: () => (needInit = true),
  }
}

/** `seconds` of audio as bytes, one frame per byte. */
const frames = (count: number) => new Uint8Array(count)

beforeEach(() => {
  vi.stubGlobal('AudioEncoder', FakeEncoder)
  vi.stubGlobal('AudioData', FakeAudioData)
  encoders.length = 0
  given.length = 0
  muxed.length = 0
  Object.assign(decoderState, { throwOn: Infinity, calls: 0, closed: 0, flushed: 0, tail: 0 })
})
afterEach(() => vi.unstubAllGlobals())

async function started(h = host()) {
  const converter = new AudioConverter(h)
  await converter.use('truehd', 1)
  converter.begin(1)
  return { converter, h }
}

describe('preSkipOf', () => {
  it('reads the pre-skip from an OpusHead and falls back to 312', () => {
    expect(preSkipOf(opusHead(400))).toBe(400)
    expect(preSkipOf(undefined)).toBe(312)
    expect(preSkipOf(new Uint8Array(4))).toBe(312)
    expect(preSkipOf(new Uint8Array(19))).toBe(312)
  })
})

describe('AudioConverter', () => {
  it('anchors at the first fragment, sends the init once, then fragments of about a second', async () => {
    const { converter, h } = await started()
    await converter.feed(12.5, frames(48000 * 2.5))
    await converter.finish()
    expect(preSkipSeen).toBe(400)
    expect(h.events.filter((e) => e.type === 'init')).toHaveLength(1)
    expect(h.events[0]!.type).toBe('init')
    const fragments = h.events.filter((e) => e.type === 'fragment')
    // 2.5 s is 3 fragments: two of a second and the padded rest.
    expect(fragments.length).toBe(3)
    expect(fragments[0]!.start).toBeCloseTo(12.5, 3)
    expect(fragments[0]!.end).toBeCloseTo(13.5, 3)
    expect(fragments[1]!.start).toBeCloseTo(13.5, 3)
    expect(muxed[0]!.base).toBe(12.5 * 48000)
    expect(muxed[0]!.durations.every((d) => d === 960)).toBe(true)
    expect(muxed[0]!.sizes.every((s) => s === 4)).toBe(true)
  })

  it('counts time in samples across fragments, ignoring small jitter in the file’s own times', async () => {
    const { converter } = await started()
    await converter.feed(10, frames(48000))
    await converter.feed(11.1, frames(48000))
    // Each fragment goes to the encoder in half-second slices, one after the other from the anchor.
    expect(given.map((g) => g.timestamp)).toEqual([10_000_000, 10_500_000, 11_000_000, 11_500_000])
  })

  it('moves the anchor after a gap of more than a quarter second', async () => {
    const { converter } = await started()
    await converter.feed(10, frames(48000))
    await converter.feed(20, frames(48000))
    expect(given.map((g) => g.timestamp)).toEqual([10_000_000, 10_500_000, 20_000_000, 20_500_000])
    // Everything encoded before the gap went out first, in a fragment of its own.
    expect(muxed[0]!.base).toBe(10 * 48000)
    expect(muxed.map((m) => m.base)).toEqual([10 * 48000, 20 * 48000])
  })

  it('flushes the decoder and starts the encoder over on every begin, and forgets what was gathered', async () => {
    const { converter, h } = await started()
    await converter.feed(5, frames(24000))
    const flushed = decoderState.flushed
    const gathered = h.events.filter((e) => e.type === 'fragment').length
    converter.begin(2)
    expect(decoderState.flushed).toBe(flushed + 1)
    expect(encoders[0]!.resets).toBe(1)
    expect(encoders[0]!.configured).toBe(2)
    await converter.feed(40, frames(48000))
    await converter.finish()
    // The first stream's half second never became a fragment, and the new anchor is where the new stream began.
    expect(h.events.filter((e) => e.type === 'fragment').length).toBe(gathered + 1)
    expect(given.at(-2)!.timestamp).toBe(40_000_000)
    expect(h.events.at(-1)).toMatchObject({ type: 'fragment', epoch: 2 })
  })

  it('sends the init again when the page asks (after a track switch)', async () => {
    const { converter, h } = await started()
    await converter.feed(0, frames(48000))
    h.wantInit()
    converter.begin(2)
    await converter.feed(30, frames(48000))
    expect(h.events.filter((e) => e.type === 'init').map((e) => e.epoch)).toEqual([1, 2])
  })

  it('encodes the decoder’s held-back tail at the end', async () => {
    const { converter } = await started()
    await converter.feed(0, frames(48000))
    decoderState.tail = 1920
    await converter.finish()
    expect(given.at(-1)).toEqual({ timestamp: 1_000_000, frames: 1920 })
  })

  it('reports a decoder that traps once, drops everything after, and says it is no longer working', async () => {
    const { converter, h } = await started()
    decoderState.throwOn = 2
    await converter.feed(0, frames(1000))
    await converter.feed(1, frames(1000))
    await converter.feed(2, frames(1000))
    await converter.finish()
    expect(h.events.filter((e) => e.type === 'failed')).toEqual([{ type: 'failed', epoch: 1, message: 'wasm trapped' }])
    expect(converter.working).toBe(false)
    expect(decoderState.calls).toBe(2)
    expect(encoders[0]!.state).toBe('closed')
  })

  it('reports an encoder that errors, and tries again from a fresh decoder on the next use', async () => {
    const { converter, h } = await started()
    const encoder = encoders[0]! as unknown as { init: { error: (e: Error) => void } }
    encoder.init.error(new Error('encoder died'))
    await converter.feed(0, frames(48000))
    expect(h.events).toEqual([{ type: 'failed', epoch: 1, message: 'encoder died' }])
    await converter.use('ac3', 3)
    converter.begin(3)
    expect(converter.working).toBe(true)
    await converter.feed(8, frames(48000))
    await converter.finish()
    expect(h.events.some((e) => e.type === 'fragment' && e.epoch === 3)).toBe(true)
  })

  it('fails (rather than throws) when the encoder can’t be configured', async () => {
    vi.stubGlobal(
      'AudioEncoder',
      class extends FakeEncoder {
        configure(): void {
          throw new Error('unsupported')
        }
      },
    )
    const h = host()
    const converter = new AudioConverter(h)
    await converter.use('dts', 1)
    converter.begin(1)
    await converter.feed(0, frames(1000))
    expect(h.events).toEqual([{ type: 'failed', epoch: 1, message: 'unsupported' }])
  })
})
