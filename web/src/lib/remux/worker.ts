/// <reference lib="webworker" />
/* The remux worker: owns the network and the WebAssembly demuxer, so neither fetching nor parsing
   ever touches the page's main thread. It reads the header, then the seek index, then streams
   clusters in range requests and posts fragmented-MP4 fragments for the main thread to append. */

import init, { Remuxer } from './pkg/flow_remux.js'
import type { FromWorker, RawCue, ToWorker } from './protocol'

const ctx = self as unknown as DedicatedWorkerGlobalScope

/** The first read covers the EBML header, tracks and (usually) the SeekHead in one round trip. */
const HEAD_BYTES = 512 * 1024
const FIRST_CHUNK = 1024 * 1024
const CHUNK = 4 * 1024 * 1024
/** Seconds of media to keep buffered ahead of the playhead; lowered for very high bitrates and under memory pressure. */
const AHEAD_MAX = 60
const AHEAD_MIN = 8
const AHEAD_BUDGET_BYTES = 96 * 1024 * 1024

let url = ''
let headers: Record<string, string> = {}
let remuxer: Remuxer | null = null
let length = 0
let ranges = true
let head = new Uint8Array(0)

let videoTrack = 0
let audioTrack = 0
let sent = { video: false, audio: false }
let cuesReady: Promise<void> = Promise.resolve()

let run: { ctl: AbortController; done: Promise<void> } | null = null
let playhead = 0
let produced = 0
let hold = false
let ahead = AHEAD_MAX
let aheadCap = AHEAD_MAX
let wake: (() => void) | null = null

const post = (message: FromWorker, transfer: Transferable[] = []) => ctx.postMessage(message, transfer)

class HttpError extends Error {
  constructor(readonly status: number) {
    super(`The server answered ${status}`)
  }
}

function friendly(error: unknown): string {
  if (error instanceof HttpError) {
    if (error.status === 401 || error.status === 403) return 'The server refused the request. Check the sign-in for this source.'
    if (error.status === 404) return 'The server doesn’t have this file any more. Try another source.'
    return `The server answered ${error.status}. Try again, or try another source.`
  }
  if (error instanceof WebAssembly.RuntimeError) return 'Flow couldn’t read this file. Try another source.'
  if (error instanceof TypeError) return 'Couldn’t reach the server. Check the connection and try again.'
  return error instanceof Error ? error.message : String(error)
}

async function request(start: number, end: number | null, signal?: AbortSignal): Promise<Response> {
  const h = new Headers(headers)
  h.set('Range', `bytes=${start}-${end ?? ''}`)
  const res = await fetch(url, { headers: h, signal })
  if (res.status === 206) return res
  // A server that ignores Range sends the whole file with 200: usable only from the start.
  if (res.status === 200 && start === 0) {
    ranges = false
    return res
  }
  if (res.status === 200) {
    res.body?.cancel().catch(() => {})
    ranges = false
    throw new Error('This server can’t seek inside the file. Try another source.')
  }
  res.body?.cancel().catch(() => {})
  throw new HttpError(res.status)
}

/** Reads `[offset, offset+len)` fully (the header and index reads; the first bytes come from the prefetch). */
async function readRange(offset: number, len: number): Promise<Uint8Array> {
  const end = Math.min(offset + len, length)
  if (end <= offset) return new Uint8Array(0)
  if (end <= head.length) return head.subarray(offset, end)
  const res = await request(offset, end - 1)
  const bytes = new Uint8Array(await res.arrayBuffer())
  return bytes.length > end - offset ? bytes.subarray(0, end - offset) : bytes
}

function totalLength(res: Response): number {
  const range = res.headers.get('Content-Range')
  const total = range?.match(/\/(\d+)$/)?.[1]
  if (total) return Number(total)
  return Number(res.headers.get('Content-Length') ?? 0)
}

