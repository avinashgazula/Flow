/* The pieces of the seek-preview lane that don't need a browser: reading just enough of the file to
   hold one keyframe, remembering the pictures, and sizing them. The worker (worker.ts) wires them to
   the network, the WebAssembly demuxer and WebCodecs. Pure, so they're tested. */

/** The first read for a keyframe: most 1080p keyframes and many 4K ones fit; the rest cost one more request. */
export const FIRST_READ = 512 * 1024
export const MAX_FIRST_READ = 4 * 1024 * 1024
/** A keyframe whose block ends further than this into the cluster isn't worth the bandwidth: the cluster's first one is used. */
export const READ_CAP = 8 * 1024 * 1024
/** Asked for beyond what the demuxer said it needs, because that is a lower bound (it can't know the next element's header). */
const SLACK = 64 * 1024
/** The first request and up to two more that pick up where the last stopped. */
const MAX_REQUESTS = 3
/** Pictures kept, by where they were read. */
export const CACHE_SIZE = 60
/** How wide a preview is drawn, in pixels (a 4K frame is a lot to keep sixty of). */
export const THUMB_WIDTH = 320

/** The size to draw a frame of `width` x `height` (its display size, so anamorphic files come out right): at most
 *  THUMB_WIDTH wide, never enlarged, in whole pixels. */
export function thumbSize(width: number, height: number, max = THUMB_WIDTH): { width: number; height: number } {
  if (!(width > 0) || !(height > 0)) return { width: max, height: Math.round((max * 9) / 16) }
  const w = Math.min(max, Math.round(width))
  return { width: w, height: Math.max(1, Math.round((w * height) / width)) }
}

/** How much to ask for first: enough for the keyframes this file has been giving, so a 4K remux's big ones
 *  don't each cost a second round trip. Stopping the read as soon as the keyframe is whole means asking for
 *  more than needed costs little. */
export function firstRead(typicalKeyframe: number): number {
  return Math.min(MAX_FIRST_READ, Math.max(FIRST_READ, Math.ceil((typicalKeyframe * 1.5) / 65536) * 65536))
}

/** The last `size` things looked up, newest kept. Evicted values are handed to `onEvict` (a bitmap to close). */
export class Lru<V> {
  private map = new Map<string, V>()
  constructor(
    private readonly size: number,
    private readonly onEvict: (value: V) => void = () => {},
  ) {}

  get(key: string): V | undefined {
    const value = this.map.get(key)
    if (value === undefined) return undefined
    this.map.delete(key)
    this.map.set(key, value)
    return value
  }

  set(key: string, value: V) {
    const old = this.map.get(key)
    if (old !== undefined && old !== value) this.onEvict(old)
    this.map.delete(key)
    this.map.set(key, value)
    for (const [k, v] of this.map) {
      if (this.map.size <= this.size) break
      this.map.delete(k)
      this.onEvict(v)
    }
  }

  clear() {
    for (const v of this.map.values()) this.onEvict(v)
    this.map.clear()
  }

  get length() {
    return this.map.size
  }
}

/** What the demuxer said about the bytes so far (see `Remuxer.thumbFind`). */
export type Found = { kind: 'found'; time: number } | { kind: 'more'; need: number } | { kind: 'none' }

export interface KeyframeRead {
  /** Absolute offset the demuxer wants to start from. */
  offset: number
  /** The file's length, or 0 when unknown. */
  length: number
  /** How much to ask for in the first request. */
  first: number
  /** A ranged read: bytes `start` through `end` inclusive. */
  open: (start: number, end: number, signal: AbortSignal) => Promise<Response>
  /** Looks for the keyframe in everything read so far (from `offset`). */
  find: (bytes: Uint8Array) => Found
  signal: AbortSignal
}

export type KeyframeResult =
  /** The keyframe is in the demuxer (`thumbPayload`), at this media time; `bytes` came over the network. */
  | { kind: 'found'; time: number; bytes: number }
  /** The cluster has no keyframe of the picture, or the file ended first. */
  | { kind: 'none' }
  /** The keyframe sits further into the cluster than READ_CAP allows. */
  | { kind: 'toofar'; need: number }

/** Reads from `offset` until the demuxer has a whole keyframe, then stops: the body is cancelled, so what
 *  isn't needed isn't paid for. One request is made for `first` bytes, and when the demuxer says the keyframe
 *  runs past that, the next picks up where the last left off, for what is missing. Bytes go to the demuxer
 *  as they arrive, but only once the last thing it asked for is in, so it isn't asked a hundred times. */
export async function readKeyframe(r: KeyframeRead): Promise<KeyframeResult> {
  const limit = r.length > 0 ? r.length : Infinity
  let buffer = new Uint8Array(Math.min(r.first, 1 << 20))
  let have = 0
  // The demuxer's last word: it needs at least this many bytes from `offset` (always more than there were).
  let need = 0
  for (let requests = 0; requests < MAX_REQUESTS; requests++) {
    const start = r.offset + have
    if (start >= limit) return { kind: 'none' }
    const want = requests === 0 ? r.first : Math.max(need - have, 0) + SLACK
    const res = await r.open(start, Math.min(start + want, limit) - 1, r.signal)
    if (!res.body) return { kind: 'none' }
    const reader = res.body.getReader()
    try {
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        if (have + value.length > buffer.length) {
          const bigger = new Uint8Array(Math.max(buffer.length * 2, have + value.length))
          bigger.set(buffer.subarray(0, have))
          buffer = bigger
        }
        buffer.set(value, have)
        have += value.length
        if (have < need) continue
        const found = r.find(buffer.subarray(0, have))
        if (found.kind === 'found') return { kind: 'found', time: found.time, bytes: have }
        if (found.kind === 'none') return { kind: 'none' }
        need = found.need
        if (need > READ_CAP) return { kind: 'toofar', need }
      }
    } finally {
      // Whatever is left in the body isn't needed.
      reader.cancel().catch(() => {})
    }
  }
  return { kind: 'none' }
}
