/* Picture subtitles (Blu-ray PGS, DVD VobSub) as the Rust crate hands them over, and the list the player
   draws from. The crate decodes the discs' own run-length coding to palette indices (picture.rs); here they
   are read off the wire, kept in time order per track, and looked up by the playhead. Drawing is
   `features/player/PictureSubtitles.tsx`. Pure, so it is tested without a browser (pictures.test.ts). */

export interface PictureObject {
  x: number
  y: number
  width: number
  height: number
  /** One palette index per pixel, row by row. */
  indices: Uint8Array
}

export interface PictureCue {
  /** Seconds of media time. */
  start: number
  /** When the next cue or the packet says it stops; null when nothing says (see `SHOWN_FOR`). */
  end: number | null
  /** The canvas the objects' positions refer to (a disc's graphics plane, usually the video's size). */
  canvasWidth: number
  canvasHeight: number
  /** Signs and foreign dialogue: shown even when subtitles are off. */
  forced: boolean
  /** Straight RGBA for each palette index the objects use, four bytes a colour. */
  palette: Uint8Array
  /** Empty: the screen is cleared. */
  objects: PictureObject[]
}

/** How long a picture stays when nothing says when it ends (the native player's figure). */
const SHOWN_FOR = 10

/** Reads what picture.rs `encode` wrote. A cut-off buffer gives the cues that were whole; nothing here throws. */
export function parsePictureCues(buffer: ArrayBuffer | Uint8Array): PictureCue[] {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer)
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const out: PictureCue[] = []
  try {
    if (bytes.length < 4) return out
    const count = view.getUint32(0)
    let at = 4
    for (let i = 0; i < count; i++) {
      const start = view.getFloat64(at)
      const end = view.getFloat64(at + 8)
      const canvasWidth = view.getUint16(at + 16)
      const canvasHeight = view.getUint16(at + 18)
      const forced = view.getUint8(at + 20) !== 0
      const objectCount = view.getUint8(at + 21)
      const colours = view.getUint16(at + 22)
      at += 24
      if (at + colours * 4 > bytes.length) break
      const palette = bytes.slice(at, at + colours * 4)
      at += colours * 4
      const objects: PictureObject[] = []
      let whole = true
      for (let k = 0; k < objectCount; k++) {
        const width = view.getUint16(at + 4)
        const height = view.getUint16(at + 6)
        const size = width * height
        if (at + 8 + size > bytes.length) {
          whole = false
          break
        }
        objects.push({ x: view.getUint16(at), y: view.getUint16(at + 2), width, height, indices: bytes.slice(at + 8, at + 8 + size) })
        at += 8 + size
      }
      if (!whole) break
      out.push({ start, end: Number.isNaN(end) ? null : end, canvasWidth, canvasHeight, forced, palette, objects })
    }
  } catch {
    // A buffer that ends mid-header: what was read stands.
  }
  return out
}

/** The bytes a cue holds, for the memory budget. */
const sizeOf = (cue: PictureCue) => cue.palette.length + cue.objects.reduce((n, o) => n + o.indices.length, 64)

/** One track's cues, in time order, one on screen at a time: each ends, at the latest, where the next begins.
 *  Reading the same stretch again after a seek sends the same cues; each is kept once. Held under a memory
 *  budget by letting go of the ones furthest from the playhead; they come again if the stream is read there. */
export class PictureTrack {
  private cues: PictureCue[] = []
  private bytes = 0

  constructor(private readonly budget = 24 * 1024 * 1024) {}

  get size(): number {
    return this.cues.length
  }

  /** Adds cues (any order), and returns whether the list changed. */
  add(incoming: readonly PictureCue[]): boolean {
    let changed = false
    for (const cue of incoming) {
      const at = this.after(cue.start)
      const previous = this.cues[at - 1]
      if (previous && previous.start === cue.start) continue
      const next = this.cues[at]
      const own: PictureCue = { ...cue, end: next ? Math.min(cue.end ?? next.start, next.start) : cue.end }
      if (previous && (previous.end ?? Infinity) > own.start) this.cues[at - 1] = { ...previous, end: own.start }
      this.cues.splice(at, 0, own)
      this.bytes += sizeOf(own)
      changed = true
    }
    return changed
  }

  /** The cue on screen at `time`, or null: nothing yet, a clear, or past its end. */
  at(time: number): PictureCue | null {
    const cue = this.cues[this.after(time) - 1]
    if (!cue || cue.objects.length === 0) return null
    return time < (cue.end ?? cue.start + SHOWN_FOR) ? cue : null
  }

  /** Lets go of the cues furthest from `time` while over budget. */
  trim(time: number) {
    if (this.bytes <= this.budget) return
    const far = (c: PictureCue) => Math.abs((c.end ?? c.start) - time)
    const order = this.cues.map((c, i) => ({ i, d: far(c) })).sort((a, b) => b.d - a.d)
    const gone = new Set<number>()
    for (const { i } of order) {
      if (this.bytes <= this.budget * 0.75) break
      gone.add(i)
      this.bytes -= sizeOf(this.cues[i]!)
    }
    this.cues = this.cues.filter((_, i) => !gone.has(i))
  }

  /** Index of the first cue that starts after `time`. */
  private after(time: number): number {
    let low = 0
    let high = this.cues.length
    while (low < high) {
      const mid = (low + high) >> 1
      if (this.cues[mid]!.start <= time) low = mid + 1
      else high = mid
    }
    return low
  }
}
