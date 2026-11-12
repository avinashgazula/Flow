/// <reference lib="webworker" />
/* The universal engine's worker. It speaks the Matroska worker's protocol (remux/protocol.ts), so the page's
   session code, buffer management and pacing serve both: this one owns the network and the FFmpeg WebAssembly
   module (engine.ts), reads any container, and posts the init segments and fragments of fragmented MP4 for the
   page to append.

   How the file gets to a synchronous reader: the module calls back into JavaScript for every read, and a worker
   can't wait inside a call. So the file is kept in a cache (blocks.ts) that the parallel range reader fills
   ahead of the module's read position; before each step the worker makes sure the cache covers what that step
   can read. A read the cache doesn't have (the probe, an index at the end, a seek) is a blocking request. */

import { cachedSource, SegmentCache } from './blocks'
import { headerFor } from './codecs'
import { type ConvertMode, loadMediaEngine, type MediaFile, UnrecognisedError } from './engine'
import { NoSeekError, RangeHttp, totalLength } from './http'
import { fragmentTimes, readInit, splitSegments } from './mp4'
import { AHEAD_TARGET, aheadCapFor, AheadGovernor, RateMeter } from '../remux/pacing'
import { PieceReader, planReads } from '../remux/reader'
import type { FromWorker, ToWorker } from '../remux/protocol'

const ctx = self as unknown as DedicatedWorkerGlobalScope

/** The first read covers the probe of nearly every file in one round trip. */
const HEAD_BYTES = 4 * 1024 * 1024
/** How much of the file one step of the engine reads. */
const STEP_BYTES = 1024 * 1024
/** The engine's own read buffer, which a step can run into beyond its budget. */
const STEP_SLACK = 128 * 1024
const STATS_EVERY_MS = 1000

let http: RangeHttp
let file: MediaFile | null = null
let cache = new SegmentCache()
let length = 0
let surround = false
let audioOut: 'flac' | 'aac' = 'aac'
let videoIndex = -1
let audioIndex = -1
/** Set when converting the sound failed: it stays off until the page chooses a track again. */
let audioDisabled = false
let convert = false
let sent = { video: false, audio: false }
let timescales: [number, number] = [0, 0]
let bitrate = 0

let run: { ctl: AbortController; done: Promise<void> } | null = null
let playhead = 0
let produced = 0
let hold = false
const governor = new AheadGovernor(AHEAD_TARGET)
const meter = new RateMeter()
let inFlight = 0
let streaming = false
let statsTimer: ReturnType<typeof setInterval> | null = null
let wake: (() => void) | null = null
let thumbsSaid = false

const post = (message: FromWorker, transfer: Transferable[] = []) => ctx.postMessage(message, transfer)

async function report(error: unknown) {
  post(await http.failure(error, (e) => (e instanceof UnrecognisedError ? { type: 'error', message: e.message, notMatroska: true } : null)))
}

async function open(message: Extract<ToWorker, { type: 'open' }>) {
  http = new RangeHttp(message.url, message.headers, message.viaProxy, ctx.location.origin)
  surround = message.surround === true
  audioOut = message.audioOut ?? 'aac'
  const loading = loadMediaEngine()
  loading.catch(() => {})
  const res = await http.request(0, HEAD_BYTES - 1)
  length = totalLength(res)
  if (!res.body) throw new Error('This browser can’t stream the file.')
  // A server without ranges sends the whole file: keep what the probe needs and drop the rest.
  const reader = res.body.getReader()
  const parts: Uint8Array[] = []
  let have = 0
  while (have < HEAD_BYTES) {
    const { done, value } = await reader.read()
    if (done) break
    parts.push(value)
    have += value.length
  }
  reader.cancel().catch(() => {})
  const head = new Uint8Array(Math.min(have, HEAD_BYTES))
  let at = 0
  for (const part of parts) {
    const take = part.subarray(0, head.length - at)
    head.set(take, at)
    at += take.length
    if (at >= head.length) break
  }
  cache.add(0, head)
  const engine = await loading
  // Everything the module reads that isn't in the cache is fetched on the spot; without ranges only the head is available.
  const source = cachedSource(cache, length > 0 ? length : null, http.ranges ? (s, e) => http.readSync(s, e) : null)
  file = engine.open(source)
  const info = headerFor(file.streams, file.durationMs)
  bitrate = length && file.durationMs ? length / (file.durationMs / 1000) : 0
  governor.reset(aheadCapFor(bitrate))
  statsTimer ??= setInterval(postStats, STATS_EVERY_MS)
  post({ type: 'header', json: JSON.stringify(info), length, ranges: http.ranges, cached: false })
  if (file.chapters.length) post({ type: 'chapters', chapters: file.chapters.map((c) => ({ title: c.title, start: Math.round(c.start) / 1000 })) })
}

