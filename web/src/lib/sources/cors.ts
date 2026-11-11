/* Whether a stream's host lets this page read what it plays. A <video> with `crossorigin="anonymous"` keeps its picture
   readable (X-Ray draws frames on a canvas), but a host that sends no CORS headers refuses to play it at all. So the
   attribute is only set once the host has answered a small range request the way a CORS host does, and the answer is kept
   per host for the rest of the visit. */

const answers = new Map<string, Promise<boolean>>()

export type Fetcher = (input: string, init: RequestInit) => Promise<Pick<Response, 'ok' | 'status'>>

const hostOf = (url: string): string | undefined => {
  try {
    const { protocol, host } = new URL(url)
    return protocol === 'http:' || protocol === 'https:' ? host : undefined
  } catch {
    return undefined
  }
}

/** True when `url` is on this page's own origin, which needs no CORS. */
export const sameOrigin = (url: string, origin: string = typeof location === 'undefined' ? '' : location.origin): boolean => {
  try {
    return new URL(url, origin || undefined).origin === origin
  } catch {
    return false
  }
}

/** One byte of the file, asked for the way a page's script would. Only a host that sends CORS headers (and answers the
 *  preflight) lets the page see the answer; anything else, a timeout included, is a no. */
export function hostAllowsCors(url: string, { fetcher = fetch as Fetcher, timeoutMs = 3000 }: { fetcher?: Fetcher; timeoutMs?: number } = {}): Promise<boolean> {
  const host = hostOf(url)
  if (!host) return Promise.resolve(false)
  let known = answers.get(host)
  if (!known) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    known = fetcher(url, { method: 'GET', mode: 'cors', headers: { Range: 'bytes=0-0' }, credentials: 'omit', signal: controller.signal })
      .then((r) => r.ok || r.status === 206 || r.status === 416)
      .catch(() => false)
      .finally(() => clearTimeout(timer))
    answers.set(host, known)
  }
  return known
}

/** For tests: forget what was learned. */
export const forgetCors = () => answers.clear()
