/* Matroska in the browser: a Rust/WebAssembly demuxer and fragmented-MP4 muxer in a Web Worker,
   fed by HTTP range requests and played through Media Source Extensions. The player codes against
   this file; the rest of this folder is the machinery.

   const session = await attachMatroska(videoElement, url, { headers, startAt: 120, signal })
   videoElement.play()
   session.audioTracks / session.subtitleTracks   what the file offers (`converted` tracks are decoded in a worker and re-encoded as Opus;
                                                  DTS and TrueHD say playable: false where that isn't possible)
   await session.selectAudio(id)                  rebuilds the audio from the playhead, picture untouched
   const stop = session.onSubtitleCues(id, cues => …)   text cues arrive as the file is read (SRT, ASS, WebVTT)
   await session.seek(seconds)                    or just set video.currentTime: both are handled
   session.onError(message => …)                  mid-playback failures (the initial ones reject attachMatroska)
   session.onAudioFailed(() => …)                 converting the audio failed: the picture plays on without sound
   session.destroy()

   attachMatroska resolves once the first picture is buffered. It rejects with an Error whose message
   is fit to show (UnplayableError when this browser can't decode the picture or any of the sound,
   NotMatroskaError when the file is some other kind, which the browser's own player may take).
   Nothing from this folder loads until an MKV is played: the worker and its WebAssembly module are
   fetched by the first attachMatroska call. */

import type { FromWorker, HeaderInfo, ToWorker } from './protocol'
import { type BufferKind, isMediaSourceSupported, MseSink, typeSupported } from './mse'
import { canConvertAudio } from '../audio/support'
import { parseHeader, type Plan, plan as makePlan, UnplayableError } from './tracks'

export { UnplayableError }

export interface RemuxAudioTrack {
  id: number
  label: string
  language?: string
  codec: string
  channels?: number
  /** False when this browser can't decode it (DTS, TrueHD) and can't convert it either. */
  playable: boolean
  /** Plays after being decoded in WebAssembly and re-encoded as stereo Opus. */
  converted: boolean
  default: boolean
}

export interface RemuxSubtitleTrack {
  id: number
  label: string
  language?: string
  /** Text tracks (SRT, ASS, WebVTT) arrive as cues; image tracks (PGS, VobSub) aren't supported yet. */
  kind: 'text' | 'image'
  default: boolean
  forced: boolean
}

export interface SubtitleCue {
  start: number
  end: number
  text: string
}

export interface RemuxVideoInfo {
  width: number
  height: number
  codec: string
  frameRate?: number
  /** "SDR", "HDR10", "HLG" or "Dolby Vision", as the file declares it. */
  range?: string
}

export interface RemuxSession {
  duration: number
  audioTracks: RemuxAudioTrack[]
  subtitleTracks: RemuxSubtitleTrack[]
  /** The picture, when the file has one. */
  video?: RemuxVideoInfo
  /** The audio track playing now. */
  readonly audioId: number | null
  /** Switches the audio track, keeping the picture where it is. */
  selectAudio(id: number): Promise<void>
  /** Cues for a text subtitle track, delivered as the file is read (and on seek). */
  onSubtitleCues(trackId: number, listener: (cues: SubtitleCue[]) => void): () => void
  /** Jumps to a time: the worker finds the nearest earlier keyframe through the file's index. */
  seek(seconds: number): Promise<void>
  /** Failures after playback began (the connection dropped for good, the browser refused data). */
  onError(listener: (message: string) => void): () => void
  /** The converted audio gave out (the decoder or encoder failed). The picture carries on with no sound
   *  and `audioId` is null; choosing a track that plays as it is brings the sound back. Called at once
   *  when that has already happened. */
  onAudioFailed(listener: () => void): () => void
  destroy(): void
}

export interface RemuxOptions {
  headers?: Record<string, string>
  startAt?: number
  signal?: AbortSignal
}

/** True when this browser has Media Source Extensions (iPhone Safari before iOS 17.1 doesn't). */
export function remuxSupported(): boolean {
  return isMediaSourceSupported()
}

/** Seconds of the buffer a seek must find to count as already loaded. */
const SEEK_MARGIN = 0.5
/** Near the end of a buffered range that the worker isn't extending, it's pointed there. */
const REFILL_WITHIN = 6
const READY_TIMEOUT_MS = 20000

