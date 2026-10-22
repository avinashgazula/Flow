import { describe, expect, it } from 'vitest'
import { CACHE_SIZE, firstRead, type Found, FIRST_READ, Lru, MAX_FIRST_READ, READ_CAP, readKeyframe, thumbSize } from './thumbs'

/** A file whose bytes are their own offsets mod 251, served in ranges, `chunk` bytes at a time. */
function server(length: number, chunk = 4096) {
  const asked: [number, number][] = []
  const delivered: number[] = []
  const open = async (start: number, end: number, signal: AbortSignal): Promise<Response> => {
    signal.throwIfAborted()
    asked.push([start, end])
    const to = Math.min(end, length - 1)
    let at = start
    const index = delivered.push(0) - 1
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (at > to) return controller.close()
        const n = Math.min(chunk, to + 1 - at)
        controller.enqueue(Uint8Array.from({ length: n }, (_, i) => (at + i) % 251))
        at += n
        delivered[index] = at - start
      },
    })
    return new Response(body, { status: 206 })
  }
  return { open, asked, delivered }
}

/** The demuxer's side: the keyframe's block ends `size` bytes in. Until it is whole, it says so, as the real one does. */
function demuxer(size: number, calls: number[] = []) {
  return (bytes: Uint8Array): Found => {
    calls.push(bytes.length)
    return bytes.length >= size ? { kind: 'found', time: 12.5 } : { kind: 'more', need: bytes.length < 16 ? bytes.length + 16 : size }
  }
}

const read = (s: ReturnType<typeof server>, over: Partial<Parameters<typeof readKeyframe>[0]> = {}) =>
  readKeyframe({ offset: 1_000_000, length: 100_000_000, first: FIRST_READ, open: s.open, find: demuxer(100_000), signal: new AbortController().signal, ...over })

describe('readKeyframe', () => {
  it('stops reading as soon as the keyframe is whole', async () => {
    const s = server(100_000_000)
    const result = await read(s)
    expect(result).toMatchObject({ kind: 'found', time: 12.5 })
    expect(s.asked).toEqual([[1_000_000, 1_000_000 + FIRST_READ - 1]])
    // The body was cancelled after the chunk that completed it, not read to the end of the range.
    expect(s.delivered[0]!).toBeLessThan(FIRST_READ)
    expect(s.delivered[0]!).toBeGreaterThanOrEqual(100_000)
  })

  it('asks the demuxer once the last thing it wanted has arrived, not on every chunk', async () => {
    const calls: number[] = []
    const s = server(100_000_000, 100)
    await read(s, { find: demuxer(30_000, calls) })
    // A few calls at the start (it asks for 16 more bytes at a time while it has nothing), then one when its bytes are in.
    expect(calls.at(-1)).toBe(30_000)
    expect(calls.length).toBeLessThan(10)
  })

  it('goes on from where the first request ended, for what is missing', async () => {
    const s = server(100_000_000)
    // 1.2 MB of keyframe against a 512 KB first read.
    const result = await read(s, { find: demuxer(1_200_000) })
    expect(result).toMatchObject({ kind: 'found' })
    expect(s.asked).toHaveLength(2)
    expect(s.asked[0]).toEqual([1_000_000, 1_000_000 + FIRST_READ - 1])
    // The second starts at the next byte after the first range was read, and covers the rest with a little over.
    expect(s.asked[1]![0]).toBe(1_000_000 + FIRST_READ)
    expect(s.asked[1]![1]).toBeGreaterThanOrEqual(1_000_000 + 1_200_000 - 1)
    expect(s.asked[1]![1]).toBeLessThan(1_000_000 + 1_200_000 + 100_000)
    // Never two reads at once: the first one's body had ended before the second began.
    expect(s.delivered[0]).toBe(FIRST_READ)
  })

  it('learns the size early and does not stop the first read, so nothing is fetched twice', async () => {
    const s = server(100_000_000)
    const result = await read(s, { find: demuxer(700_000), first: 256 * 1024 })
    expect(result).toMatchObject({ kind: 'found', bytes: expect.any(Number) })
    expect(s.asked[0]).toEqual([1_000_000, 1_000_000 + 256 * 1024 - 1])
    expect(s.asked[1]![0]).toBe(1_000_000 + 256 * 1024)
  })

  it('hands the demuxer the file in order and whole', async () => {
    const s = server(100_000_000, 1000)
    let seen = new Uint8Array(0)
    await read(s, {
      first: 100_000,
      find: (bytes) => {
        seen = bytes.slice()
        return bytes.length >= 250_000 ? { kind: 'found', time: 0 } : { kind: 'more', need: 250_000 }
      },
    })
    expect(seen).toHaveLength(250_000)
    for (const i of [0, 1, 99_999, 100_000, 100_001, 249_999]) expect(seen[i]).toBe((1_000_000 + i) % 251)
  })

  it('gives up on a keyframe too far into the cluster, before fetching it', async () => {
    const s = server(100_000_000)
    const result = await read(s, { find: () => ({ kind: 'more', need: READ_CAP + 1 }) })
    expect(result).toEqual({ kind: 'toofar', need: READ_CAP + 1 })
    expect(s.asked).toHaveLength(1)
  })

  it('reports a cluster with no keyframe', async () => {
    const s = server(100_000_000)
    expect(await read(s, { find: () => ({ kind: 'none' }) })).toEqual({ kind: 'none' })
    expect(s.asked).toHaveLength(1)
  })

  it('stops at the end of the file', async () => {
    const s = server(1_300_000)
    const result = await read(s, { length: 1_300_000, find: demuxer(250_000) })
    expect(result).toMatchObject({ kind: 'found' })
    // Near the end: the range is clamped to the file.
    const near = server(1_050_000)
    expect(await read(near, { length: 1_050_000, find: demuxer(900_000) })).toEqual({ kind: 'none' })
    expect(near.asked.every(([, end]) => end <= 1_049_999)).toBe(true)
    expect(near.asked.length).toBeLessThanOrEqual(2)
  })

  it('carries on after a body that ended early', async () => {
    const s = server(100_000_000)
    let cut = true
    const open = async (start: number, end: number, signal: AbortSignal) => {
      if (!cut) return s.open(start, end, signal)
      cut = false
      return s.open(start, start + 70_000 - 1, signal)
    }
    const result = await read(s, { open, find: demuxer(150_000) })
    expect(result).toMatchObject({ kind: 'found' })
    expect(s.asked).toHaveLength(2)
    expect(s.asked[1]![0]).toBe(1_000_000 + 70_000)
  })

  it('stops when aborted', async () => {
    const s = server(100_000_000)
    const controller = new AbortController()
    controller.abort()
    await expect(read(s, { signal: controller.signal })).rejects.toThrow()
    expect(s.asked).toHaveLength(0)
  })

  it('does not wait for a body that has none', async () => {
    const open = async () => new Response(null, { status: 206 })
    expect(await read(server(10), { open })).toEqual({ kind: 'none' })
  })
})

