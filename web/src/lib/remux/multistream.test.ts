import { describe, expect, it } from 'vitest'
import { multistreamPacket, SURROUND_51, selfDelimit, splitStreams, streamLayout } from './multistream'

/* RFC 6716 section 3 (packet framing) and appendix B (self-delimiting framing), read independently of
   the code under test: two small parsers, one for each form, that return the TOC, the frame payloads
   and the padding. A packet is right when its self-delimited form parses to the same frames. */

interface Parsed {
  toc: number
  frames: Uint8Array[]
  padding: number
  used: number
}

function size(p: Uint8Array, at: number): [number, number] {
  return p[at]! < 252 ? [p[at]!, 1] : [p[at]! + 4 * p[at + 1]!, 2]
}

function parse(p: Uint8Array, delimited: boolean): Parsed {
  const toc = p[0]!
  const code = toc & 3
  let at = 1
  const sizes: number[] = []
  let padding = 0
  let count = code === 0 ? 1 : code === 3 ? 0 : 2
  if (code === 0) {
    if (delimited) {
      const [n, u] = size(p, at)
      at += u
      sizes.push(n)
    } else sizes.push(p.length - 1)
  } else if (code === 1) {
    if (delimited) {
      const [n, u] = size(p, at)
      at += u
      sizes.push(n, n)
    } else sizes.push((p.length - 1) / 2, (p.length - 1) / 2)
  } else if (code === 2) {
    const [a, ua] = size(p, at)
    at += ua
    sizes.push(a)
    if (delimited) {
      const [b, ub] = size(p, at)
      at += ub
      sizes.push(b)
    } else sizes.push(-1) // the rest
  } else {
    const flags = p[at++]!
    count = flags & 0x3f
    const vbr = (flags & 0x80) !== 0
    if (flags & 0x40) {
      for (;;) {
        const b = p[at++]!
        padding += b === 255 ? 254 : b
        if (b !== 255) break
      }
    }
    if (vbr) {
      for (let i = 0; i < count - 1; i++) {
        const [n, u] = size(p, at)
        at += u
        sizes.push(n)
      }
      if (delimited) {
        const [n, u] = size(p, at)
        at += u
        sizes.push(n)
      } else sizes.push(-1)
    } else if (delimited) {
      const [n, u] = size(p, at)
      at += u
      for (let i = 0; i < count; i++) sizes.push(n)
    } else {
      const each = (p.length - at - padding) / count
      for (let i = 0; i < count; i++) sizes.push(each)
    }
  }
  const frames: Uint8Array[] = []
  for (let i = 0; i < count; i++) {
    let n = sizes[i]!
    if (n === -1) n = p.length - at - padding
    frames.push(p.subarray(at, at + n))
    at += n
  }
  return { toc, frames, padding, used: at + padding }
}

const bytes = (n: number, seed: number) => Uint8Array.from({ length: n }, (_, i) => (seed + i * 7) & 255)
const cat = (...parts: (Uint8Array | number[])[]) => Uint8Array.from(parts.flatMap((p) => [...p]))

function expectSameFrames(standard: Uint8Array) {
  const delimited = selfDelimit(standard)
  const a = parse(standard, false)
  const b = parse(delimited, true)
  expect(b.toc).toBe(a.toc)
  expect(b.frames.map((f) => [...f])).toEqual(a.frames.map((f) => [...f]))
  expect(b.padding).toBe(a.padding)
  // The delimited packet is exactly what the parse consumed: nothing left over to be mistaken for the next stream.
  expect(b.used).toBe(delimited.length)
  return delimited
}

