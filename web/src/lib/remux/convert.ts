/* Audio conversion in the remux worker, for sound a browser can't decode (Dolby TrueHD, DTS, and
   Dolby Digital where the browser has no decoder). The remuxer hands over a track's raw frames;
   FFmpeg's decoders in WebAssembly (src/lib/audio) turn them into stereo PCM; WebCodecs' AudioEncoder
   makes Opus of that; and OpusMuxer wraps the packets in fragmented MP4, so the page appends them
   like any other audio. Only the worker imports this file, and only when such a track is chosen: the
   decoder's WebAssembly isn't fetched before that.

   Time. The first raw fragment after a start or seek anchors the timeline at its first payload's
   time. From there audio is counted in samples: a sample's time is the anchor plus how many samples
   came before it, however the container stamped the blocks. A fragment that starts more than a
   quarter second away from that count (a hole in the file, a run of frames the decoder dropped) moves
   the anchor, so the sound doesn't drift against the picture.

   Failure. Anything that goes wrong (the decoder doesn't load or traps, the encoder errors) is
   reported once through `host.failed`, and the converter then ignores everything until the next
   `use`. The worker keeps reading the picture. */

import { type AudioCodec, type AudioDecoders, type AudioStreamDecoder, loadAudioDecoders } from '../audio/decoder'
import { OpusMuxer } from './pkg/flow_remux.js'

const RATE = 48000
/** Opus packets gather into fragments of about this long (in samples), the size of a normal audio fragment. */
const FRAGMENT_TICKS = RATE
/** What a typical Opus encoder lags by, in samples, when it doesn't say. */
const DEFAULT_PRE_SKIP = 312
/** Seconds the next fragment may sit away from the sample count before the timeline is re-anchored. */
const REANCHOR_AFTER = 0.25
/** PCM goes to the encoder in slices this long, and no more than a few are waiting at once. */
const SLICE_FRAMES = RATE / 2
const QUEUE_LIMIT = 4
/** An encoder that takes nothing for this long is stuck. */
const STALL_MS = 15000

const ENCODER_CONFIG = { codec: 'opus', sampleRate: RATE, numberOfChannels: 2, bitrate: 160000 }

export interface ConvertHost {
  /** True until the page has been sent the init segment for the audio it is now playing. */
  initNeeded(): boolean
  init(epoch: number, data: ArrayBuffer): void
  fragment(epoch: number, start: number, end: number, data: ArrayBuffer): void
  failed(epoch: number, message: string): void
}

interface Packet {
  bytes: Uint8Array
  /** 48 kHz ticks. */
  ticks: number
  length: number
}

/** The pre-skip from an OpusHead (bytes 10 and 11, little-endian), when the encoder describes its stream. */
export function preSkipOf(description: AllowSharedBufferSource | undefined): number {
  if (!description) return DEFAULT_PRE_SKIP
  const bytes = ArrayBuffer.isView(description) ? new Uint8Array(description.buffer, description.byteOffset, description.byteLength) : new Uint8Array(description)
  if (bytes.length < 12 || bytes[0] !== 0x4f || bytes[1] !== 0x70) return DEFAULT_PRE_SKIP
  return bytes[10]! | (bytes[11]! << 8)
}

export class AudioConverter {
  /** The worker's current stream; late results from an older one are never posted under the new number. */
  private epoch = 0
  private dead = false
  private decoders: Promise<AudioDecoders> | undefined
  private stream: AudioStreamDecoder | null = null
  private opened: Promise<void> = Promise.resolve()
  private encoder: AudioEncoder | null = null
  private muxer: OpusMuxer | null = null
  /** Bumped by every reset, so work that was waiting (on the encoder, on a flush) notices its stream was replaced and stops. */
  private generation = 0
  private anchor: number | null = null
  private fed = 0
  private packets: Packet[] = []
  private packetTicks = 0

  constructor(private host: ConvertHost) {}

  /** False after a failure, until `use` is called again. The worker then drops this track's frames. */
  get working(): boolean {
    return !this.dead
  }

  /** Loads the decoders (the first time) and opens one for `codec`. Fails quietly into `host.failed`. */
  use(codec: AudioCodec, epoch: number): Promise<void> {
    this.epoch = epoch
    this.dead = false
    this.opened = (async () => {
      try {
        const decoders = await (this.decoders ??= loadAudioDecoders())
        this.stream?.close()
        this.stream = null
        this.stream = decoders.open(codec)
      } catch (error) {
        this.fail(error)
      }
    })()
    return this.opened
  }

  /** Starts over for a new stream (start, seek, track switch): nothing from the old one survives. */
  begin(epoch: number) {
    this.epoch = epoch
    this.generation++
    this.packets = []
    this.packetTicks = 0
    this.anchor = null
    this.fed = 0
    if (this.dead) return
    try {
      this.stream?.flush()
    } catch (error) {
      return this.fail(error)
    }
    this.resetEncoder()
  }

  /** Converts one raw fragment: `bytes` are its payloads back to back, `start` the first one's time. */
  async feed(start: number, bytes: Uint8Array): Promise<void> {
    await this.opened
    if (this.dead || !this.stream || !this.encoder) return
    const generation = this.generation
    try {
      if (this.anchor === null) {
        this.anchor = Math.round(start * RATE)
        this.fed = 0
      } else if (Math.abs(start - (this.anchor + this.fed) / RATE) > REANCHOR_AFTER) {
        await this.reanchor(start)
        if (generation !== this.generation || this.dead) return
      }
      await this.encode(this.stream.decode(bytes), generation)
    } catch (error) {
      this.fail(error)
    }
  }

