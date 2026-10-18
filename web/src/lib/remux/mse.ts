/* The Media Source side: one SourceBuffer per track, appended one operation at a time, with the
   buffer kept trimmed behind the playhead and recovered when the browser says it's full. All
   state is plain fields; nothing here re-renders anything. */

export type BufferKind = 0 | 1 // 0 video, 1 audio

/** Played data further back than this is dropped, so a long film never fills memory. */
const KEEP_BEHIND = 60
/** What an eviction leaves behind the playhead. */
const TRIM_TO = 30
/** A gap this small between a range and a time counts as contiguous (the first frame sits a few frames after zero). */
const TOLERANCE = 0.3

interface Op {
  epoch: number
  /** Only appends of a replaced stream are dropped; removals still run. */
  droppable: boolean
  run: () => Promise<void>
}

class Slot {
  queue: Op[] = []
  busy = false
  constructor(
    public sb: SourceBuffer,
    public mime: string,
  ) {}
}

type AnyMediaSource = MediaSource & { streaming?: boolean }

const managed = (): (new () => AnyMediaSource) | undefined => (globalThis as { ManagedMediaSource?: new () => AnyMediaSource }).ManagedMediaSource

export function isMediaSourceSupported(): boolean {
  return typeof window !== 'undefined' && ('MediaSource' in window || 'ManagedMediaSource' in window)
}

/** MediaSource.isTypeSupported on whichever implementation will be used. */
export function typeSupported(mime: string): boolean {
  const Source = (managed() ?? (globalThis as { MediaSource?: typeof MediaSource }).MediaSource) as typeof MediaSource | undefined
  try {
    return !!Source?.isTypeSupported(mime)
  } catch {
    return false
  }
}

export interface SinkEvents {
  /** The browser's buffer is full, with this many seconds buffered ahead of the playhead. */
  onPressure(ahead: number): void
  /** Safari's ManagedMediaSource asks to start or stop loading. */
  onStreaming(streaming: boolean): void
  /** Something was appended or removed. */
  onChange(): void
  onError(message: string): void
}

export class MseSink {
  readonly source: AnyMediaSource
  readonly managed: boolean
  private slots: [Slot | null, Slot | null] = [null, null]
  private url = ''
  private destroyed = false
  private ended = false
  /** Start times of video fragments that begin on a keyframe, sorted. */
  private keyframes: number[] = []

  constructor(
    private video: HTMLVideoElement,
    private events: SinkEvents,
  ) {
    const Managed = managed()
    this.managed = !!Managed
    this.source = Managed ? new Managed() : new MediaSource()
    if (this.managed) {
      // Required for ManagedMediaSource: AirPlay would otherwise need a second, separate source.
      video.disableRemotePlayback = true
      this.source.addEventListener('startstreaming', () => events.onStreaming(true))
      this.source.addEventListener('endstreaming', () => events.onStreaming(false))
    }
  }

