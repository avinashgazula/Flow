/* Encoding the pictures the engine decodes, with WebCodecs' VideoEncoder: H.264 in AVC form, which the muxer puts in MP4.
   The module hands out frames (engine.ts, PictureFrame); this wraps each as a VideoFrame, keeps the encoder from being
   fed faster than it works, and gives the packets back. Written against small interfaces so tests run it with a stub. */

import type { EncodedPicture, PictureFrame } from './engine'

export interface EncodedChunkLike {
  type: 'key' | 'delta'
  timestamp: number
  duration?: number | null
  byteLength: number
  copyTo(into: Uint8Array): void
}

export interface EncoderConfig {
  codec: string
  width: number
  height: number
  bitrate: number
  framerate: number
  latencyMode: 'realtime'
  hardwareAcceleration?: 'prefer-hardware' | 'no-preference'
  avc: { format: 'avc' }
}

export interface EncoderLike {
  readonly encodeQueueSize: number
  configure(config: EncoderConfig): void
  encode(frame: FrameLike, options?: { keyFrame?: boolean }): void
  flush(): Promise<void>
  close(): void
  addEventListener?(type: 'dequeue', listener: () => void): void
}

export interface FrameLike {
  close(): void
}

export interface EncoderApi {
  isConfigSupported(config: EncoderConfig): Promise<{ supported?: boolean; config?: Partial<EncoderConfig> }>
  create(init: { output: (chunk: EncodedChunkLike, meta?: { decoderConfig?: { description?: ArrayBuffer | ArrayBufferView } }) => void; error: (error: Error) => void }): EncoderLike
  frame(data: Uint8Array, init: { format: 'I420'; codedWidth: number; codedHeight: number; timestamp: number; duration: number; colorSpace: { primaries: string; transfer: string; matrix: string; fullRange: boolean } }): FrameLike
}

/** WebCodecs as the browser has it, or null where there is no VideoEncoder (older Safari and Firefox). */
export function webCodecs(): EncoderApi | null {
  const g = globalThis as unknown as { VideoEncoder?: any; VideoFrame?: any }
  if (typeof g.VideoEncoder?.isConfigSupported !== 'function' || typeof g.VideoFrame !== 'function') return null
  return {
    isConfigSupported: (config) => g.VideoEncoder.isConfigSupported(config),
    create: ({ output, error }) => new g.VideoEncoder({ output, error }),
    frame: (data, init) => new g.VideoFrame(data, init),
  }
}

/** The bit rate to encode at. The encode is thrown away as soon as it is played, so it is generous: about 8 Mb/s at 1080p30, never under 2.5 Mb/s. */
export function bitrateFor(width: number, height: number, fps: number): number {
  return Math.round(Math.min(25_000_000, Math.max(2_500_000, width * height * Math.min(fps, 60) * 0.13)))
}

/** The H.264 level byte that holds a picture of this size at this rate (Table A-1 of the standard: macroblocks a frame and a second). */
export function avcLevel(width: number, height: number, fps: number): number {
  const frame = Math.ceil(width / 16) * Math.ceil(height / 16)
  const rate = frame * fps
  const levels: [number, number, number][] = [[0x1e, 1620, 40500], [0x1f, 3600, 108000], [0x28, 8192, 245760], [0x2a, 8704, 522240], [0x32, 22080, 589824], [0x33, 36864, 983040], [0x34, 36864, 2073600]]
  return (levels.find(([, f, r]) => frame <= f && rate <= r) ?? levels[levels.length - 1]!)[0]
}

const hex = (n: number) => n.toString(16).toUpperCase().padStart(2, '0')

/** What the encoder will be asked for, best first: High profile with hardware where there is some, then without, then Main and Baseline. */
export function encoderCandidates(width: number, height: number, fps: number): EncoderConfig[] {
  const level = hex(avcLevel(width, height, fps))
  const bitrate = bitrateFor(width, height, fps)
  const make = (profile: string, hardwareAcceleration: EncoderConfig['hardwareAcceleration']): EncoderConfig => ({
    codec: `avc1.${profile}${level}`,
    width: width & ~1,
    height: height & ~1,
    bitrate,
    framerate: Math.min(60, Math.max(1, Math.round(fps) || 24)),
    latencyMode: 'realtime',
    hardwareAcceleration,
    avc: { format: 'avc' },
  })
  return ['6400', '4D40', '42E0'].flatMap((profile) => [make(profile, 'prefer-hardware'), make(profile, 'no-preference')])
}

const chosen = new Map<string, EncoderConfig | null>()

/** The first configuration this browser's encoder accepts for a picture of this size, or null when it takes none of them. Asked once per size. */
export async function pickEncoder(width: number, height: number, fps: number, given?: EncoderApi | null): Promise<EncoderConfig | null> {
  const real = given === undefined
  const api = real ? webCodecs() : given
  if (!api) return null
  const key = `${width}x${height}@${Math.round(fps)}`
  if (real && chosen.has(key)) return chosen.get(key)!
  let found: EncoderConfig | null = null
  for (const candidate of encoderCandidates(width, height, fps)) {
    try {
      const { supported } = await api.isConfigSupported(candidate)
      if (supported) {
        found = candidate
        break
      }
    } catch {
      // This spelling isn't one the browser knows: the next is tried.
    }
  }
  if (real) chosen.set(key, found)
  return found
}

