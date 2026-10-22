/* Reads a file in order from several range requests at once. One request at a time can't keep up
   with a high-bitrate file behind a path that adds latency to every request and caps each connection
   (a stream proxy in front of a debrid CDN): the pipe is half empty while a request waits to
   start, and one connection never fills it. Pieces of the file are asked for ahead, in parallel, and
   handed to the demuxer strictly in file order.

   Memory is bounded: at most `parallel` pieces exist at once, the one being handed over and those
   behind it, so a piece that arrives early waits in memory and no more than that is ever held. A piece
   that fails is asked for again on its own, from the last byte it got, while the others carry on.

   Pure apart from the `open` it is given, so it is tested with a fake one (reader.test.ts). */

/** The first read covers the first picture, so it is small. */
export const FIRST_CHUNK = 1024 * 1024
export const CHUNK = 4 * 1024 * 1024
/** Through the stream proxy every piece is a round trip to the Worker and on to the host, so pieces are bigger. */
export const PROXY_CHUNK = 16 * 1024 * 1024
/** A file above this (bytes per second, 25 Mb/s) is read in parallel even when it isn't behind the proxy: one connection rarely keeps up. */
export const FAST_BITRATE = 25_000_000 / 8
/** Requests in flight through the proxy or for a fast file, and otherwise (the next piece is already on its way, as it always was). */
export const PARALLEL_FAST = 3
export const PARALLEL_SLOW = 2

export interface ReadPlan {
  parallel: number
  firstSize: number
  size: number
}

/** How a file is read: how many pieces at once and how big. `bitrate` is the file's average in bytes per second (0 when unknown). */
export function planReads({ viaProxy, bitrate, bounded }: { viaProxy: boolean; bitrate: number; bounded: boolean }): ReadPlan {
  // One open-ended request has nothing to run beside it. The size is how much of it waits in memory unread.
  if (!bounded) return { parallel: 1, firstSize: CHUNK, size: CHUNK }
  return { parallel: viaProxy || bitrate > FAST_BITRATE ? PARALLEL_FAST : PARALLEL_SLOW, firstSize: FIRST_CHUNK, size: viaProxy ? PROXY_CHUNK : CHUNK }
}

export interface ReaderOptions {
  /** The first byte to read. */
  from: number
  /** The file's length; 0 when unknown. */
  length: number
  /** One request per piece. False reads the rest of the file with a single open-ended request
   *  (a server that ignores Range, or a file of unknown length). */
  bounded: boolean
  /** Size of the first piece and of the later ones. Pieces double from the first up to `size`: at the start
   *  a big piece would keep every connection busy with bytes the player needs later, while the head of the
   *  file crawls in on one of them at its capped rate. */
  firstSize: number
  size: number
  /** The most pieces held at once, the one being read included. */
  parallel: number
  /** Asks for bytes `[start, end]` (inclusive; `end` null reads to the end of the file). */
  open: (start: number, end: number | null, signal: AbortSignal) => Promise<Response>
  /** What a failed request means: the file ended (a 416 past its end), it can't work (a refusal, a
   *  server that can't seek), or it might on another try (a dropped connection, a 5xx). */
  classify: (error: unknown) => 'end' | 'fatal' | 'retry'
  sleep: (ms: number, signal: AbortSignal) => Promise<void>
  /** Called with every chunk as it arrives off the network, before the demuxer has it. */
  onBytes?: (bytes: number) => void
  /** Called when the number of requests in flight changes. */
  onActive?: (inFlight: number) => void
  signal: AbortSignal
  /** The most `next()` hands over at once. */
  maxChunk?: number
  /** Failed attempts in a row, without a byte in between, that a piece survives. */
  retries?: number
}

interface Piece {
  start: number
  /** Exclusive; null reads to the end of the file, whatever that is. */
  end: number | null
  chunks: Uint8Array[]
  /** Bytes in `chunks`, not yet handed over. */
  buffered: number
  /** Bytes received in all, handed over or not. */
  got: number
  done: boolean
  /** The file ends in this piece (a 416, or the open-ended body finished). */
  eof: boolean
  error: unknown
  failed: boolean
  /** A request is open for it right now. */
  active: boolean
  /** The reader is waiting for data. */
  waiter: (() => void) | null
  /** The piece's request is waiting for the reader to take some of what it has (open-ended pieces only). */
  room: (() => void) | null
}

export class PieceReader {
  private pieces: Piece[] = []
  private nextStart: number
  /** Pieces started so far. */
  private started = 0
  private finished = false
  /** The file's last byte has been handed over. */
  private ended = false
  private inFlightLast = 0
  private readonly ctl = new AbortController()
  private readonly maxChunk: number
  private readonly retries: number

  constructor(private readonly o: ReaderOptions) {
    this.nextStart = o.from
    this.maxChunk = o.maxChunk ?? 2 * 1024 * 1024
    this.retries = o.retries ?? 4
    const stop = () => this.close()
    if (o.signal.aborted) this.ctl.abort()
    else o.signal.addEventListener('abort', stop, { once: true })
    this.fill()
  }