interface Fragment {
  epoch: number
  kind: BufferKind
  data: ArrayBuffer
}

class Session implements RemuxSession {
  private declared = 0
  audioTracks: RemuxAudioTrack[] = []
  subtitleTracks: RemuxSubtitleTrack[] = []
  video?: RemuxVideoInfo
  audioId: number | null = null

  private worker: Worker
  private sink: MseSink
  private plan!: Plan
  private epoch = 1
  private destroyed = false
  private failure: ((error: Error) => void) | null = null
  private errorListeners = new Set<(message: string) => void>()
  private audioFailedListeners = new Set<() => void>()
  private audioFailed = false
  private waiters: { time: number; margin: number; resolve: () => void; timer: ReturnType<typeof setTimeout> }[] = []

  /** Inits seen for this epoch, until the buffers exist. */
  private inits: [{ codec: string; data: ArrayBuffer } | null, { codec: string; data: ArrayBuffer } | null] = [null, null]
  private ready: [boolean, boolean] = [false, false]
  private held: Fragment[] = []
  private initialised = false
  private opening: Promise<void> = Promise.resolve()
  private videoInit: ArrayBuffer | null = null
  /** The kind whose range decides whether a time is buffered. */
  private primary: BufferKind = 0
  /** Where this epoch's fragments begin and end (the worker's reading position), once any have arrived. */
  private began: number | null = null
  private front: number | null = null
  private restartAt = 0
  private eof = false
  private headerReceived!: (info: HeaderInfo) => void
  private firstReady: (() => void) | null = null

  private cues = new Map<number, { list: SubtitleCue[]; seen: Set<string>; listeners: Set<(cues: SubtitleCue[]) => void> }>()
  private cleanups: (() => void)[] = []

  constructor(
    private element: HTMLVideoElement,
    private url: string,
    private options: RemuxOptions,
  ) {
    this.worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' })
    this.sink = new MseSink(element, {
      onPressure: (ahead) => this.send({ type: 'pressure', ahead }),
      onStreaming: (streaming) => this.send({ type: 'hold', hold: !streaming }),
      onChange: () => this.changed(),
      onError: (message) => this.fail(message),
    })
  }

  /** The file's declared length, or what the browser has worked out so far for the rare file that doesn't declare one. */
  get duration(): number {
    return this.declared || (Number.isFinite(this.element.duration) ? this.element.duration : 0)
  }

  private send(message: ToWorker) {
    if (!this.destroyed) this.worker.postMessage(message)
  }

  private fail(message: string, kind: 'blocked' | 'notMatroska' | null = null) {
    if (this.destroyed) return
    if (this.failure) {
      const reject = this.failure
      this.failure = null
      reject(kind === 'blocked' ? new BlockedError(message) : kind === 'notMatroska' ? new NotMatroskaError(message) : new Error(message))
    } else {
      for (const listener of this.errorListeners) listener(message)
    }
  }

  async start(): Promise<Session> {
    const { element: video, options } = this
    // Whichever of these fails first (the worker, the browser, the caller aborting) ends the wait.
    const failed = new Promise<never>((_, reject) => {
      this.failure = reject
    })
    failed.catch(() => {})
    const header = new Promise<HeaderInfo>((resolve) => {
      this.headerReceived = resolve
    })
    const first = new Promise<void>((resolve) => {
      this.firstReady = resolve
    })

    this.worker.onmessage = (event: MessageEvent<FromWorker>) => this.receive(event.data)
    this.worker.onerror = () => this.fail('Flow couldn’t start its video reader. Reload the page and try again.')
    const onAbort = () => (this.failure ? this.failure(new DOMException('Stopped', 'AbortError')) : this.destroy())
    options.signal?.addEventListener('abort', onAbort, { once: true })
    this.cleanups.push(() => options.signal?.removeEventListener('abort', onAbort))
    if (options.signal?.aborted) throw new DOMException('Stopped', 'AbortError')

    this.send({ type: 'open', url: this.url, headers: options.headers ?? {} })
    const opened = this.sink.open()
    opened.catch((error: Error) => this.fail(error.message))
    const info = await Promise.race([header, failed])
    await Promise.race([opened, failed])

    this.plan = makePlan(info, typeSupported, canConvertAudio())
    this.declared = info.duration ?? 0
    this.audioTracks = this.plan.audio.map(({ mime: _mime, ...track }) => track)
    this.subtitleTracks = this.plan.subtitles
    this.audioId = this.plan.defaultAudio
    this.primary = this.plan.video ? 0 : 1
    const track = this.plan.video?.track
    if (track) this.video = { width: track.width ?? 0, height: track.height ?? 0, codec: track.codec, frameRate: track.frameRate, range: track.range }
    this.sink.setDuration(this.declared)

    const at = Math.max(0, options.startAt ?? 0)
    this.restartAt = at
    if (at > 0) video.currentTime = at

    for (const [event, handler] of [
      ['timeupdate', () => this.tick()],
      ['seeking', () => this.ensure(video.currentTime)],
      ['waiting', () => this.tick()],
    ] as const) {
      video.addEventListener(event, handler)
      this.cleanups.push(() => video.removeEventListener(event, handler))
    }

    this.send({ type: 'start', epoch: this.epoch, video: track?.id ?? 0, audio: this.audioId ?? 0, at, convert: this.isConverted(this.audioId) })
    await Promise.race([first, failed])
    this.failure = null
    return this
  }

