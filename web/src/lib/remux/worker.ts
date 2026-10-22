/// <reference lib="webworker" />
/* The remux worker: owns the network and the WebAssembly demuxer, so neither fetching nor parsing
   ever touches the page's main thread. It reads the header, then the seek index, then streams
   clusters in range requests and posts fragmented-MP4 fragments for the main thread to append. */

import init, { Remuxer } from './pkg/flow_remux.js'
import type { AudioCodec } from '../audio/decoder'
import type { AudioConverter } from './convert'
import { cleanDetail, DETAIL_BYTES, detailWanted, httpFailureMessage, networkFailureMessage, PROXY_DIRECT_HEADER, PROXY_HOPS_HEADER } from './failure'
import { AHEAD_TARGET, aheadCapFor, AheadGovernor, RateMeter } from './pacing'
import type { FromWorker, HeaderInfo, RawCue, ToWorker } from './protocol'
import { PieceReader, planReads } from './reader'

const ctx = self as unknown as DedicatedWorkerGlobalScope

/** The first read covers the EBML header, tracks and (usually) the SeekHead in one round trip. */
const HEAD_BYTES = 512 * 1024
/** How often the page is told how the network is doing. */
const STATS_EVERY_MS = 1000

let url = ''
/** The address Flow was given. `url` may move on from it to where its redirect led (see request()). */
let given = ''
let headers: Record<string, string> = {}
/** The address is the stream proxy's, so a failure is the proxy's to explain. */
let viaProxy = false
let remuxer: Remuxer | null = null
let length = 0
let ranges = true
/** What to say when a read further in is impossible: set by the answer that showed it. */
let noSeek = 'This server can’t seek inside the file. Try another source.'
let head = new Uint8Array(0)

let videoTrack = 0
let audioTrack = 0
let sent = { video: false, audio: false }
/** What each audio track needs to be decoded in the worker, from the header (absent: nothing the decoders take). */
let decodes = new Map<number, AudioCodec>()
/** The codec of the audio track being converted, or null while the audio plays as it is. */
let convertCodec: AudioCodec | null = null
/** Loaded the first time a track is converted: the decoder's WebAssembly comes with it. */
let converter: AudioConverter | null = null
let cuesReady: Promise<void> = Promise.resolve()

let run: { ctl: AbortController; done: Promise<void> } | null = null
let playhead = 0
let produced = 0
let hold = false
/** How far ahead of the playhead to read: the budget at the file's bitrate, lowered when the browser's buffer fills (see pacing.ts). */
const governor = new AheadGovernor(AHEAD_TARGET)
/** The file's average bytes per second, 0 when its length or duration is unknown. */
let bitrate = 0
const meter = new RateMeter()
let inFlight = 0
/** A file is being read, so the page hears how fast. */
let streaming = false
let statsTimer: ReturnType<typeof setInterval> | null = null
let wake: (() => void) | null = null

const post = (message: FromWorker, transfer: Transferable[] = []) => ctx.postMessage(message, transfer)

/** What the remuxer says about a file that isn't Matroska at all (an MP4, a web page the server sent instead). */
const NOT_MATROSKA = "This isn't a Matroska file."
class NotMatroskaError extends Error {}
/** The server answered a range with the whole file, so nothing but the start can be read. */
class NoSeekError extends Error {}

class HttpError extends Error {
  constructor(
    readonly status: number,
    /** What the answer said, when it was short text (the proxy says which host refused and why). */
    readonly detail?: string,
    /** The hosts the proxy asked, with the status each gave. */
    readonly hops?: string,
  ) {
    super(`The server answered ${status}`)
  }
}

/** The answer's own words, read from the start of a short text or JSON body and cleaned. */
async function readDetail(res: Response): Promise<string | undefined> {
  if (!res.body || !detailWanted(res.headers.get('Content-Type'))) return undefined
  try {
    const reader = res.body.getReader()
    const parts: Uint8Array[] = []
    let have = 0
    while (have < DETAIL_BYTES) {
      const { done, value } = await reader.read()
      if (done) break
      parts.push(value)
      have += value.length
    }
    reader.cancel().catch(() => {})
    const bytes = new Uint8Array(have)
    let at = 0
    for (const part of parts) (bytes.set(part, at), (at += part.length))
    return cleanDetail(new TextDecoder().decode(bytes.subarray(0, DETAIL_BYTES)))
  } catch {
    return undefined
  }
}

/** Posts a failure. fetch() hides why it failed, so a TypeError gets one more question: a host that
 *  answers a no-cors request is up, it just doesn't let web pages read its files (no CORS headers,
 *  as with most debrid download servers). That needs a different fix from a dropped connection.
 *  When the address is the stream proxy's, the same question tells a proxy that isn't there from
 *  one the browser won't let this page read (its ALLOWED_ORIGINS), and neither is `blocked`:
 *  the proxy is what blocked would send the page to. */