// MARK: Streaming

/** Posts what the engine has produced: init segments (once, unless the page asked for them again) and each fragment with where it sits. */
function drain(epoch: number) {
  const f = file!
  for (const chunk of f.take()) {
    const { init, fragments } = splitSegments(chunk.data)
    const kind = chunk.kind
    if (init) {
      const track = readInit(init)
      if (track) timescales[kind] = track.timescale
      if (!sent[kind === 0 ? 'video' : 'audio']) {
        sent[kind === 0 ? 'video' : 'audio'] = true
        const copy = init.slice().buffer as ArrayBuffer
        post({ type: 'init', epoch, kind, codec: track?.codec ?? '', data: copy }, [copy])
      }
    }
    for (const fragment of fragments) {
      const times = timescales[kind] ? fragmentTimes(fragment, timescales[kind]) : null
      if (!times) continue
      const data = fragment.slice().buffer as ArrayBuffer
      post({ type: 'fragment', epoch, kind, start: times.start, end: times.end, key: times.key, data }, [data])
      if (kind === (videoIndex >= 0 ? 0 : 1)) produced = Math.max(produced, times.end)
    }
  }
}

function postStats() {
  if (!streaming) return
  post({ type: 'stats', bytesPerSecond: Math.round(meter.rate(performance.now())), bitrate: Math.round(bitrate), inFlight, ahead: Math.max(0, Math.round((produced - playhead) * 10) / 10) })
}

/** Backpressure: stops reading while enough is buffered ahead of the playhead. */
async function throttle(signal: AbortSignal) {
  while (!signal.aborted && (hold || produced - playhead > governor.value(performance.now()))) {
    await new Promise<void>((resolve) => {
      wake = resolve
    })
  }
  if (signal.aborted) throw new DOMException('Stopped', 'AbortError')
}

const sleep = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, ms)
    signal.addEventListener('abort', () => (clearTimeout(timer), resolve()), { once: true })
  })

/** Reads the file ahead of the engine's position into the cache, restarting where the engine has jumped to. */
class Feeder {
  private reader: PieceReader | null = null
  private at = 0
  private done = false

  constructor(private readonly signal: AbortSignal) {}

  /** Makes sure the cache covers `[position, position + wanted)`, or the end of the file. */
  async cover(position: number, wanted: number) {
    const target = length > 0 ? Math.min(length, position + wanted) : position + wanted
    for (;;) {
      const have = cache.contiguousEnd(position)
      if (have >= target || (length > 0 && have >= length)) return
      // The engine moved somewhere the reader isn't going: start again from the first byte that is missing.
      if (!this.reader || this.at !== have || this.done) {
        this.reader?.close()
        this.done = false
        this.at = have
        const bounded = http.ranges && length > 0
        this.reader = new PieceReader({
          from: have,
          length,
          bounded,
          ...planReads({ viaProxy: http.viaProxy, bitrate, bounded }),
          open: (start, end, piece) => (!http.ranges && start > 0 ? Promise.reject(new NoSeekError(http.noSeek)) : http.request(start, end, piece)),
          classify: http.classify,
          sleep,
          onBytes: (n) => meter.add(n, performance.now()),
          onActive: (n) => {
            inFlight = n
            meter.setActive(n > 0, performance.now())
          },
          signal: this.signal,
        })
      }
      const value = await this.reader.next()
      if (!value) {
        this.done = true
        // The end of the file as the server sees it, when the length wasn't known.
        if (length <= 0) length = this.at
        return
      }
      cache.add(this.at, value)
      this.at += value.length
    }
  }