async function open(message: Extract<ToWorker, { type: 'open' }>) {
  url = message.url
  headers = message.headers
  await init()
  const res = await request(0, HEAD_BYTES - 1)
  length = totalLength(res)
  if (!res.body) throw new Error('This browser can’t stream the file.')
  // A server without ranges sends the whole file: keep what the header needs and drop the rest.
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
  head = new Uint8Array(Math.min(have, HEAD_BYTES))
  let at = 0
  for (const part of parts) {
    const take = part.subarray(0, head.length - at)
    head.set(take, at)
    at += take.length
    if (at >= head.length) break
  }

  const rem = new Remuxer(length)
  remuxer = rem
  for (let need = rem.headerNeed(); need.length; need = rem.headerNeed()) {
    rem.headerFeed(need[0]!, await readRange(need[0]!, need[1]!))
  }
  const error = rem.headerError()
  if (error) throw new Error(error)

  const bytesPerSecond = (() => {
    const info = JSON.parse(rem.headerJson()) as { duration: number | null }
    return length && info.duration ? length / info.duration : 0
  })()
  if (bytesPerSecond) aheadCap = Math.min(AHEAD_MAX, Math.max(AHEAD_MIN, Math.floor(AHEAD_BUDGET_BYTES / bytesPerSecond)))
  ahead = aheadCap

  // The index is often at the end of the file. Streaming doesn't wait for it; seeking does.
  cuesReady = (async () => {
    for (let need = rem.cuesNeed(); need.length; ) {
      need = rem.cuesFeed(need[0]!, await readRange(need[0]!, need[1]!))
    }
  })().catch(() => {})

  post({ type: 'header', json: rem.headerJson(), length, ranges })
}

// MARK: Streaming

function sendInits(epoch: number) {
  const rem = remuxer!
  if (!sent.video && videoTrack) {
    const data = rem.initSegment(videoTrack)
    if (data) {
      sent.video = true
      post({ type: 'init', epoch, kind: 0, codec: rem.codecString(), data: data.buffer as ArrayBuffer }, [data.buffer as ArrayBuffer])
    }
  }
  if (!sent.audio && audioTrack) {
    const data = rem.initSegment(audioTrack)
    if (data) {
      sent.audio = true
      post({ type: 'init', epoch, kind: 1, codec: rem.codecString(), data: data.buffer as ArrayBuffer }, [data.buffer as ArrayBuffer])
    }
  }
}

function drain(epoch: number) {
  const rem = remuxer!
  sendInits(epoch)
  for (let data = rem.nextFragment(); data; data = rem.nextFragment()) {
    const kind = rem.fragmentKind() as 0 | 1
    const end = rem.fragmentEnd()
    post({ type: 'fragment', epoch, kind, start: rem.fragmentStart(), end, key: rem.fragmentKey(), data: data.buffer as ArrayBuffer }, [data.buffer as ArrayBuffer])
    if (kind === (videoTrack ? 0 : 1)) produced = Math.max(produced, end)
  }
  const cues = rem.takeCues()
  if (cues) post({ type: 'cues', cues: JSON.parse(cues) as RawCue[] })
}

