import { describe, expect, it } from 'vitest'
import { type PictureCue, PictureTrack, parsePictureCues, rgbaOf } from './pictures'

/** What picture.rs `encode` writes: big-endian, a cue after a cue. */
function encode(cues: { start: number; end?: number; forced?: boolean; canvas?: [number, number]; palette?: number[][]; objects?: { x: number; y: number; w: number; h: number; pixels: number[] }[] }[]): Uint8Array {
  const parts: number[] = []
  const u16 = (n: number) => parts.push((n >> 8) & 255, n & 255)
  const f64 = (n: number) => {
    const b = new DataView(new ArrayBuffer(8))
    b.setFloat64(0, n)
    for (let i = 0; i < 8; i++) parts.push(b.getUint8(i))
  }
  parts.push(0, 0, 0, cues.length)
  for (const cue of cues) {
    f64(cue.start)
    f64(cue.end ?? NaN)
    u16(cue.canvas?.[0] ?? 1920)
    u16(cue.canvas?.[1] ?? 1080)
    parts.push(cue.forced ? 1 : 0, cue.objects?.length ?? 0)
    const palette = cue.palette ?? [[0, 0, 0, 0], [255, 255, 255, 255]]
    u16(palette.length)
    palette.forEach((c) => parts.push(...c))
    for (const o of cue.objects ?? []) {
      u16(o.x)
      u16(o.y)
      u16(o.w)
      u16(o.h)
      parts.push(...o.pixels)
    }
  }
  return new Uint8Array(parts)
}

const shown = (start: number, end?: number): PictureCue => parsePictureCues(encode([{ start, end, objects: [{ x: 10, y: 20, w: 2, h: 1, pixels: [1, 0] }] }]))[0]!
const clear = (start: number): PictureCue => parsePictureCues(encode([{ start }]))[0]!

describe('reading cues off the wire', () => {
  it('reads positions, pixels, the palette and the flags', () => {
    const [cue] = parsePictureCues(
      encode([{ start: 12.5, end: 14, forced: true, canvas: [720, 576], palette: [[0, 0, 0, 0], [255, 0, 0, 128]], objects: [{ x: 100, y: 500, w: 3, h: 2, pixels: [1, 1, 0, 0, 1, 1] }] }]),
    )
    expect(cue).toMatchObject({ start: 12.5, end: 14, forced: true, canvasWidth: 720, canvasHeight: 576 })
    expect(Array.from(cue!.palette)).toEqual([0, 0, 0, 0, 255, 0, 0, 128])
    expect(cue!.objects).toHaveLength(1)
    expect(cue!.objects[0]).toMatchObject({ x: 100, y: 500, width: 3, height: 2 })
    expect(Array.from(cue!.objects[0]!.indices)).toEqual([1, 1, 0, 0, 1, 1])
  })

  it('reads a cue with no end as open, and a clear as no objects', () => {
    const cues = parsePictureCues(encode([{ start: 1, objects: [{ x: 0, y: 0, w: 1, h: 1, pixels: [1] }] }, { start: 3 }]))
    expect(cues.map((c) => [c.start, c.end, c.objects.length])).toEqual([[1, null, 1], [3, null, 0]])
  })

  it('keeps the cues that arrived whole when the bytes end early', () => {
    const bytes = encode([{ start: 1, objects: [{ x: 0, y: 0, w: 2, h: 2, pixels: [1, 1, 1, 1] }] }, { start: 2, objects: [{ x: 0, y: 0, w: 2, h: 2, pixels: [1, 1, 1, 1] }] }])
    for (let cut = 0; cut < bytes.length; cut++) {
      const cues = parsePictureCues(bytes.subarray(0, cut))
      expect(cues.length).toBeLessThanOrEqual(cut < bytes.length / 2 ? 1 : 2)
    }
    expect(parsePictureCues(bytes)).toHaveLength(2)
    expect(parsePictureCues(new Uint8Array(0))).toEqual([])
    expect(parsePictureCues(new Uint8Array([0, 0, 0, 5]))).toEqual([])
  })

  it('reads a view into a bigger buffer', () => {
    const bytes = encode([{ start: 4, objects: [{ x: 0, y: 0, w: 1, h: 1, pixels: [1] }] }])
    const padded = new Uint8Array(bytes.length + 10)
    padded.set(bytes, 7)
    expect(parsePictureCues(padded.subarray(7, 7 + bytes.length))[0]!.start).toBe(4)
  })

  it('turns indices into straight RGBA, and leaves a missing colour clear', () => {
    const [cue] = parsePictureCues(encode([{ start: 0, palette: [[0, 0, 0, 0], [10, 20, 30, 128]], objects: [{ x: 0, y: 0, w: 3, h: 1, pixels: [1, 0, 9] }] }]))
    expect(Array.from(rgbaOf(cue!.objects[0]!, cue!.palette))).toEqual([10, 20, 30, 128, 0, 0, 0, 0, 0, 0, 0, 0])
  })
})

describe('a track of picture cues', () => {
  it('shows a cue until the next one starts, and a clear shows nothing', () => {
    const track = new PictureTrack()
    track.add([shown(1, 5), clear(3), shown(6, 8)])
    expect(track.at(0.5)).toBeNull()
    expect(track.at(1)?.start).toBe(1)
    expect(track.at(2.9)?.start).toBe(1)
    expect(track.at(3)).toBeNull()
    expect(track.at(5.5)).toBeNull()
    expect(track.at(7.9)?.start).toBe(6)
    expect(track.at(8)).toBeNull()
  })

  it('shows a cue with no end for ten seconds, as the apps do, or until the next', () => {
    const track = new PictureTrack()
    track.add([shown(10), shown(15)])
    expect(track.at(14.9)?.start).toBe(10)
    expect(track.at(15)?.start).toBe(15)
    expect(track.at(24.9)?.start).toBe(15)
    expect(track.at(25)).toBeNull()
  })

  it('takes cues in any order, and each once', () => {
    const track = new PictureTrack()
    expect(track.add([shown(20, 22), shown(1, 2)])).toBe(true)
    expect(track.add([shown(1, 2), shown(20, 22)])).toBe(false)
    expect(track.size).toBe(2)
    // A cue read between them after a seek ends the earlier one early.
    expect(track.add([shown(1.5, 30)])).toBe(true)
    expect(track.at(1.2)?.start).toBe(1)
    expect(track.at(1.6)?.start).toBe(1.5)
    expect(track.at(21)?.start).toBe(20)
  })

  it('lets go of the cues furthest from the playhead when over its budget', () => {
    const big = (start: number) => parsePictureCues(encode([{ start, end: start + 1, objects: [{ x: 0, y: 0, w: 100, h: 100, pixels: new Array(10_000).fill(1) }] }]))[0]!
    const track = new PictureTrack(100_000)
    track.add(Array.from({ length: 20 }, (_, i) => big(i * 10)))
    expect(track.size).toBe(20)
    track.trim(100)
    expect(track.size).toBeLessThan(20)
    // What is near the playhead stays.
    expect(track.at(100.5)?.start).toBe(100)
    expect(track.at(110.5)?.start).toBe(110)
    expect(track.at(0.5)).toBeNull()
  })
})