  // MARK: Messages from the worker

  private receive(message: FromWorker) {
    if (this.destroyed) return
    switch (message.type) {
      case 'header':
        this.headerReceived(parseHeader(message.json))
        return
      case 'error':
        this.fail(message.message, message.blocked ? 'blocked' : message.notMatroska ? 'notMatroska' : null)
        return
      case 'cues':
        this.takeCues(message.cues)
        return
    }
    if (message.epoch !== this.epoch) return
    switch (message.type) {
      case 'audio-failed':
        void this.dropAudio()
        return
      case 'init':
        // Sound that was given up on may still have a message or two on the way.
        if (message.kind === 1 && this.audioId === null) return
        this.inits[message.kind] = { codec: message.codec, data: message.data }
        this.openBuffers()
        return
      case 'fragment': {
        if (message.kind === 1 && this.audioId === null) return
        if (message.kind === 0 && message.key) this.sink.noteKeyframe(message.start)
        if (message.kind === this.primary) {
          this.began ??= message.start
          this.front = Math.max(this.front ?? 0, message.end)
        }
        const fragment = { epoch: message.epoch, kind: message.kind, data: message.data }
        if (this.ready[message.kind]) this.sink.append(message.kind, message.epoch, message.data, () => this.epoch)
        else this.held.push(fragment)
        return
      }
      case 'done':
        this.eof = true
        this.finishIfComplete()
        return
    }
  }

  private isConverted(id: number | null): boolean {
    return this.plan.audio.find((a) => a.id === id)?.converted ?? false
  }

  /** Plays on without sound. A buffer that audio was meant to fill would hold the picture back for ever (a
   *  stream waits until every track has data), so it's removed, and nothing here waits for audio again. */
  private async dropAudio() {
    if (this.destroyed || this.audioId === null) return
    this.audioId = null
    this.audioFailed = true
    this.ready[1] = false
    this.inits[1] = null
    this.held = this.held.filter((f) => f.kind !== 1)
    await this.sink.remove(1)
    if (this.destroyed) return
    for (const listener of this.audioFailedListeners) listener()
    // The picture may have been waiting on the audio's init to open the buffers at all.
    if (!this.initialised) this.openBuffers()
    else this.finishIfComplete()
    this.changed()
  }

  private mimeFor(kind: BufferKind): string | null {
    const slot = this.inits[kind]
    if (!slot) return null
    const mime = `${kind === 0 ? 'video' : 'audio'}/mp4; codecs="${slot.codec}"`
    // The init segment's codec string is the exact one; fall back to the header's if this browser only knows that spelling.
    return typeSupported(mime) ? mime : kind === 0 ? (this.plan.video?.mime ?? mime) : (this.plan.audio.find((a) => a.id === this.audioId)?.mime ?? mime)
  }

