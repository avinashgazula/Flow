/* The memory between the network and the media engine. The engine reads its file through a synchronous call
   (it is WebAssembly: it can't wait), so what it asks for has to be in memory already. The worker's parallel
   range reader keeps filling this cache ahead of the read position; a read the cache can't answer (the probe at
   the start, an index at the end of the file, a seek) is fetched on the spot with a blocking request, which a
   worker is allowed to make. Pure logic over byte ranges, tested without a network. */

import type { ByteSource } from './engine'

interface Segment {
  start: number
  bytes: Uint8Array
}

/** Byte ranges of the file, kept sorted and apart. Memory is bounded: past `capacity` the ranges furthest from where the engine last read go first. */
export class SegmentCache {
  private segments: Segment[] = []
  private total = 0
  private focus = 0

  constructor(private readonly capacity = 160 * 1024 * 1024) {}

  get size(): number {
    return this.total
  }

  /** Index of the last segment starting at or before `position` (-1 when none). */
  private before(position: number): number {
    let lo = 0
    let hi = this.segments.length - 1
    let found = -1
    while (lo <= hi) {
      const mid = (lo + hi) >> 1
      if (this.segments[mid]!.start <= position) {
        found = mid
        lo = mid + 1
      } else hi = mid - 1
    }
    return found
  }

  /** Stores `bytes` found at `start`, keeping only the parts not held already. */
  add(start: number, bytes: Uint8Array): void {
    if (bytes.length === 0) return
    const end = start + bytes.length
    // The gaps in [start, end) that no segment covers.
    let at = start
    let i = Math.max(0, this.before(start))
    const gaps: [number, number][] = []
    for (; i < this.segments.length && at < end; i++) {
      const s = this.segments[i]!
      const sEnd = s.start + s.bytes.length
      if (sEnd <= at) continue
      if (s.start >= end) break
      if (s.start > at) gaps.push([at, s.start])
      at = Math.max(at, sEnd)
    }
    if (at < end) gaps.push([at, end])
    for (const [from, to] of gaps) {
      // A copy, so a big piece that arrived whole doesn't keep every view of it alive.
      const part = bytes.subarray(from - start, to - start)
      const segment = { start: from, bytes: part }
      const index = this.before(from) + 1
      this.segments.splice(index, 0, segment)
      this.total += part.length
    }
    this.evict()
  }

  /** The first byte at or after `from` that isn't held (`from` itself when it isn't). */
  contiguousEnd(from: number): number {
    let at = from
    for (let i = Math.max(0, this.before(from)); i < this.segments.length; i++) {
      const s = this.segments[i]!
      const sEnd = s.start + s.bytes.length
      if (s.start > at) break
      if (sEnd > at) at = sEnd
    }
    return at
  }

  /** The held bytes from `position`, up to `length`: shorter when the cache ends first, empty when `position` isn't held. */
  read(position: number, length: number): Uint8Array {
    this.focus = position
    const end = Math.min(this.contiguousEnd(position), position + length)
    if (end <= position) return new Uint8Array(0)
    const first = this.segments[this.before(position)]!
    // The common case, a read inside one segment, copies nothing.
    if (first.start + first.bytes.length >= end) return first.bytes.subarray(position - first.start, end - first.start)
    const out = new Uint8Array(end - position)
    let at = position
    for (let i = this.before(position); i < this.segments.length && at < end; i++) {
      const s = this.segments[i]!
      const from = at - s.start
      const take = Math.min(s.bytes.length - from, end - at)
      out.set(s.bytes.subarray(from, from + take), at - position)
      at += take
    }
    return out
  }

  private evict(): void {
    while (this.total > this.capacity && this.segments.length > 1) {
      // The segment whose nearest byte is furthest from the read position.
      let worst = 0
      let distance = -1
      this.segments.forEach((s, i) => {
        const d = this.focus < s.start ? s.start - this.focus : Math.max(0, this.focus - (s.start + s.bytes.length))
        if (d > distance) (distance = d), (worst = i)
      })
      this.total -= this.segments[worst]!.bytes.length
      this.segments.splice(worst, 1)
    }
  }

  clear(): void {
    this.segments = []
    this.total = 0
  }
}

/** A blocking request for `[start, end)`: fewer bytes only at the end of the file, none past it. Throws when it can't be had. */
export type FetchSync = (start: number, end: number) => Uint8Array

/** How much a read that misses the cache fetches at least: the probe and the index at the end of a file are read in small steps, and each step costs a round trip. */
export const MISS_BYTES = 768 * 1024

/** The engine's view of the file: the cache first, a blocking request for what it lacks. `fetchSync` is null for a server that can't be read in pieces, where only what the reader already brought in can be had. */
export function cachedSource(cache: SegmentCache, length: number | null, fetchSync: FetchSync | null): ByteSource {
  return {
    length,
    read(position, wanted) {
      if (length !== null && position >= length) return new Uint8Array(0)
      const count = length === null ? wanted : Math.min(wanted, length - position)
      const held = cache.read(position, count)
      if (held.length > 0) return held
      if (!fetchSync) throw new Error('This server can’t seek inside the file. Try another source.')
      const end = length === null ? position + Math.max(count, MISS_BYTES) : Math.min(length, position + Math.max(count, MISS_BYTES))
      const got = fetchSync(position, end)
      cache.add(position, got)
      return got.length > count ? got.subarray(0, count) : got
    },
  }
}
