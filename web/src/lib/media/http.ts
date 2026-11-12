/* Range requests for the media worker: the same rules as the Matroska worker's (the stream proxy and its
   direct-address header, the add-on's request headers, a redirect that expires), as an object, plus the
   blocking read the engine's cache falls back to. Runs in a worker; nothing here is used on the page. */

import { cleanDetail, DETAIL_BYTES, detailWanted, httpFailureMessage, networkFailureMessage, PROXY_DIRECT_HEADER, PROXY_HOPS_HEADER } from '../remux/failure'
import type { FromWorker } from '../remux/protocol'

export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly detail?: string,
    readonly hops?: string,
  ) {
    super(`The server answered ${status}`)
  }
}

/** The server answered a range with the whole file, so nothing but the start can be read. */
export class NoSeekError extends Error {}

const sameOrigin = (a: string, b: string) => {
  try {
    return new URL(a).origin === new URL(b).origin
  } catch {
    return false
  }
}

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

export class RangeHttp {
  /** The address requests go to: it moves from the one given to where an add-on's redirect led. */
  url: string
  /** False once a server has answered a range with the whole file. */
  ranges = true
  noSeek = 'This server can’t seek inside the file. Try another source.'

  constructor(
    private readonly given: string,
    private readonly headers: Record<string, string>,
    readonly viaProxy: boolean,
    private readonly origin: string,
  ) {
    this.url = given
  }

  async request(start: number, end: number | null, signal?: AbortSignal): Promise<Response> {
    const h = new Headers(this.headers)
    h.set('Range', `bytes=${start}-${end ?? ''}`)
    const init: RequestInit = { headers: h, signal }
    let res = await fetch(this.url, init)
    // The redirect's target can expire or be refused before the play link does: back to the play link once.
    if (this.url !== this.given && res.status >= 400) {
      res.body?.cancel().catch(() => {})
      this.url = this.given
      res = await fetch(this.url, init)
    }
    // The proxy says where the link led, and later pieces go there instead of looking the link up again.
    const direct = this.viaProxy ? res.headers.get(PROXY_DIRECT_HEADER) : null
    if (direct && this.url === this.given && sameOrigin(direct, this.given)) this.url = direct
    if (res.status === 206) return res
    if (res.status === 200 && start === 0) {
      this.ranges = false
      return res
    }
    if (res.status === 200) {
      res.body?.cancel().catch(() => {})
      this.ranges = false
      const hops = res.headers.get(PROXY_HOPS_HEADER)
      this.noSeek = `This server can’t seek inside the file. Try another source.${hops ? ` Hosts asked: ${hops}.` : ''}`
      throw new NoSeekError(this.noSeek)
    }
    const detail = await readDetail(res)
    res.body?.cancel().catch(() => {})
    throw new HttpError(res.status, detail, res.headers.get(PROXY_HOPS_HEADER) ?? undefined)
  }

  /** `[start, end)` by a blocking request: a worker may make one, and the engine can't wait any other way. Fewer bytes only at the end of the file. */
  readSync(start: number, end: number): Uint8Array {
    if (!this.ranges) throw new NoSeekError(this.noSeek)
    const xhr = new XMLHttpRequest()
    xhr.open('GET', this.url, false)
    xhr.responseType = 'arraybuffer'
    for (const [name, value] of Object.entries(this.headers)) xhr.setRequestHeader(name, value)
    xhr.setRequestHeader('Range', `bytes=${start}-${end - 1}`)
    try {
      xhr.send()
    } catch {
      // A blocking request that fails reports like fetch's TypeError: the caller finds out why.
      throw new TypeError('Network request failed')
    }
    if (xhr.status === 206) return new Uint8Array(xhr.response as ArrayBuffer)
    if (xhr.status === 416) return new Uint8Array(0)
    if (xhr.status === 200) {
      this.ranges = false
      if (start === 0) return new Uint8Array(xhr.response as ArrayBuffer).subarray(0, end)
      throw new NoSeekError(this.noSeek)
    }
    throw new HttpError(xhr.status, undefined, xhr.getResponseHeader(PROXY_HOPS_HEADER) ?? undefined)
  }

  /** What a failed read means to the reader: a 416 is the file's end, a refusal or a server that can't seek won't improve, the rest may. */
  classify = (error: unknown): 'end' | 'fatal' | 'retry' => {
    if (error instanceof HttpError) return error.status === 416 ? 'end' : error.status < 500 ? 'fatal' : 'retry'
    return error instanceof NoSeekError ? 'fatal' : 'retry'
  }

  /** The message to post for a failure. A fetch TypeError hides why, so it gets one more question: a host that answers a
   *  no-cors request is up and just doesn't let web pages read its files (`blocked`), unless the address is the proxy's. */
  async failure(error: unknown, extra: (error: unknown) => FromWorker | null = () => null): Promise<FromWorker> {
    const own = extra(error)
    if (own) return own
    if (error instanceof TypeError && !(error instanceof HttpError)) {
      const reachable = await fetch(this.url, { method: 'HEAD', mode: 'no-cors', cache: 'no-store' }).then(
        () => true,
        () => false,
      )
      if (this.viaProxy) return { type: 'error', message: networkFailureMessage(true, reachable, this.origin) }
      if (reachable) return { type: 'error', blocked: true, message: 'This file’s host doesn’t let web pages stream from it.' }
      return { type: 'error', message: networkFailureMessage(false, false) }
    }
    if (error instanceof HttpError) return { type: 'error', message: httpFailureMessage(error, this.viaProxy) }
    return { type: 'error', message: error instanceof Error ? error.message : String(error) }
  }
}

export const totalLength = (res: Response): number => {
  const range = res.headers.get('Content-Range')
  const total = range?.match(/\/(\d+)$/)?.[1]
  return total ? Number(total) : Number(res.headers.get('Content-Length') ?? 0)
}
