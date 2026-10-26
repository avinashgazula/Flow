/* Requests to add-ons and servers. Errors say what to do next, and never carry the URL: server
   URLs hold api_key and X-Plex-Token, and an add-on's manifest URL often holds a debrid key. */

export class SourceError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message)
    this.name = 'SourceError'
  }
}

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'DELETE'
  headers?: Record<string, string>
  body?: unknown
  signal?: AbortSignal
  /** Gives up after this long. */
  timeoutMs?: number
  /** Lets the request finish after the page closes (a server told that playback stopped). */
  keepalive?: boolean
}

/** A signal that aborts when `signal` does or after `ms`, whichever comes first. */
export function withTimeout(signal: AbortSignal | undefined, ms: number | undefined): { signal: AbortSignal; done: () => void; timedOut: () => boolean } {
  const controller = new AbortController()
  let expired = false
  const onAbort = () => controller.abort(signal?.reason)
  if (signal?.aborted) controller.abort(signal.reason)
  else signal?.addEventListener('abort', onAbort, { once: true })
  const timer = ms
    ? setTimeout(() => {
        expired = true
        controller.abort(new DOMException('Timed out', 'TimeoutError'))
      }, ms)
    : undefined
  return {
    signal: controller.signal,
    done: () => {
      clearTimeout(timer)
      signal?.removeEventListener('abort', onAbort)
    },
    timedOut: () => expired,
  }
}

export function hostOf(url: string): string {
  try {
    return new URL(url).host
  } catch {
    return 'the server'
  }
}

/** What people paste: no scheme, or a trailing slash. A bare IP or .local name is a home server, so http. */
export function normaliseShareURL(input: string): string {
  let url = input.trim()
  if (!/^https?:\/\//i.test(url)) {
    const local = /^(\d{1,3}\.){3}\d{1,3}(:\d+)?(\/|$)|^[^/]+\.local(:\d+)?(\/|$)|^localhost(:\d+)?(\/|$)/i.test(url)
    url = `${local ? 'http' : 'https'}://${url}`
  }
  const parsed = new URL(url)
  parsed.hash = ''
  parsed.search = ''
  parsed.username = ''
  parsed.password = ''
  return parsed.toString().replace(/\/+$/, '')
}

/** True when this page is HTTPS and the URL isn't: the browser blocks that request outright. */
export function isMixedContent(url: string): boolean {
  if (typeof location === 'undefined' || location.protocol !== 'https:') return false
  try {
    const u = new URL(url)
    // Browsers treat the machine itself as secure, so a server on localhost still works.
    return u.protocol === 'http:' && !['localhost', '127.0.0.1', '[::1]'].includes(u.hostname)
  } catch {
    return false
  }
}

export async function requestJSON<T>(url: string, options: RequestOptions = {}): Promise<T> {
  const response = await request(url, options)
  const text = await response.text()
  if (!text) return undefined as T
  try {
    return JSON.parse(text) as T
  } catch {
    throw new SourceError(`${hostOf(url)} didn’t answer with the data Flow expected. Check the address.`)
  }
}

export async function request(url: string, options: RequestOptions = {}): Promise<Response> {
  if (isMixedContent(url)) {
    throw new SourceError(`This page is served over HTTPS, so your browser blocks http:// addresses. Use the server’s https:// address, or run Flow locally to reach it.`)
  }
  const { signal, done, timedOut } = withTimeout(options.signal, options.timeoutMs)
  const headers: Record<string, string> = { Accept: 'application/json', ...options.headers }
  let body: BodyInit | undefined
  if (options.body !== undefined) {
    headers['Content-Type'] = 'application/json'
    body = JSON.stringify(options.body)
  }
  try {
    const response = await fetch(url, { method: options.method ?? (body ? 'POST' : 'GET'), headers, body, signal, keepalive: options.keepalive })
    if (!response.ok) throw statusError(url, response.status)
    return response
  } catch (error) {
    if (error instanceof SourceError) throw error
    if (timedOut()) throw new SourceError(`${hostOf(url)} took too long to answer.`)
    if ((error as Error)?.name === 'AbortError') throw error
    throw new SourceError(`Couldn’t reach ${hostOf(url)}. Check the address, and that it allows requests from this site.`)
  } finally {
    done()
  }
}

function statusError(url: string, status: number): SourceError {
  const host = hostOf(url)
  if (status === 401 || status === 403) return new SourceError(`${host} didn’t accept the sign-in. Sign in again in Settings.`, status)
  if (status === 404) return new SourceError(`${host} doesn’t have that. Check the address.`, status)
  if (status >= 500) return new SourceError(`${host} had a problem (${status}). Try again in a moment.`, status)
  return new SourceError(`${host} answered ${status}.`, status)
}

/** A random UUID. `crypto.randomUUID` only exists on secure (https) pages, so a page reached over
 *  plain http builds one from `getRandomValues`, which works everywhere. */
export function uuid(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  const b = crypto.getRandomValues(new Uint8Array(16))
  b[6] = (b[6]! & 0x0f) | 0x40
  b[8] = (b[8]! & 0x3f) | 0x80
  const h = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('')
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`
}

/** One id per browser, sent to Jellyfin and Plex so they list Flow as one device. */
export function deviceId(): string {
  const key = 'flow.deviceId'
  try {
    const saved = localStorage.getItem(key)
    if (saved) return saved
    const id = uuid()
    localStorage.setItem(key, id)
    return id
  } catch {
    return (memoryId ??= uuid())
  }
}
let memoryId: string | undefined

/** "Chrome on macOS", for the device list on the server. */
export function deviceName(): string {
  if (typeof navigator === 'undefined') return 'Flow'
  const ua = navigator.userAgent
  const browser = /Edg\//.test(ua) ? 'Edge' : /Firefox\//.test(ua) ? 'Firefox' : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : 'Browser'
  const os = /iPhone|iPad/.test(ua) ? 'iOS' : /Mac OS X/.test(ua) ? 'macOS' : /Android/.test(ua) ? 'Android' : /Windows/.test(ua) ? 'Windows' : /Linux/.test(ua) ? 'Linux' : ''
  return os ? `${browser} on ${os}` : browser
}