/** The colour description a frame is given, by how the file says it is encoded (FFmpeg's AVCOL_SPC_*), else by its size as players do. */
export function colourOf(matrix: number, width: number, height: number): { primaries: string; transfer: string; matrix: string; fullRange: boolean } {
  const hd = matrix === 1 || (matrix !== 5 && matrix !== 6 && (width >= 1280 || height >= 720))
  const name = hd ? 'bt709' : 'smpte170m'
  return { primaries: name, transfer: name, matrix: name, fullRange: false }
}

/** Frames wait for the encoder when this many are still being worked on. */
const MAX_QUEUE = 2
const MAX_IN_FLIGHT = 12
/** A key frame at least this often: the muxer cuts a fragment at each, and a fragment is the unit a seek or the buffer works in. */
export const KEY_EVERY_US = 1_000_000

export interface ConverterEvents {
  /** A packet went into the muxer (so fragments may be ready). */
  onPacket?: () => void
  /** Seconds of film an output packet covers, for the meter. */
  onProduced?: (seconds: number) => void
}

export interface PictureSink {
  videoOpen(picture: EncodedPicture): void
  videoPacket(size: number, fill: (into: Uint8Array) => void, timestamp: number, duration: number, key: boolean): void
}

/** One run's encoder: frames in, packets out into the muxer. A seek makes a new one. */
export class PictureConverter {
  failure: Error | null = null
  private encoder: EncoderLike | null = null
  private closed = false
  private opened = false
  private inFlight = 0
  private lastKey = -Infinity
  private durations = new Map<number, number>()
  private waiters: (() => void)[] = []
  private first: PictureFrame | null = null
  frames = 0
  packets = 0

  constructor(
    private readonly api: EncoderApi,
    private readonly config: EncoderConfig,
    private readonly sink: PictureSink,
    private readonly events: ConverterEvents = {},
  ) {}

  private wake() {
    const list = this.waiters
    this.waiters = []
    for (const w of list) w()
  }

  /** Takes a frame (its pixels are copied before this returns). */
  submit(frame: PictureFrame) {
    if (this.closed || this.failure) return
    if (!this.encoder) {
      this.first = frame
      const encoder = this.api.create({ output: (chunk, meta) => this.output(chunk, meta), error: (e) => this.fail(e) })
      encoder.addEventListener?.('dequeue', () => this.wake())
      // The encoder is configured for the picture the module actually makes: its even size, which can differ from the stream's by a pixel.
      encoder.configure({ ...this.config, width: frame.width, height: frame.height })
      this.encoder = encoder
    }
    const key = frame.timestamp - this.lastKey >= KEY_EVERY_US - 1
    if (key) this.lastKey = frame.timestamp
    const picture = this.api.frame(frame.data, { format: 'I420', codedWidth: frame.width, codedHeight: frame.height, timestamp: frame.timestamp, duration: frame.duration, colorSpace: colourOf(frame.matrix, frame.width, frame.height) })
    try {
      this.durations.set(frame.timestamp, frame.duration)
      this.encoder.encode(picture, { keyFrame: key })
      this.inFlight++
      this.frames++
    } finally {
      picture.close()
    }
  }

  private output(chunk: EncodedChunkLike, meta?: { decoderConfig?: { description?: ArrayBuffer | ArrayBufferView } }) {
    if (this.closed) return
    try {
      if (!this.opened) {
        const d = meta?.decoderConfig?.description
        const first = this.first!
        if (!d) throw new Error('This browser’s video encoder didn’t say how it encodes. Try another source, or another browser.')
        const description = d instanceof ArrayBuffer ? new Uint8Array(d.slice(0)) : new Uint8Array(d.buffer.slice(d.byteOffset, d.byteOffset + d.byteLength))
        this.sink.videoOpen({ description, width: first.width, height: first.height, sarNumerator: first.sarNumerator, sarDenominator: first.sarDenominator })
        this.opened = true
      }
      const duration = chunk.duration ?? this.durations.get(chunk.timestamp) ?? 40_000
      this.durations.delete(chunk.timestamp)
      this.sink.videoPacket(chunk.byteLength, (into) => chunk.copyTo(into), chunk.timestamp, duration, chunk.type === 'key')
      this.packets++
      this.inFlight = Math.max(0, this.inFlight - 1)
      this.events.onProduced?.(duration / 1e6)
      this.events.onPacket?.()
    } catch (error) {
      this.fail(error instanceof Error ? error : new Error(String(error)))
    }
    this.wake()
  }

  private fail(error: Error) {
    this.failure ??= error
    this.wake()
  }

  /** Resolves when the encoder can take more frames; rejects if it has failed. Stops waiting when `signal` aborts. */
  async ready(signal: AbortSignal) {
    while (!signal.aborted && !this.closed) {
      if (this.failure) throw this.failure
      if (!this.encoder || (this.encoder.encodeQueueSize <= MAX_QUEUE && this.inFlight <= MAX_IN_FLIGHT)) return
      await new Promise<void>((resolve) => {
        this.waiters.push(resolve)
        signal.addEventListener('abort', () => resolve(), { once: true })
        // A browser whose encoder doesn't say when it has room gets looked at again shortly.
        setTimeout(resolve, 50)
      })
    }
  }

  /** Waits for everything submitted to come out. */
  async flush() {
    if (!this.encoder || this.closed) return
    await this.encoder.flush()
    if (this.failure) throw this.failure
  }

  close() {
    if (this.closed) return
    this.closed = true
    try {
      this.encoder?.close()
    } catch {
      // Already closed by an error.
    }
    this.durations.clear()
    this.wake()
  }
}