  close() {
    this.reader?.close()
  }
}

async function stream(epoch: number, signal: AbortSignal) {
  const f = file!
  streaming = true
  const feeder = new Feeder(signal)
  try {
    for (;;) {
      await throttle(signal)
      await feeder.cover(f.info().bytes, STEP_BYTES + STEP_SLACK)
      if (signal.aborted) return
      const { done } = f.step(STEP_BYTES)
      drain(epoch)
      if (f.info().audioFailed && !audioDisabled) {
        audioDisabled = true
        post({ type: 'audio-failed', epoch, message: 'This browser can’t convert that audio.' })
      }
      if (done) break
      // Let messages (a seek, the playhead) in between steps.
      await new Promise<void>((resolve) => setTimeout(resolve, 0))
    }
  } catch (error) {
    if (signal.aborted) return
    throw error
  } finally {
    feeder.close()
  }
  if (signal.aborted) return
  streaming = false
  post({ type: 'done', epoch })
}

/** Stops whatever is reading and starts a new run from `at` (media seconds). `inits`: which init segments the page needs again. */
async function begin(epoch: number, at: number, floor = 0, inits: 'all' | 'audio' | null = null) {
  run?.ctl.abort()
  wake?.()
  await run?.done
  if (inits === 'all') sent = { video: false, audio: false }
  else if (inits === 'audio') sent.audio = false
  const ctl = new AbortController()
  ctl.signal.addEventListener('abort', () => wake?.(), { once: true })
  const task = (async () => {
    const f = file!
    const mode: ConvertMode = audioIndex >= 0 && convert ? audioOut : 'copy'
    f.start({ video: videoIndex, audio: audioDisabled ? -1 : audioIndex, mode, surround, atMs: Math.round(at * 1000), floorMs: Math.round(floor * 1000) })
    produced = at
    await stream(epoch, ctl.signal)
  })().catch((error) => {
    if (ctl.signal.aborted) return
    streaming = false
    void report(error)
  })
  run = { ctl, done: task }
}

/** The page numbers streams by their index; an id that isn't the kind of stream wanted means there isn't one (an audio-only file's "video 0"). */
function pick(id: number, type: 'video' | 'audio'): number {
  return file?.streams[id]?.type === type ? id : -1
}

let chain: Promise<void> = Promise.resolve()

ctx.onmessage = (event: MessageEvent<ToWorker>) => {
  const message = event.data
  switch (message.type) {
    case 'playhead':
      playhead = message.time
      wake?.()
      return
    case 'hold':
      hold = message.hold
      wake?.()
      return
    case 'pressure':
      governor.pressure(message.ahead, performance.now())
      return
    case 'thumb':
      // Pictures for the scrubber need to decode video, which this engine doesn't: the scrubber shows the time alone.
      if (!thumbsSaid) {
        thumbsSaid = true
        post({ type: 'thumbs-unsupported', reason: 'This file’s picture can’t be previewed.' })
      }
      post({ type: 'thumb-none', id: message.id, why: 'failed' })
      return
    case 'picture':
      return
    case 'destroy':
      run?.ctl.abort()
      wake?.()
      if (statsTimer) clearInterval(statsTimer)
      statsTimer = null
      // The step that is running (if any) ends first; closing the engine under it would trap.
      void (run?.done ?? Promise.resolve()).then(() => {
        try {
          file?.close()
        } catch {}
        file = null
        cache.clear()
        ctx.close()
      })
      return
  }
  chain = chain
    .then(async () => {
      switch (message.type) {
        case 'open':
          await open(message)
          break
        case 'start':
          videoIndex = pick(message.video, 'video')
          audioIndex = pick(message.audio, 'audio')
          convert = message.convert
          audioDisabled = false
          playhead = message.at
          await begin(message.epoch, message.at, 0, 'all')
          break
        case 'seek':
          playhead = message.at
          await begin(message.epoch, message.at)
          break
        case 'audio':
          audioIndex = pick(message.track, 'audio')
          convert = message.convert
          audioDisabled = false
          await begin(message.epoch, message.at, message.floor, 'audio')
          break
      }
    })
    .catch((error) => void report(error))
}

