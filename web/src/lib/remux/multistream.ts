/* Multichannel Opus out of WebCodecs' encoders, which only make mono and stereo.

   An Opus multistream packet (RFC 7845's channel mapping family 1, the same one a 5.1 Opus file
   uses) is several ordinary Opus packets side by side, one per stream, with every packet but the last
   "self-delimited": it carries its own length so a decoder knows where the next one starts (RFC 6716
   appendix B). So 5.1 is four small encoders, a stereo pair for the fronts, a stereo pair for the
   surrounds and a mono each for the centre and the LFE, with their packets stitched together here.
   This is how libopus lays out six channels too: 4 streams, 2 of them coupled.

   Channel order is Vorbis order, which is what the dOps table in the init segment (opus_mux.rs) assumes:
   L C R Ls Rs LFE. Stream 0 takes L and R, stream 1 Ls and Rs, stream 2 C, stream 3 LFE. */

/** One encoder's share of the channels: which interleaved input channels it takes. */
export interface StreamLayout {
  /** Indexes into the interleaved frame: [left, right] for a coupled stream, [mono] otherwise. */
  channels: number[]
  /** Target bit rate for this stream. */
  bitrate: number
}

/** 5.1 in Vorbis order, matching `mapping(6)` in opus_mux.rs: [0, 4, 1, 2, 3, 5]. */
export const SURROUND_51: StreamLayout[] = [
  { channels: [0, 2], bitrate: 96000 }, // L R
  { channels: [3, 4], bitrate: 96000 }, // Ls Rs
  { channels: [1], bitrate: 48000 }, // C
  { channels: [5], bitrate: 32000 }, // LFE
]

/** The streams for a channel count, or null where there is no multistream layout (mono and stereo
 *  are a single plain encoder). Only 5.1 exists: 7.1 is mixed down to it before it gets here. */
export function streamLayout(channels: number): StreamLayout[] | null {
  return channels === 6 ? SURROUND_51 : null
}

function putSize(out: number[], size: number) {
  if (size < 252) out.push(size)
  else {
    out.push(252 + (size & 3), (size - 252) >> 2)
  }
}

/** Reads a frame length: one byte below 252, otherwise two. Returns the size and the bytes used. */
function readSize(p: Uint8Array, at: number): [number, number] {
  if (at >= p.length) throw new Error('Truncated Opus packet.')
  const first = p[at]!
  if (first < 252) return [first, 1]
  if (at + 1 >= p.length) throw new Error('Truncated Opus packet.')
  return [first + 4 * p[at + 1]!, 2]
}

/** Rewrites a standard Opus packet in the self-delimited form (RFC 6716 appendix B), which adds the
 *  length of the last frame so that another packet can follow it. */
export function selfDelimit(p: Uint8Array): Uint8Array {
  if (p.length === 0) throw new Error('Empty Opus packet.')
  const toc = p[0]!
  const code = toc & 3
  const head: number[] = [toc]
  let body: Uint8Array
  let tail: Uint8Array = new Uint8Array(0)

  if (code === 0) {
    // One frame: the rest of the packet.
    putSize(head, p.length - 1)
    body = p.subarray(1)
  } else if (code === 1) {
    // Two equal frames: the size of each.
    const each = (p.length - 1) >> 1
    if (each * 2 !== p.length - 1) throw new Error('Malformed Opus packet.')
    putSize(head, each)
    body = p.subarray(1)
  } else if (code === 2) {
    // Two frames: the first's size is coded, and the second (the rest) gets its size added.
    const [first, used] = readSize(p, 1)
    const second = p.length - 1 - used - first
    if (second < 0) throw new Error('Malformed Opus packet.')
    putSize(head, first)
    putSize(head, second)
    body = p.subarray(1 + used)
  } else {
    if (p.length < 2) throw new Error('Truncated Opus packet.')
    const flags = p[1]!
    const count = flags & 0x3f
    const vbr = (flags & 0x80) !== 0
    let at = 2
    head.push(flags)
    // Padding length: bytes of 255 each add 254 and the first other byte adds its own value.
    let padding = 0
    if (flags & 0x40) {
      for (;;) {
        if (at >= p.length) throw new Error('Truncated Opus packet.')
        const b = p[at++]!
        head.push(b)
        padding += b === 255 ? 254 : b
        if (b !== 255) break
      }
    }
    const dataEnd = p.length - padding
    if (count === 0 || dataEnd < at) throw new Error('Malformed Opus packet.')
    if (vbr) {
      // Sizes of all frames but the last, then the last's is added.
      let framesSize = 0
      for (let i = 0; i < count - 1; i++) {
        const [size, used] = readSize(p, at)
        for (let k = 0; k < used; k++) head.push(p[at + k]!)
        at += used
        framesSize += size
      }
      putSize(head, dataEnd - at - framesSize)
    } else {
      // Equal frames: one size, which a standard packet leaves implied.
      const each = (dataEnd - at) / count
      if (!Number.isInteger(each)) throw new Error('Malformed Opus packet.')
      putSize(head, each)
    }
    body = p.subarray(at, dataEnd)
    tail = p.subarray(dataEnd)
  }

  const out = new Uint8Array(head.length + body.length + tail.length)
  out.set(head, 0)
  out.set(body, head.length)
  out.set(tail, head.length + body.length)
  return out
}

/** One multistream packet from one packet per stream, in stream order. */
export function multistreamPacket(streams: Uint8Array[]): Uint8Array {
  const parts = streams.map((p, i) => (i < streams.length - 1 ? selfDelimit(p) : p))
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
  let at = 0
  for (const p of parts) {
    out.set(p, at)
    at += p.length
  }
  return out
}

/** Splits interleaved frames into one buffer per stream: stereo streams stay interleaved. */
export function splitStreams(pcm: Float32Array, channels: number, layout: StreamLayout[], from: number, count: number): Float32Array[] {
  return layout.map(({ channels: take }) => {
    const out = new Float32Array(count * take.length)
    for (let i = 0; i < count; i++) {
      const frame = (from + i) * channels
      for (let k = 0; k < take.length; k++) out[i * take.length + k] = pcm[frame + take[k]!]!
    }
    return out
  })
}
