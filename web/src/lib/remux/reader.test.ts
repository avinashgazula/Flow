import { describe, expect, it } from 'vitest'
import { FAST_BITRATE, PieceReader, type ReaderOptions, planReads } from './reader'

class HttpErr extends Error {
  constructor(readonly status: number) {
    super(`The server answered ${status}`)
  }
}

const tick = async (n = 6) => {
  for (let i = 0; i < n; i++) await new Promise((r) => setTimeout(r, 0))
}

/** A fake server over `data`: every request is a pull-driven body that delivers only what the test lets it. */
class Server {
  reqs: Req[] = []
  constructor(
    readonly data: Uint8Array,
    /** Bytes per chunk. */
    readonly chunk = 10,
  ) {}
  open = (start: number, end: number | null, signal: AbortSignal): Promise<Response> => {
    const req = new Req(this, start, end, signal)
    this.reqs.push(req)
    return req.response
  }
  /** Requests the reader has made, as `start-end` (end null for open-ended). */
  get asked() {
    return this.reqs.map((r) => `${r.start}-${r.end}`)
  }
}

class Req {
  /** Bytes the body has handed over. */
  delivered = 0
  /** Bytes the test lets the body hand over (Infinity: all of them). */
  limit = 0
  /** The body breaks after this many bytes. */
  failAt = Infinity
  aborted = false
  pulls = 0
  private poke: (() => void) | null = null
  readonly response: Promise<Response>
  private resolve!: (r: Response) => void
  private reject!: (e: unknown) => void
  private body: Uint8Array

  constructor(
    private server: Server,
    readonly start: number,
    readonly end: number | null,
    signal: AbortSignal,
  ) {
    this.body = server.data.subarray(start, end === null ? undefined : end + 1)
    this.response = new Promise((resolve, reject) => {
      this.resolve = resolve
      this.reject = reject
    })
    signal.addEventListener('abort', () => {
      this.aborted = true
      this.reject(new DOMException('Stopped', 'AbortError'))
      this.poke?.()
    })
  }

  /** Answers with headers and a body that waits for `allow`. */
  private answered = false
  answer() {
    if (this.answered) return
    this.answered = true
    const self = this
    this.resolve(
      new Response(
        new ReadableStream<Uint8Array>({
          async pull(controller) {
            self.pulls++
            while (!self.aborted && self.delivered >= self.limit && self.delivered < self.body.length) await new Promise<void>((r) => (self.poke = r))
            if (self.aborted) return controller.error(new DOMException('Stopped', 'AbortError'))
            if (self.delivered >= self.failAt) return controller.error(new TypeError('network error'))
            if (self.delivered >= self.body.length) return controller.close()
            const upTo = Math.min(self.delivered + self.server.chunk, self.body.length, self.limit, self.failAt)
            controller.enqueue(self.body.slice(self.delivered, upTo))
            self.delivered = upTo
          },
        }),
        { status: 206 },
      ),
    )
  }
  fail(status: number) {
    this.reject(new HttpErr(status))
  }
  allow(n = Infinity) {
    this.limit = n === Infinity ? Infinity : this.delivered + n
    this.poke?.()
  }
  /** The whole body, at once. */
  finish() {
    this.answer()
    this.allow()
  }
}

const fileOf = (n: number) => Uint8Array.from({ length: n }, (_, i) => (i * 7 + (i >> 8)) & 255)

const classify: ReaderOptions['classify'] = (e) => (e instanceof HttpErr ? (e.status === 416 ? 'end' : e.status < 500 ? 'fatal' : 'retry') : 'retry')

function make(server: Server, o: Partial<ReaderOptions> = {}) {
  const ctl = new AbortController()
  const reader = new PieceReader({
    from: 0,
    length: server.data.length,
    bounded: true,
    firstSize: 20,
    size: 40,
    parallel: 3,
    open: server.open,
    classify,
    sleep: () => Promise.resolve(),
    signal: ctl.signal,
    ...o,
  })
  return { reader, ctl }
}