  /** Pieces held right now (for tests and stats). */
  get held(): number {
    return this.pieces.length
  }

  get inFlight(): number {
    let n = 0
    for (const p of this.pieces) if (p.active) n++
    return n
  }

  /** The next bytes of the file in order, or null at its end. Throws what ended the read: the
   *  failure of the piece it has reached, or an AbortError once closed. */
  async next(): Promise<Uint8Array | null> {
    for (;;) {
      if (this.ended) return null
      if (this.ctl.signal.aborted) throw new DOMException('Stopped', 'AbortError')
      const head = this.pieces[0]
      if (!head) return null
      if (head.buffered > 0) return this.take(head)
      if (head.done) {
        if (head.failed) throw head.error
        this.pieces.shift()
        if (head.eof) {
          this.ended = true
          this.close()
          return null
        }
        this.fill()
        continue
      }
      await new Promise<void>((resolve) => {
        head.waiter = resolve
      })
    }
  }

  /** Stops every request. */
  close() {
    if (this.finished) return
    this.finished = true
    this.ctl.abort()
    for (const p of this.pieces) {
      p.waiter?.()
      p.room?.()
    }
    this.pieces = []
    this.report()
  }

  private more(): boolean {
    if (this.finished) return false
    return !this.o.bounded ? this.started === 0 : this.nextStart < this.o.length
  }

  /** Starts pieces until `parallel` are held. */
  private fill() {
    while (this.pieces.length < this.o.parallel && this.more()) {
      const start = this.nextStart
      let end: number | null = null
      if (this.o.bounded) end = Math.min(start + Math.min(this.o.size, this.o.firstSize * 2 ** Math.min(this.started, 30)), this.o.length)
      this.started++
      this.nextStart = end ?? Infinity
      const piece: Piece = { start, end, chunks: [], buffered: 0, got: 0, done: false, eof: false, error: undefined, failed: false, active: false, waiter: null, room: null }
      this.pieces.push(piece)
      void this.pump(piece)
    }
    this.report()
  }

  private report() {
    const n = this.inFlight
    if (n === this.inFlightLast) return
    this.inFlightLast = n
    this.o.onActive?.(n)
  }

  private take(piece: Piece): Uint8Array {
    let out: Uint8Array
    const first = piece.chunks[0]!
    if (piece.chunks.length === 1 || first.length >= this.maxChunk) {
      out = first
      piece.chunks.shift()
    } else {
      let size = 0
      let count = 0
      while (count < piece.chunks.length && size + piece.chunks[count]!.length <= this.maxChunk) size += piece.chunks[count++]!.length
      if (count === 0) count = 1
      out = new Uint8Array(piece.chunks.slice(0, count).reduce((n, c) => n + c.length, 0))
      let at = 0
      for (const c of piece.chunks.splice(0, count)) (out.set(c, at), (at += c.length))
    }
    piece.buffered -= out.length
    piece.room?.()
    return out
  }

  private async pump(piece: Piece) {
    const { signal } = this.ctl
    let failures = 0
    const expected = piece.end === null ? Infinity : piece.end - piece.start
    try {
      while (!signal.aborted && piece.got < expected) {
        const before = piece.got
        try {
          piece.active = true
          this.report()
          const at = piece.start + piece.got
          const res = await this.o.open(at, piece.end === null ? null : piece.end - 1, signal)
          const reader = res.body!.getReader()
          try {
            for (;;) {
              // Only an open-ended piece can wait here: a bounded one never holds more than its own size.
              while (piece.buffered >= this.o.size && !signal.aborted) {
                piece.active = false
                this.report()
                await new Promise<void>((resolve) => {
                  piece.room = resolve
                })
                piece.room = null
                piece.active = true
              }
              if (signal.aborted) return
              const { done, value } = await reader.read()
              if (done) break
              // A server that sends more than was asked for would repeat bytes the next piece also brings.
              const room = expected - piece.got
              const chunk = value.length > room ? value.subarray(0, room) : value
              if (chunk.length) {
                piece.chunks.push(chunk)
                piece.buffered += chunk.length
                piece.got += chunk.length
                failures = 0
                this.o.onBytes?.(chunk.length)
                piece.waiter?.()
                piece.waiter = null
              }
              if (piece.got >= expected) break
            }
          } finally {
            reader.cancel().catch(() => {})
          }
          if (piece.end === null) {
            piece.eof = true
            break
          }
          // The body ended before the piece did: ask again for the rest, unless nothing came at all.
          if (piece.got < expected && piece.got === before && ++failures > this.retries) throw new Error('The server stopped sending data. Try again.')
        } catch (error) {
          if (signal.aborted) return
          const kind = this.o.classify(error)
          if (kind === 'end') {
            piece.eof = true
            break
          }
          piece.active = false
          this.report()
          if (kind === 'fatal' || ++failures > this.retries) throw error
          await this.o.sleep(400 * failures, signal)
        }
      }
    } catch (error) {
      if (signal.aborted) return
      piece.failed = true
      piece.error = error
    }
    if (signal.aborted) return
    piece.done = true
    piece.active = false
    this.report()
    piece.waiter?.()
    piece.waiter = null
  }
}