  /** Creates SourceBuffers once every track in play has its init segment (all together the first time, so playback never starts with one missing). */
  private openBuffers() {
    this.opening = this.opening.then(async () => {
      const wanted: BufferKind[] = [...(this.plan.video ? [0 as const] : []), ...(this.audioId !== null ? [1 as const] : [])]
      if (this.destroyed || !wanted.every((kind) => this.inits[kind] || this.ready[kind])) return
      try {
        for (const kind of wanted) {
          const init = this.inits[kind]
          if (!init || this.ready[kind]) continue
          const mime = this.mimeFor(kind)!
          if (kind === 0) this.videoInit = init.data
          if (!this.sink.has(kind)) this.sink.add(kind, mime)
          else {
            try {
              this.sink.retype(kind, mime)
            } catch {
              await this.sink.rebuild(kind, mime, this.videoInit)
            }
          }
          this.sink.append(kind, this.epoch, init.data, () => this.epoch)
          this.ready[kind] = true
          this.inits[kind] = null
        }
      } catch {
        this.fail('This browser can’t play this video. Try another source.')
        return
      }
      this.initialised = true
      const held = this.held
      this.held = []
      for (const f of held) if (f.epoch === this.epoch) this.sink.append(f.kind, f.epoch, f.data, () => this.epoch)
      this.finishIfComplete()
    })
  }

  /** Marks the stream complete once the whole file is read and every track has its buffer (ending it while audio is being rebuilt would cut the sound off). */
  private finishIfComplete() {
    const wanted: BufferKind[] = [...(this.plan.video ? [0 as const] : []), ...(this.audioId !== null ? [1 as const] : [])]
    if (this.eof && this.initialised && wanted.every((kind) => this.ready[kind])) this.sink.markComplete()
  }

  private takeCues(raw: { track: number; start: number; end: number; text: string }[]) {
    const touched = new Map<number, SubtitleCue[]>()
    for (const { track, start, end, text } of raw) {
      let entry = this.cues.get(track)
      if (!entry) this.cues.set(track, (entry = { list: [], seen: new Set(), listeners: new Set() }))
      // Reading the same stretch again after a seek sends the same cues; each shows once.
      const key = `${start}|${end}|${text}`
      if (entry.seen.has(key)) continue
      entry.seen.add(key)
      const cue = { start, end, text }
      entry.list.push(cue)
      let batch = touched.get(track)
      if (!batch) touched.set(track, (batch = []))
      batch.push(cue)
    }
    for (const [track, batch] of touched) for (const listener of this.cues.get(track)!.listeners) listener(batch)
  }

  // MARK: The playhead

  /** Everything this session buffers covers `time`, with `margin` seconds to spare (or up to the end of the file). */
  private covered(time: number, margin: number): boolean {
    const kinds: BufferKind[] = [...(this.plan.video ? [0 as const] : []), ...(this.audioId !== null ? [1 as const] : [])]
    if (!kinds.length || !kinds.every((kind) => this.ready[kind])) return false
    return kinds.every((kind) => {
      const end = this.sink.contiguousEnd(kind, time)
      return end !== null && (end >= time + margin || (this.eof && end >= this.duration - 0.5))
    })
  }

  private changed() {
    const video = this.element
    // The first frame sits a few frames after zero; step over that gap rather than waiting for the browser to.
    if (video.readyState < 2 && video.buffered.length && video.buffered.start(0) > video.currentTime && video.buffered.start(0) - video.currentTime < 0.5) {
      video.currentTime = video.buffered.start(0)
    }
    if (this.initialised && this.waiters.length) {
      this.waiters = this.waiters.filter((w) => {
        if (!this.covered(w.time, w.margin)) return true
        clearTimeout(w.timer)
        w.resolve()
        return false
      })
    }
    if (this.firstReady && this.initialised && this.sink.contiguousEnd(this.primary, this.restartAt) !== null) {
      this.firstReady()
      this.firstReady = null
    }
  }

  private whenCovered(time: number, margin = 0.05): Promise<void> {
    if (this.destroyed || this.covered(time, margin)) return Promise.resolve()
    return new Promise((resolve) => {
      // A stream that stalls shouldn't hang the caller: the player's own spinner takes over.
      const timer = setTimeout(() => {
        this.waiters = this.waiters.filter((w) => w.resolve !== resolve)
        resolve()
      }, READY_TIMEOUT_MS)
      this.waiters.push({ time, margin, resolve, timer })
    })
  }

  private tick() {
    const video = this.element
    const time = video.currentTime
    this.send({ type: 'playhead', time })
    this.sink.evict(time)
    // Nearing the end of a buffered stretch that the worker isn't extending (after a seek back into old data): point it there.
    if (!this.eof && this.front !== null) {
      const end = this.sink.contiguousEnd(this.primary, time)
      if (end !== null && end - time < REFILL_WITHIN && Math.abs(this.front - end) > 3) this.restart(end)
    }
  }