/** Backpressure: stops reading while enough is buffered ahead of the playhead. Reading less lets TCP slow the server down too. */
async function throttle(signal: AbortSignal) {
  while (!signal.aborted && (hold || produced - playhead > ahead)) {
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

async function stream(from: number, epoch: number, signal: AbortSignal) {
  const rem = remuxer!
  // Without a known length (or a server that ignores Range) the file is one open-ended request.
  const bounded = ranges && length > 0
  let pos = from
  let first = true
  let failures = 0
  let next: { start: number; response: Promise<Response> } | null = null

  const openChunk = (start: number, size: number) => {
    if (!ranges && start > 0) return Promise.reject(new Error('This server can’t seek inside the file. Try another source.'))
    return request(start, bounded ? Math.min(start + size, length) - 1 : null, signal)
  }
  const dropNext = () => {
    next?.response.then((res) => res.body?.cancel(), () => {}).catch(() => {})
    next = null
  }

  while (!bounded || pos < length) {
    const size = first ? FIRST_CHUNK : CHUNK
    const start = pos
    try {
      let response: Promise<Response>
      if (next && next.start === start) {
        response = next.response
        next = null
      } else {
        dropNext()
        response = openChunk(start, size)
      }
      const res: Response = await response
      const end: number = bounded ? Math.min(start + size, length) : Infinity
      const reader = res.body!.getReader()
      let prefetched = false
      let got = 0
      try {
        for (;;) {
          await throttle(signal)
          const { done, value } = await reader.read()
          if (done) break
          rem.push(value)
          pos += value.length
          got += value.length
          failures = 0
          drain(epoch)
          // Ask for the next chunk before this one ends, so the server's round trip hides behind the last megabyte.
          if (!prefetched && bounded && end < length && pos - start > size / 2) {
            prefetched = true
            const response = openChunk(end, CHUNK)
            response.catch(() => {})
            next = { start: end, response }
          }
        }
      } finally {
        reader.cancel().catch(() => {})
      }
      first = false
      if (!bounded) break
      if (got === 0 && ++failures > 4) throw new Error('The server stopped sending data. Try again.')
    } catch (error) {
      dropNext()
      if (signal.aborted) return
      if (error instanceof HttpError && error.status === 416) break
      // A dropped connection resumes from the last byte received.
      if ((error instanceof HttpError && error.status < 500) || ++failures > 4) throw error
      await sleep(400 * failures, signal)
    }
  }
  dropNext()
  if (signal.aborted) return
  rem.finish()
  drain(epoch)
  post({ type: 'done', epoch })
}

/** Stops whatever is reading and starts a new run; the previous one has fully stopped before the next touches the remuxer. */
async function begin(epoch: number, at: number, floor = 0, resetInits = false) {
  run?.ctl.abort()
  wake?.()
  await run?.done
  const rem = remuxer!
  const ctl = new AbortController()
  ctl.signal.addEventListener('abort', () => wake?.(), { once: true })
  const task = (async () => {
    let offset: number
    let aligned = true
    if (at > 0.05) {
      await cuesReady
      const target = rem.seekTarget(at)
      offset = target[0]!
      aligned = target[2] === 1
    } else {
      offset = rem.firstCluster()
    }
    if (ctl.signal.aborted) return
    rem.reset(offset, aligned)
    if (floor > 0) rem.setVideoFloor(floor)
    if (resetInits) sent = { video: false, audio: false }
    produced = at
    await stream(offset, epoch, ctl.signal)
  })().catch((error) => {
    if (!ctl.signal.aborted) post({ type: 'error', message: friendly(error) })
  })
  run = { ctl, done: task }
}

// MARK: Commands

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
      ahead = Math.max(AHEAD_MIN, Math.min(ahead, Math.floor(message.ahead * 0.8)))
      return
    case 'destroy':
      run?.ctl.abort()
      wake?.()
      try {
        remuxer?.free()
      } catch {}
      remuxer = null
      ctx.close()
      return
  }
  chain = chain
    .then(async () => {
      switch (message.type) {
        case 'open':
          await open(message)
          break
        case 'start':
          videoTrack = message.video
          audioTrack = message.audio
          remuxer!.select(message.video, message.audio)
          playhead = message.at
          await begin(message.epoch, message.at, 0, true)
          break
        case 'seek':
          playhead = message.at
          ahead = aheadCap
          await begin(message.epoch, message.at)
          break
        case 'audio':
          audioTrack = message.track
          remuxer!.select(videoTrack, message.track)
          sent.audio = false
          await begin(message.epoch, message.at, message.floor)
          break
      }
    })
    .catch((error) => post({ type: 'error', message: friendly(error) }))
}