/** Everything the reader hands over, in order, until it ends (or throws). */
async function readAll(reader: PieceReader, seen: Uint8Array[] = []) {
  for (let v = await reader.next(); v; v = await reader.next()) seen.push(v)
  const out = new Uint8Array(seen.reduce((n, c) => n + c.length, 0))
  let at = 0
  for (const c of seen) (out.set(c, at), (at += c.length))
  return out
}

describe('PieceReader', () => {
  it('hands the file over in order when later pieces arrive first', async () => {
    const server = new Server(fileOf(140))
    const { reader } = make(server)
    await tick()
    // Pieces 20 + 40 + 40 asked for at once.
    expect(server.asked).toEqual(['0-19', '20-59', '60-99'])
    const done = readAll(reader)
    // The last of the three finishes first, then the middle one, then the head.
    server.reqs[2]!.finish()
    await tick()
    server.reqs[1]!.finish()
    await tick()
    server.reqs[0]!.finish()
    await tick()
    // As the head is consumed the window slides: the fourth piece is the file's remainder.
    expect(server.asked).toEqual(['0-19', '20-59', '60-99', '100-139'])
    server.reqs[3]!.finish()
    expect(await done).toEqual(server.data)
  })

  it('never holds more than `parallel` pieces, and starts the next only as the head is consumed', async () => {
    const server = new Server(fileOf(400))
    const { reader } = make(server, { parallel: 3 })
    await tick()
    expect(server.reqs.length).toBe(3)
    expect(reader.held).toBe(3)
    // Pieces behind the head complete and wait: still no fourth request while the head is unread.
    server.reqs[1]!.finish()
    server.reqs[2]!.finish()
    await tick()
    expect(server.reqs.length).toBe(3)
    expect(reader.held).toBe(3)
    // Reading part of the head doesn't free a slot; finishing it does.
    server.reqs[0]!.answer()
    server.reqs[0]!.allow(10)
    expect(await reader.next()).toEqual(server.data.slice(0, 10))
    await tick()
    expect(server.reqs.length).toBe(3)
    server.reqs[0]!.finish()
    const seen: Uint8Array[] = []
    while (seen.reduce((n, c) => n + c.length, 0) < 20) seen.push((await reader.next())!)
    await tick()
    expect(server.reqs.length).toBe(4)
    expect(reader.held).toBeLessThanOrEqual(3)
  })

  it('reads a whole file correctly with every piece delivered as it is asked for', async () => {
    const server = new Server(fileOf(1000), 7)
    const { reader } = make(server, { parallel: 3, firstSize: 13, size: 64 })
    let max = 0
    const seen: Uint8Array[] = []
    const answering = (async () => {
      for (let i = 0; i < 400; i++) {
        for (const r of server.reqs) if (r.limit !== Infinity) r.finish()
        max = Math.max(max, reader.held)
        await tick(1)
      }
    })()
    const out = await readAll(reader, seen)
    await answering
    expect(out).toEqual(server.data)
    expect(max).toBeLessThanOrEqual(3)
    // Every byte was asked for exactly once.
    expect(server.reqs.reduce((n, r) => n + r.delivered, 0)).toBe(1000)
  })

  it('stops every request when aborted, and next() throws', async () => {
    const server = new Server(fileOf(400))
    const { reader, ctl } = make(server)
    await tick()
    server.reqs[0]!.answer()
    server.reqs[1]!.answer()
    await tick()
    const pending = reader.next()
    ctl.abort()
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
    expect(server.reqs.every((r) => r.aborted)).toBe(true)
    await tick()
    // Nothing new starts after the abort.
    expect(server.reqs.length).toBe(3)
    expect(reader.held).toBe(0)
  })

  it('asks again for only the piece that dropped, from the last byte it got', async () => {
    const server = new Server(fileOf(140))
    const { reader } = make(server)
    await tick()
    const [a, b, c] = server.reqs as [Req, Req, Req]
    b.failAt = 15
    b.finish()
    c.finish()
    a.finish()
    await tick()
    // Piece 1 (20-59) broke after 15 bytes: one new request, for 35-59. The others weren't touched.
    expect(server.asked.filter((s) => s !== '0-19' && s !== '60-99')).toContain('35-59')
    expect(server.asked.filter((s) => s === '0-19' || s === '60-99').length).toBe(2)
    expect(c.aborted).toBe(false)
    const again = server.reqs.find((r) => r.start === 35)!
    again.finish()
    const out = readAll(reader)
    for (let i = 0; i < 20; i++) {
      for (const r of server.reqs) r.finish()
      await tick(1)
    }
    expect(await out).toEqual(server.data)
    // Bytes were never read twice.
    expect(server.reqs.reduce((n, r) => n + r.delivered, 0)).toBe(140)
  })

  it('keeps bytes in order while one piece waits to be retried', async () => {
    const server = new Server(fileOf(100))
    let release!: () => void
    const gate = new Promise<void>((r) => (release = r))
    const { reader } = make(server, { sleep: () => gate })
    await tick()
    const [a, b, c] = server.reqs as [Req, Req, Req]
    a.failAt = 5
    a.finish()
    b.finish()
    c.finish()
    await tick()
    // The head gave five bytes, then dropped; the pieces behind it are complete and wait.
    expect(await reader.next()).toEqual(server.data.slice(0, 5))
    const next = reader.next()
    await tick()
    let settled = false
    void next.then(() => (settled = true))
    await tick()
    expect(settled).toBe(false)
    release()
    await tick()
    server.reqs.find((r) => r.start === 5)!.finish()
    const first = await next
    expect(first).toEqual(server.data.slice(5, 15))
  })

  it('gives up on a piece that keeps failing and throws when the reader reaches it, after the bytes before it', async () => {
    const server = new Server(fileOf(140))
    const { reader } = make(server, { retries: 2 })
    await tick()
    const [a, b] = server.reqs as [Req, Req, Req]
    a.finish()
    b.failAt = 0
    b.finish()
    await tick()
    // Each retry of piece 1 fails at once as well.
    for (let i = 0; i < 6; i++) {
      for (const r of server.reqs) if (r.start === 20 && r.limit !== Infinity) ((r.failAt = 0), r.finish())
      await tick()
    }
    const seen: Uint8Array[] = []
    await expect(readAll(reader, seen)).rejects.toThrow('network error')
    // The head's twenty bytes arrived before the failure was reported.
    expect(seen.reduce((n, c) => n + c.length, 0)).toBe(20)
  })

  it('does not retry a refusal', async () => {
    const server = new Server(fileOf(140))
    const { reader } = make(server)
    await tick()
    server.reqs[0]!.finish()
    server.reqs[1]!.fail(403)
    await tick()
    await expect(readAll(reader)).rejects.toMatchObject({ status: 403 })
    expect(server.reqs.filter((r) => r.start === 20).length).toBe(1)
  })

  it('ends at the file’s end: the last piece is short and nothing beyond it is asked for', async () => {
    const server = new Server(fileOf(95))
    const { reader } = make(server)
    const out = readAll(reader)
    for (let i = 0; i < 40; i++) {
      for (const r of server.reqs) if (r.limit !== Infinity) r.finish()
      await tick(1)
    }
    expect(await out).toEqual(server.data)
    expect(server.asked).toEqual(['0-19', '20-59', '60-94'])
  })

  it('treats a 416 as the end of the file', async () => {
    // The file says it is 100 bytes long but is 50.
    const server = new Server(fileOf(50))
    const { reader } = make(server, { length: 100 })
    await tick()
    // Pieces: 0-19, 20-59, 60-99. The middle one comes up short (30 bytes), the last is past the end.
    server.reqs[0]!.finish()
    server.reqs[1]!.finish()
    server.reqs[2]!.fail(416)
    await tick()
    // The short piece asks again from where it stopped and is told the file is over.
    const rest = server.reqs.find((r) => r.start === 50)!
    rest.fail(416)
    expect(await readAll(reader)).toEqual(server.data)
    // Nothing is left open: the reader let go of the pieces behind the end.
    expect(reader.held).toBe(0)
    expect(reader.inFlight).toBe(0)
  })

  it('reads a file of unknown length with one open-ended request, and keeps little in memory', async () => {
    const server = new Server(fileOf(10_000), 100)
    const { reader } = make(server, { bounded: false, length: 0, parallel: 1, firstSize: 1000, size: 1000 })
    await tick()
    expect(server.asked).toEqual(['0-null'])
    server.reqs[0]!.finish()
    await tick(20)
    // Nobody is reading: the body was left alone once a piece's worth was waiting.
    expect(server.reqs[0]!.delivered).toBeLessThanOrEqual(1000 + 2 * 100)
    expect(await readAll(reader)).toEqual(server.data)
    expect(server.reqs.length).toBe(1)
  })

  it('resumes an open-ended read after a dropped connection', async () => {
    const server = new Server(fileOf(500), 50)
    const { reader } = make(server, { bounded: false, length: 0, parallel: 1, size: 10_000 })
    await tick()
    server.reqs[0]!.failAt = 200
    server.reqs[0]!.finish()
    await tick(10)
    const resumed = server.reqs.find((r) => r.start === 200)!
    expect(resumed.end).toBeNull()
    resumed.finish()
    expect(await readAll(reader)).toEqual(server.data)
  })

  it('starts with small pieces that double up to the full size, so the head of the file isn’t one slow connection', async () => {
    const server = new Server(fileOf(1000))
    make(server, { firstSize: 10, size: 50, parallel: 5 })
    await tick()
    expect(server.asked).toEqual(['0-9', '10-29', '30-69', '70-119', '120-169'])
  })

  it('starts from any offset', async () => {
    const server = new Server(fileOf(300))
    const { reader } = make(server, { from: 130 })
    const out = readAll(reader)
    for (let i = 0; i < 30; i++) {
      for (const r of server.reqs) if (r.limit !== Infinity) r.finish()
      await tick(1)
    }
    expect(await out).toEqual(server.data.slice(130))
    expect(server.asked[0]).toBe('130-149')
  })

  it('hands over large runs of small chunks together, but never more than maxChunk', async () => {
    const server = new Server(fileOf(1000), 5)
    const { reader } = make(server, { firstSize: 200, size: 200, parallel: 2, maxChunk: 64 })
    server.reqs[0]?.finish()
    await tick(40)
    const first = await reader.next()
    expect(first!.length).toBeGreaterThan(5)
    expect(first!.length).toBeLessThanOrEqual(64)
  })

  it('counts bytes as they arrive and says how many requests are open', async () => {
    const server = new Server(fileOf(140))
    let bytes = 0
    const active: number[] = []
    const { reader } = make(server, { onBytes: (n) => (bytes += n), onActive: (n) => active.push(n) })
    await tick()
    expect(active.at(-1)).toBe(3)
    server.reqs[1]!.finish()
    await tick()
    // A piece that has everything it asked for is no longer in flight, though it is still held.
    expect(bytes).toBe(40)
    expect(active.at(-1)).toBe(2)
    expect(reader.held).toBe(3)
  })
})

describe('planReads', () => {
  it('reads three pieces at once through the proxy, in big pieces', () => {
    expect(planReads({ viaProxy: true, bitrate: 1_000_000, bounded: true })).toEqual({ parallel: 3, firstSize: 1024 * 1024, size: 16 * 1024 * 1024 })
  })
  it('reads three at once for a file above 25 Mb/s, even without the proxy', () => {
    expect(planReads({ viaProxy: false, bitrate: FAST_BITRATE + 1, bounded: true })).toMatchObject({ parallel: 3, size: 4 * 1024 * 1024 })
  })
  it('keeps two for an ordinary file read directly, and also when the bitrate is unknown', () => {
    expect(planReads({ viaProxy: false, bitrate: 2_000_000, bounded: true }).parallel).toBe(2)
    expect(planReads({ viaProxy: false, bitrate: 0, bounded: true }).parallel).toBe(2)
  })
  it('uses one request when the file can’t be asked for in pieces', () => {
    expect(planReads({ viaProxy: true, bitrate: 20_000_000, bounded: false }).parallel).toBe(1)
  })
})