describe('selfDelimit', () => {
  it('code 0: adds the frame length after the TOC', () => {
    const frame = bytes(100, 1)
    expect([...expectSameFrames(cat([0x78], frame))].slice(0, 3)).toEqual([0x78, 100, 1])
  })

  it('writes lengths of 252 and over in two bytes', () => {
    const frame = bytes(400, 3)
    const out = expectSameFrames(cat([0x78], frame))
    // 400 = 252 + (4 * 37) + 0 -> first byte 252 + (400 & 3) = 252, second (400 - 252) >> 2 = 37.
    expect([...out.subarray(1, 3)]).toEqual([252, 37])
    expect(out.length).toBe(1 + 2 + 400)
    const odd = expectSameFrames(cat([0x78], bytes(1275, 5)))
    expect(odd[1]).toBe(252 + (1275 & 3))
  })

  it('code 1: two equal frames, with the size of each', () => {
    const out = expectSameFrames(cat([0x79], bytes(60, 9)))
    expect([...out.subarray(0, 2)]).toEqual([0x79, 30])
  })

  it('code 2: adds the second frame’s size after the first’s', () => {
    const out = expectSameFrames(cat([0x7a, 10], bytes(10, 2), bytes(25, 4)))
    expect([...out.subarray(0, 3)]).toEqual([0x7a, 10, 25])
  })

  it('code 3 with equal frames adds the one frame size', () => {
    // 3 frames of 20 bytes, CBR, no padding.
    const out = expectSameFrames(cat([0x7b, 0x03], bytes(60, 6)))
    expect([...out.subarray(0, 3)]).toEqual([0x7b, 0x03, 20])
  })

  it('code 3 with variable frames adds the last frame’s size', () => {
    // 3 VBR frames of 10, 300 and 40 bytes: sizes of the first two are coded, the last implied.
    const out = expectSameFrames(cat([0x7b, 0x83, 10, 252 + 0, 12], bytes(10, 1), bytes(300, 2), bytes(40, 3)))
    expect(out.length).toBe(6 + 350)
  })

  it('code 3 keeps its padding, which sits after the frames', () => {
    const out = expectSameFrames(cat([0x7b, 0x42, 7], bytes(2 * 11, 8), new Uint8Array(7)))
    expect(out.length).toBe(4 + 22 + 7)
    // And a padding length of 254 + 5 (a 255 byte then a 5).
    expectSameFrames(cat([0x7b, 0x41, 255, 5], bytes(30, 1), new Uint8Array(259)))
  })

  it('rejects what is not a packet', () => {
    expect(() => selfDelimit(new Uint8Array(0))).toThrow()
    expect(() => selfDelimit(cat([0x79], bytes(5, 1)))).toThrow()
    expect(() => selfDelimit(cat([0x7a, 200], bytes(10, 1)))).toThrow()
    expect(() => selfDelimit(cat([0x7b, 0x00]))).toThrow()
  })
})

describe('multistreamPacket', () => {
  it('delimits every stream but the last, which runs to the end', () => {
    const streams = [cat([0x78], bytes(40, 1)), cat([0x78], bytes(30, 2)), cat([0x58], bytes(20, 3)), cat([0x58], bytes(10, 4))]
    const packet = multistreamPacket(streams)
    // Walk it the way a decoder does: three delimited packets, then whatever is left.
    let at = 0
    for (let i = 0; i < 3; i++) {
      const parsed = parse(packet.subarray(at), true)
      expect([...parsed.frames[0]!]).toEqual([...streams[i]!.subarray(1)])
      at += parsed.used
    }
    expect([...packet.subarray(at)]).toEqual([...streams[3]!])
  })

  it('is the one packet itself for a single stream', () => {
    const only = cat([0x78], bytes(12, 1))
    expect([...multistreamPacket([only])]).toEqual([...only])
  })
})

describe('the 5.1 layout', () => {
  it('matches the dOps table: four streams, two of them coupled, Vorbis order L C R Ls Rs LFE', () => {
    expect(streamLayout(6)).toBe(SURROUND_51)
    expect(streamLayout(2)).toBeNull()
    expect(streamLayout(8)).toBeNull()
    // Stream channel order is [L R] [Ls Rs] [C] [LFE], and dOps's table [0, 4, 1, 2, 3, 5] says output
    // channel k reads stream channel table[k]: L(0)=0, C(1)=4, R(2)=1, Ls(3)=2, Rs(4)=3, LFE(5)=5.
    const streamChannel = SURROUND_51.flatMap((s) => s.channels) // the output channel each stream channel carries
    const table = [0, 4, 1, 2, 3, 5]
    expect(table.map((stream) => streamChannel[stream])).toEqual([0, 1, 2, 3, 4, 5])
    expect(SURROUND_51.map((s) => s.channels.length)).toEqual([2, 2, 1, 1])
  })

  it('splits interleaved frames into the streams', () => {
    // Frames of six values: the channel number times ten plus the frame number.
    const pcm = Float32Array.from({ length: 4 * 6 }, (_, i) => Math.floor(i % 6) * 10 + Math.floor(i / 6))
    const [lr, sls, c, lfe] = splitStreams(pcm, 6, SURROUND_51, 1, 2)
    expect([...lr!]).toEqual([1, 21, 2, 22]) // L and R (channels 0 and 2) of frames 1 and 2
    expect([...sls!]).toEqual([31, 41, 32, 42]) // Ls and Rs (3 and 4)
    expect([...c!]).toEqual([11, 12]) // C (1)
    expect([...lfe!]).toEqual([51, 52]) // LFE (5)
  })
})