  /** Starts a new stream at `at`; everything queued from the old one is dropped. */
  private restart(at: number, extra: { audio?: { track: number; floor: number } } = {}) {
    this.epoch++
    this.sink.flush(this.epoch)
    this.sink.reopen()
    this.held = []
    this.began = this.front = null
    this.restartAt = at
    this.eof = false
    if (extra.audio) this.send({ type: 'audio', epoch: this.epoch, track: extra.audio.track, at, floor: extra.audio.floor, convert: this.isConverted(extra.audio.track) })
    else this.send({ type: 'seek', epoch: this.epoch, at })
  }

  /** Makes sure data for `time` is on its way: a no-op when it's buffered or the worker is about to get there. */
  private ensure(time: number) {
    if (!this.initialised) return
    this.send({ type: 'playhead', time })
    if (this.covered(time, SEEK_MARGIN)) return
    const arriving = this.front === null ? Math.abs(time - this.restartAt) < 2 : this.began !== null && time >= this.began - 0.3 && time <= this.front + 4
    if (arriving && !this.eof) return
    if (this.eof && this.covered(time, 0)) return
    this.restart(time)
  }

  // MARK: RemuxSession

  async seek(seconds: number): Promise<void> {
    const time = Math.min(Math.max(0, seconds), this.duration > 0 ? this.duration : Infinity)
    this.element.currentTime = time
    this.ensure(time)
    await this.whenCovered(time)
  }

  async selectAudio(id: number): Promise<void> {
    const track = this.plan.audio.find((a) => a.id === id)
    if (!track) throw new Error('That audio track isn’t in this file.')
    if (!track.playable) throw new Error('This browser can’t play that audio. Choose another track.')
    if (id === this.audioId) return
    const video = this.element
    const time = video.currentTime
    const floor = this.plan.video ? (this.sink.contiguousEnd(0, time) ?? 0) : 0
    this.audioId = id
    this.audioFailed = false
    this.ready[1] = false
    this.inits[1] = null
    // The old sound goes with its buffer; the picture stays, so there's no flash or re-seek.
    await this.sink.empty(1)
    this.restart(time, { audio: { track: id, floor } })
    await this.whenCovered(time, 0.2)
  }

  onSubtitleCues(trackId: number, listener: (cues: SubtitleCue[]) => void): () => void {
    let entry = this.cues.get(trackId)
    if (!entry) this.cues.set(trackId, (entry = { list: [], seen: new Set(), listeners: new Set() }))
    entry.listeners.add(listener)
    if (entry.list.length) listener(entry.list.slice())
    return () => entry.listeners.delete(listener)
  }

  onError(listener: (message: string) => void): () => void {
    this.errorListeners.add(listener)
    return () => this.errorListeners.delete(listener)
  }

  onAudioFailed(listener: () => void): () => void {
    this.audioFailedListeners.add(listener)
    if (this.audioFailed) queueMicrotask(listener)
    return () => this.audioFailedListeners.delete(listener)
  }

  destroy() {
    if (this.destroyed) return
    this.destroyed = true
    for (const w of this.waiters) (clearTimeout(w.timer), w.resolve())
    this.waiters = []
    for (const cleanup of this.cleanups) cleanup()
    try {
      this.worker.postMessage({ type: 'destroy' } satisfies ToWorker)
    } catch {}
    this.worker.terminate()
    this.sink.destroy()
    this.cues.clear()
    this.errorListeners.clear()
    this.audioFailedListeners.clear()
  }
}

/** The file's host answers but sends no CORS headers, so a page can't read the bytes the remuxer
 *  needs. The browser's own player isn't bound by that, and may still play the file directly. */
export class BlockedError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'BlockedError'
  }
}

/** The file isn't Matroska at all (an MP4, say, or a page the server sent in its place). */
export class NotMatroskaError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'NotMatroskaError'
  }
}

export async function attachMatroska(video: HTMLVideoElement, url: string, options: RemuxOptions = {}): Promise<RemuxSession> {
  if (!remuxSupported()) throw new Error('This browser can’t play this kind of file. Try Safari, Chrome or Firefox, or another source.')
  const session = new Session(video, url, options)
  try {
    return await session.start()
  } catch (error) {
    session.destroy()
    throw error
  }
}