describe('Lru', () => {
  it('keeps the newest and closes what it drops', () => {
    const closed: number[] = []
    const lru = new Lru<number>(3, (v) => closed.push(v))
    for (let i = 1; i <= 3; i++) lru.set(`k${i}`, i)
    // Looking one up keeps it.
    expect(lru.get('k1')).toBe(1)
    lru.set('k4', 4)
    expect(closed).toEqual([2])
    expect(lru.get('k2')).toBeUndefined()
    expect(lru.length).toBe(3)
    lru.set('k4', 40)
    expect(closed).toEqual([2, 4])
    lru.clear()
    expect([...closed].sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 40])
    expect(lru.length).toBe(0)
  })

  it('holds sixty pictures', () => {
    const lru = new Lru<number>(CACHE_SIZE)
    for (let i = 0; i < 100; i++) lru.set(String(i), i)
    expect(lru.length).toBe(60)
    expect(lru.get('39')).toBeUndefined()
    expect(lru.get('40')).toBe(40)
  })
})

describe('sizes', () => {
  it('draws at most 320 wide, keeping the shape, and never enlarges', () => {
    expect(thumbSize(3840, 2160)).toEqual({ width: 320, height: 180 })
    expect(thumbSize(1920, 800)).toEqual({ width: 320, height: 133 })
    expect(thumbSize(1280, 536)).toEqual({ width: 320, height: 134 })
    expect(thumbSize(240, 180)).toEqual({ width: 240, height: 180 })
    expect(thumbSize(0, 0)).toEqual({ width: 320, height: 180 })
    expect(thumbSize(1080, 1920)).toEqual({ width: 320, height: 569 })
  })

  it('reads enough for the keyframes this file has given', () => {
    expect(firstRead(0)).toBe(FIRST_READ)
    expect(firstRead(100_000)).toBe(FIRST_READ)
    expect(firstRead(1_000_000)).toBe(1_507_328)
    expect(firstRead(50_000_000)).toBe(MAX_FIRST_READ)
    expect(firstRead(1_000_000) % 65536).toBe(0)
  })
})