async function report(error: unknown) {
  if (error instanceof NotMatroskaError) {
    post({ type: 'error', message: error.message, notMatroska: true })
    return
  }
  if (error instanceof TypeError && !(error instanceof HttpError)) {
    const reachable = await fetch(url, { method: 'HEAD', mode: 'no-cors', cache: 'no-store' }).then(
      () => true,
      () => false,
    )
    if (viaProxy) {
      post({ type: 'error', message: networkFailureMessage(true, reachable, ctx.location.origin) })
      return
    }
    if (reachable) {
      post({ type: 'error', blocked: true, message: 'This file’s host doesn’t let web pages stream from it.' })
      return
    }
  }
  post({ type: 'error', message: friendly(error) })
}

function friendly(error: unknown): string {
  if (error instanceof HttpError) return httpFailureMessage(error, viaProxy)
  if (error instanceof WebAssembly.RuntimeError) return 'Flow couldn’t read this file. Try another source.'
  if (error instanceof TypeError) return networkFailureMessage(viaProxy, false)
  return error instanceof Error ? error.message : String(error)
}

async function request(start: number, end: number | null, signal?: AbortSignal): Promise<Response> {
  const h = new Headers(headers)
  h.set('Range', `bytes=${start}-${end ?? ''}`)
  let res = await fetch(url, { headers: h, signal })
  // The redirect's target can expire or be refused before the play link does: back to the play link once.
  if (url !== given && res.status >= 400) {
    res.body?.cancel().catch(() => {})
    url = given
    res = await fetch(url, { headers: h, signal })
  }
  // An add-on's play link can look the file up again on every request, which costs each piece a
  // round trip or two before any bytes. The proxy says where the link led, and later pieces go there.
  const direct = viaProxy ? res.headers.get(PROXY_DIRECT_HEADER) : null
  if (direct && url === given && sameOrigin(direct, given)) url = direct
  if (res.status === 206) return res
  // A server that ignores Range sends the whole file with 200: usable only from the start.
  if (res.status === 200 && start === 0) {
    ranges = false
    return res
  }
  if (res.status === 200) {
    res.body?.cancel().catch(() => {})
    ranges = false
    // Through the stream proxy, which hosts answered says where the range was dropped.
    const hops = res.headers.get(PROXY_HOPS_HEADER)
    noSeek = `This server can’t seek inside the file. Try another source.${hops ? ` Hosts asked: ${hops}.` : ''}`
    throw new NoSeekError(noSeek)
  }
  const detail = await readDetail(res)
  res.body?.cancel().catch(() => {})
  throw new HttpError(res.status, detail, res.headers.get(PROXY_HOPS_HEADER) ?? undefined)
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

const sameOrigin = (a: string, b: string) => {
  try {
    return new URL(a).origin === new URL(b).origin
  } catch {
    return false
  }
}

async function open(message: Extract<ToWorker, { type: 'open' }>) {
  url = message.url
  given = message.url
  headers = message.headers
  viaProxy = message.viaProxy
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
  if (error) throw error === NOT_MATROSKA ? new NotMatroskaError(error) : new Error(error)
  for (const track of (JSON.parse(rem.headerJson()) as HeaderInfo).tracks) if (track.decode) decodes.set(track.id, track.decode)

  const info = JSON.parse(rem.headerJson()) as { duration: number | null }
  bitrate = length && info.duration ? length / info.duration : 0
  governor.reset(aheadCapFor(bitrate))
  statsTimer ??= setInterval(postStats, STATS_EVERY_MS)

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

async function drain(epoch: number) {
  const rem = remuxer!
  sendInits(epoch)
  for (let data = rem.nextFragment(); data; data = rem.nextFragment()) {
    const kind = rem.fragmentKind()
    const end = rem.fragmentEnd()
    if (kind === 2) {
      // Raw audio for the converter. With none working (it failed, or never loaded) the frames are dropped and the picture plays on.
      if (converter?.working) await converter.feed(rem.fragmentStart(), data)
      if (!videoTrack) produced = Math.max(produced, end)
      continue
    }
    post({ type: 'fragment', epoch, kind: kind as 0 | 1, start: rem.fragmentStart(), end, key: rem.fragmentKey(), data: data.buffer as ArrayBuffer }, [data.buffer as ArrayBuffer])
    if (kind === (videoTrack ? 0 : 1)) produced = Math.max(produced, end)
  }
  const cues = rem.takeCues()
  if (cues) post({ type: 'cues', cues: JSON.parse(cues) as RawCue[] })
}

const converterHost = {
  initNeeded: () => !sent.audio,
  init(epoch: number, data: ArrayBuffer) {
    sent.audio = true
    post({ type: 'init', epoch, kind: 1, codec: 'opus', data }, [data])
  },
  fragment(epoch: number, start: number, end: number, data: ArrayBuffer) {
    post({ type: 'fragment', epoch, kind: 1, start, end, key: true, data }, [data])
    // Audio-only files are paced by their sound.
    if (!videoTrack) produced = Math.max(produced, end)
  },
  failed(epoch: number, message: string) {
    post({ type: 'audio-failed', epoch, message })
  },
}

/** Opens the converter for the track about to play. A converter that can't be loaded is the same failure as one that crashes. */
async function useConverter(epoch: number) {
  if (!convertCodec) return
  try {
    if (!converter) {
      const { AudioConverter } = await import('./convert')
      converter = new AudioConverter(converterHost)
    }
  } catch (error) {
    converter = null
    return void post({ type: 'audio-failed', epoch, message: error instanceof Error ? error.message : String(error) })
  }
  void converter.use(convertCodec, epoch)
}

function postStats() {
  if (!streaming) return
  post({ type: 'stats', bytesPerSecond: Math.round(meter.rate(performance.now())), bitrate: Math.round(bitrate), inFlight, ahead: Math.max(0, Math.round((produced - playhead) * 10) / 10) })
}

/** Backpressure: stops reading while enough is buffered ahead of the playhead. Pieces already on their way finish
 *  and wait, so at most a few are held (see reader.ts), and no new ones start. */
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

/** What a failed read means to the reader: a 416 is the file's end, a refusal or a server that can't seek won't improve, the rest may. */
function classify(error: unknown): 'end' | 'fatal' | 'retry' {
  if (error instanceof HttpError) return error.status === 416 ? 'end' : error.status < 500 ? 'fatal' : 'retry'
  return error instanceof NoSeekError ? 'fatal' : 'retry'
}

async function stream(from: number, epoch: number, signal: AbortSignal) {
  const rem = remuxer!
  // Without a known length (or a server that ignores Range) the file is one open-ended request.
  const bounded = ranges && length > 0
  streaming = true
  const reader = new PieceReader({
    from,
    length,
    bounded,
    ...planReads({ viaProxy, bitrate, bounded }),
    open: (start, end, piece) => (!ranges && start > 0 ? Promise.reject(new NoSeekError(noSeek)) : request(start, end, piece)),
    classify,
    sleep,
    onBytes: (n) => meter.add(n, performance.now()),
    onActive: (n) => {
      inFlight = n
      meter.setActive(n > 0, performance.now())
    },
    signal,
  })
  try {
    for (;;) {
      await throttle(signal)
      const value = await reader.next()
      if (!value) break
      rem.push(value)
      await drain(epoch)
    }
  } catch (error) {
    if (signal.aborted) return
    throw error
  } finally {
    reader.close()
  }
  if (signal.aborted) return
  rem.finish()
  await drain(epoch)
  // The converted sound's last packets are still in the encoder: they go out before the stream is called done.
  if (converter?.working) await converter.finish()
  if (signal.aborted) return
  streaming = false
  post({ type: 'done', epoch })
}

/** Stops whatever is reading and starts a new run; the previous one has fully stopped before the next touches the remuxer.
 *  `inits`: which init segments the page needs again (everything at the start, the audio's after a switch). `track`: the
 *  audio track changed (or this is the start), so a converter is opened again, which also gives a failed one another go. */
async function begin(epoch: number, at: number, floor = 0, inits: 'all' | 'audio' | null = null, track = false) {
  run?.ctl.abort()
  wake?.()
  await run?.done
  const rem = remuxer!
  // Only now is nothing from the old run still posting, so its init can't be taken for the new one's.
  if (inits === 'all') sent = { video: false, audio: false }
  else if (inits === 'audio') sent.audio = false
  if (convertCodec) {
    if (track) await useConverter(epoch)
    converter?.begin(epoch)
  } else if (converter) {
    // Back to a track that plays as it is: the encoder and decoder are let go.
    converter.close()
  }
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
    produced = at
    await stream(offset, epoch, ctl.signal)
  })().catch((error) => {
    if (ctl.signal.aborted) return
    streaming = false
    void report(error)
  })
  run = { ctl, done: task }
}

// MARK: Commands

/** Points the remuxer at an audio track, raw when it is to be converted. A track the decoders can't take can't be converted. */
function selectAudio(epoch: number, track: number, convert: boolean) {
  convertCodec = convert ? (decodes.get(track) ?? null) : null
  remuxer!.select(videoTrack, track, convertCodec !== null)
  if (convert && !convertCodec) post({ type: 'audio-failed', epoch, message: 'This browser can’t convert that audio.' })
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
    case 'destroy':
      run?.ctl.abort()
      wake?.()
      if (statsTimer) clearInterval(statsTimer)
      statsTimer = null
      converter?.close()
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
          selectAudio(message.epoch, message.audio, message.convert)
          playhead = message.at
          await begin(message.epoch, message.at, 0, 'all', true)
          break
        case 'seek':
          playhead = message.at
          await begin(message.epoch, message.at)
          break
        case 'audio':
          audioTrack = message.track
          selectAudio(message.epoch, message.track, message.convert)
          await begin(message.epoch, message.at, message.floor, 'audio', true)
          break
      }
    })
    .catch((error) => void report(error))
}