  /** The end of the file: the decoder's last frames, the encoder's last packets, then the final fragment. Everything is posted when this resolves. */
  async finish(): Promise<void> {
    await this.opened
    if (this.dead || !this.stream || !this.encoder) return
    const generation = this.generation
    try {
      if (this.anchor !== null) await this.encode(this.stream.finish(), generation)
      if (generation !== this.generation || this.dead) return
      await this.encoder.flush()
      if (generation === this.generation) this.post()
    } catch (error) {
      this.fail(error)
    }
  }

  close() {
    this.dead = true
    this.generation++
    try {
      this.encoder?.close()
    } catch {}
    this.encoder = null
    try {
      this.stream?.close()
    } catch {}
    this.stream = null
  }

  // MARK: Timeline

  /** A hole in the file: what's been encoded is sent first, then the count starts again from `start`. */
  private async reanchor(start: number) {
    await this.encoder!.flush()
    this.post()
    this.stream!.flush()
    this.anchor = Math.round(start * RATE)
    this.fed = 0
  }

  private async encode(pcm: Float32Array, generation: number) {
    const frames = pcm.length >> 1
    for (let at = 0; at < frames; ) {
      await this.room(generation)
      if (generation !== this.generation || this.dead || !this.encoder) return
      const count = Math.min(frames - at, SLICE_FRAMES)
      const ticks = this.anchor! + this.fed
      const data = new AudioData({ format: 'f32', sampleRate: RATE, numberOfFrames: count, numberOfChannels: 2, timestamp: Math.round((ticks * 1e6) / RATE), data: (pcm as Float32Array<ArrayBuffer>).subarray(at * 2, (at + count) * 2) })
      try {
        this.encoder.encode(data)
      } finally {
        data.close()
      }
      this.fed += count
      at += count
    }
  }

  /** Backpressure: waits while the encoder has a few slices queued, so decoding never runs far ahead of it. */
  private async room(generation: number) {
    const began = performance.now()
    while (this.encoder && this.encoder.encodeQueueSize >= QUEUE_LIMIT && !this.dead && generation === this.generation) {
      if (performance.now() - began > STALL_MS) throw new Error('The audio encoder stopped responding.')
      await new Promise((resolve) => setTimeout(resolve, 4))
    }
  }

  // MARK: Encoder

  private resetEncoder() {
    try {
      if (!this.encoder || this.encoder.state === 'closed') {
        // `reset()` stops the old stream's results from arriving, so a packet that does arrive belongs to this one.
        this.encoder = new AudioEncoder({ output: (chunk, metadata) => this.packet(chunk, metadata), error: (error) => this.fail(error) })
      } else {
        this.encoder.reset()
      }
      try {
        // 20 ms packets are what the muxer's durations and the page's buffering assume.
        this.encoder.configure({ ...ENCODER_CONFIG, opus: { frameDuration: 20000 } } as AudioEncoderConfig)
      } catch {
        this.encoder.configure(ENCODER_CONFIG)
      }
    } catch (error) {
      this.fail(error)
    }
  }

  private packet(chunk: EncodedAudioChunk, metadata: EncodedAudioChunkMetadata | undefined) {
    if (this.dead) return
    try {
      if (!this.muxer) this.muxer = new OpusMuxer(2, preSkipOf(metadata?.decoderConfig?.description))
      if (this.host.initNeeded()) {
        const init = this.muxer.init()
        this.host.init(this.epoch, init.buffer as ArrayBuffer)
      }
      const bytes = new Uint8Array(chunk.byteLength)
      chunk.copyTo(bytes)
      const ticks = Math.round((chunk.timestamp * RATE) / 1e6)
      const length = chunk.duration ? Math.round((chunk.duration * RATE) / 1e6) : 960
      const last = this.packets[this.packets.length - 1]
      // Packets that don't follow each other can't share a fragment.
      if (last && Math.abs(ticks - (last.ticks + last.length)) > 2) this.post()
      this.packets.push({ bytes, ticks, length })
      this.packetTicks += length
      if (this.packetTicks >= FRAGMENT_TICKS) this.post()
    } catch (error) {
      this.fail(error)
    }
  }

  /** Wraps the packets gathered so far in one fragment and sends it. */
  private post() {
    const packets = this.packets
    if (!packets.length || !this.muxer) return
    this.packets = []
    this.packetTicks = 0
    const data = new Uint8Array(packets.reduce((sum, p) => sum + p.bytes.length, 0))
    let at = 0
    for (const p of packets) {
      data.set(p.bytes, at)
      at += p.bytes.length
    }
    const first = packets[0]!
    const last = packets[packets.length - 1]!
    const fragment = this.muxer.fragment(
      first.ticks,
      data,
      Uint32Array.from(packets, (p) => p.bytes.length),
      Uint32Array.from(packets, (p) => p.length),
    )
    this.host.fragment(this.epoch, first.ticks / RATE, (last.ticks + last.length) / RATE, fragment.buffer as ArrayBuffer)
  }

  private fail(error: unknown) {
    if (this.dead) return
    // A decoder that trapped can't be used again, so the next attempt starts from a new instance.
    this.decoders = undefined
    this.close()
    this.muxer = null
    this.host.failed(this.epoch, error instanceof Error ? error.message : String(error))
  }
}