  /** Attaches to the video element and waits until the browser is ready for source buffers. */
  open(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.source.addEventListener('sourceopen', () => resolve(), { once: true })
      this.url = URL.createObjectURL(this.source)
      this.video.src = this.url
      // A source that never opens (a blocked or unsupported element) shouldn't hang playback forever.
      setTimeout(() => this.source.readyState === 'closed' && !this.destroyed && reject(new Error('This browser couldn’t start the video. Reload the page and try again.')), 10000)
    })
  }

  setDuration(seconds: number) {
    if (this.source.readyState !== 'open' || !(seconds > 0)) return
    try {
      if (!(this.source.duration >= seconds)) this.source.duration = seconds
    } catch {
      // A buffer was updating; the duration will extend itself as data arrives.
    }
  }

  has(kind: BufferKind): boolean {
    return this.slots[kind] !== null
  }

  /** Creates the SourceBuffer for a track. */
  add(kind: BufferKind, mime: string) {
    if (this.destroyed) return
    const sb = this.source.addSourceBuffer(mime)
    // Fragments carry absolute decode times, so they land where they belong whatever order they come in.
    sb.mode = 'segments'
    this.slots[kind] = new Slot(sb, mime)
  }

  /** Empties a track's buffer once its queued work ends, ready for a different codec (switching audio). */
  async empty(kind: BufferKind) {
    const slot = this.slots[kind]
    if (!slot) return
    slot.queue = slot.queue.filter((op) => !op.droppable)
    while (slot.busy) await new Promise((r) => setTimeout(r, 10))
    if (slot.sb.buffered.length) await this.operate(slot, (sb) => sb.remove(0, Infinity)).catch(() => {})
  }

  /** Points an emptied buffer at a new codec. Throws where the browser can't (older Safari), and `rebuild` takes over. */
  retype(kind: BufferKind, mime: string) {
    const slot = this.slots[kind]!
    if (slot.mime === mime) return
    if (typeof slot.sb.changeType !== 'function') throw new TypeError('changeType is unavailable')
    // Per spec this also reopens a stream that has been marked ended.
    slot.sb.changeType(mime)
    slot.mime = mime
    this.ended = false
  }

  /** The slow way to a new codec, for browsers without changeType: a new SourceBuffer. Chrome refuses a second one, but has changeType. Adding one needs an open source, so an ended stream is reopened by appending `reopenWith` first. */
  async rebuild(kind: BufferKind, mime: string, reopenWith: ArrayBuffer | null) {
    const old = this.slots[kind]
    if (old) {
      this.slots[kind] = null
      while (old.busy) await new Promise((r) => setTimeout(r, 10))
    }
    const other = this.slots[kind === 0 ? 1 : 0]
    if (this.source.readyState === 'ended' && other && reopenWith) {
      await this.operate(other, (sb) => sb.appendBuffer(reopenWith))
    }
    if (old) this.source.removeSourceBuffer(old.sb)
    this.ended = false
    this.add(kind, mime)
  }

  /** Queues an append. A stream that's been replaced (its epoch is older than `current()`) never reaches the buffer. */
  append(kind: BufferKind, epoch: number, data: ArrayBuffer, current: () => number): void {
    const slot = this.slots[kind]
    if (!slot) return
    this.ended = false
    this.enqueue(slot, {
      epoch,
      droppable: true,
      run: async () => {
        if (epoch !== current()) return
        await this.appendWithRetry(kind, slot, data, () => epoch !== current())
      },
    })
  }

  /** Forgets queued appends from before `epoch`. */
  flush(epoch: number) {
    for (const slot of this.slots) if (slot) slot.queue = slot.queue.filter((op) => !op.droppable || op.epoch >= epoch)
  }

  private enqueue(slot: Slot, op: Op) {
    slot.queue.push(op)
    if (slot.busy) return
    slot.busy = true
    void this.pump(slot)
  }

  private async pump(slot: Slot) {
    try {
      for (let op = slot.queue.shift(); op; op = slot.queue.shift()) {
        if (this.destroyed) break
        try {
          await op.run()
        } catch (error) {
          if (!this.destroyed) this.events.onError(error instanceof Error && error.name === 'QuotaExceededError' ? 'This browser ran out of room for video. Close other tabs and try again.' : 'This browser couldn’t play the video. Try another source.')
          break
        }
        this.events.onChange()
      }
    } finally {
      slot.busy = false
      if (!this.destroyed && slot.queue.length === 0) this.maybeEnd()
    }
  }

  private operate(slot: Slot, action: (sb: SourceBuffer) => void): Promise<void> {
    return new Promise((resolve, reject) => {
      const sb = slot.sb
      const done = () => (cleanup(), resolve())
      const failed = () => (cleanup(), reject(new Error('The browser rejected the video data.')))
      const cleanup = () => {
        sb.removeEventListener('updateend', done)
        sb.removeEventListener('error', failed)
      }
      sb.addEventListener('updateend', done)
      sb.addEventListener('error', failed)
      try {
        action(sb)
      } catch (error) {
        cleanup()
        reject(error)
      }
    })
  }

  private async appendWithRetry(kind: BufferKind, slot: Slot, data: ArrayBuffer, stale: () => boolean) {
    for (let attempt = 0; ; attempt++) {
      try {
        await this.operate(slot, (sb) => sb.appendBuffer(data))
        return
      } catch (error) {
        if (!(error instanceof DOMException) || error.name !== 'QuotaExceededError' || this.destroyed || stale()) throw error
        // Full: drop what's been played, and wait for playback to free more. While paused there's no hurry, so keep waiting.
        if (attempt === 0) this.events.onPressure(this.aheadOf(slot))
        const freed = await this.trimBehind(kind, slot, attempt < 2 ? this.video.currentTime - TRIM_TO : this.video.currentTime)
        if (!freed) {
          if (attempt > 60 && !this.video.paused) throw error
          await new Promise((r) => setTimeout(r, 400))
        }
      }
    }
  }

  /** Remembers where a keyframe starts. Video can only be trimmed up to one: cutting a picture group in the middle takes the rest of it along. */
  noteKeyframe(time: number) {
    const keys = this.keyframes
    let lo = 0
    let hi = keys.length
    while (lo < hi) {
      const mid = (lo + hi) >> 1
      if (keys[mid]! < time) lo = mid + 1
      else hi = mid
    }
    if (keys[lo] === undefined || Math.abs(keys[lo]! - time) > 0.001) keys.splice(lo, 0, time)
  }

  /** Where trimming toward `until` may stop: that time for audio, the last keyframe at or before it for video. */
  private cutPoint(kind: BufferKind, until: number): number {
    if (kind === 1) return until
    let lo = 0
    let hi = this.keyframes.length
    while (lo < hi) {
      const mid = (lo + hi) >> 1
      if (this.keyframes[mid]! <= until) lo = mid + 1
      else hi = mid
    }
    return lo > 0 ? this.keyframes[lo - 1]! : -1
  }

  private aheadOf(slot: Slot): number {
    const ranges = slot.sb.buffered
    return ranges.length ? Math.max(0, ranges.end(ranges.length - 1) - this.video.currentTime) : 0
  }

  private async trimBehind(kind: BufferKind, slot: Slot, until: number): Promise<boolean> {
    const ranges = slot.sb.buffered
    const cut = this.cutPoint(kind, until)
    if (!ranges.length || ranges.start(0) >= cut - 0.5) return false
    try {
      await this.operate(slot, (sb) => sb.remove(ranges.start(0), cut))
      return true
    } catch {
      return false
    }
  }

  /** Called as the playhead moves: queues a trim when much more than a minute has been played. */
  evict(time: number) {
    for (const kind of [0, 1] as const) {
      const slot = this.slots[kind]
      if (!slot || slot.busy || slot.queue.length) continue
      const ranges = slot.sb.buffered
      if (!ranges.length || time - ranges.start(0) < KEEP_BEHIND) continue
      const cut = this.cutPoint(kind, time - TRIM_TO)
      if (cut <= ranges.start(0)) continue
      this.enqueue(slot, { epoch: 0, droppable: false, run: () => this.operate(slot, (sb) => sb.remove(ranges.start(0), cut)).catch(() => {}) })
      if (kind === 0) this.keyframes = this.keyframes.filter((k) => k >= cut)
    }
  }

  /** The end of the buffered range holding `time`, or null when `time` isn't buffered. */
  contiguousEnd(kind: BufferKind, time: number): number | null {
    const slot = this.slots[kind]
    if (!slot) return null
    try {
      const ranges = slot.sb.buffered
      for (let i = 0; i < ranges.length; i++) {
        if (ranges.start(i) - TOLERANCE <= time && time <= ranges.end(i) + 0.05) return ranges.end(i)
      }
    } catch {
      // The buffer was removed under us.
    }
    return null
  }

  get idle(): boolean {
    return this.slots.every((slot) => !slot || (!slot.busy && slot.queue.length === 0))
  }

  /** Tells the browser the file is complete once everything queued has landed. */
  markComplete() {
    this.complete = true
    this.maybeEnd()
  }

  private complete = false

  /** A new stream is coming (a seek): the file isn't complete from here. */
  reopen() {
    this.complete = false
    this.ended = false
  }

  private maybeEnd() {
    if (!this.complete || this.ended || !this.idle || this.source.readyState !== 'open') return
    this.ended = true
    try {
      this.source.endOfStream()
    } catch {
      // A buffer started updating again; the next change tries once more.
      this.ended = false
    }
  }

  destroy() {
    this.destroyed = true
    for (const slot of this.slots) if (slot) slot.queue = []
    try {
      if (this.source.readyState === 'open') this.source.endOfStream()
    } catch {}
    this.video.removeAttribute('src')
    this.video.load()
    if (this.url) URL.revokeObjectURL(this.url)
  }
}
