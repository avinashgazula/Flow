import { hostOf, withTimeout } from '../sources/http'

/* Getting an IPTV provider's playlist, guide and API answers into a web page. Most providers send no
   CORS headers, so a page can't read what they return; and a provider on plain http:// can't be called at
   all from an https:// page. Both go through the viewer's stream proxy (Settings → Playback) when there
   is one (plan.ts decides; this file carries it out). Nothing here reads the settings, so it also runs
   in the guide worker. Errors name the host and never the address: it carries the provider's login. */

/** A failure with words for the viewer: what happened and what to do next. */
export class LiveTVError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message)
    this.name = 'LiveTVError'
  }
}

export interface Attempt {
  /** The address to request. */
  url: string
  viaProxy: boolean
}

export interface FetchOptions {
  signal?: AbortSignal
  timeoutMs?: number
  headers?: Record<string, string>
  /** For tests. */
  fetchImpl?: typeof fetch
}

export interface Fetched {
  response: Response
  /** Which attempt answered: false when the host was read directly, so the caller can remember that. */
  viaProxy: boolean
  /** The direct request failed the way a host that sends no CORS headers does, before the proxy answered. */
  directBlocked: boolean
}

const proxyWorkerHint = 'The Worker in web/proxy fetches only https addresses on the standard port, so a panel on http:// or a port such as :8080 needs a proxy that allows them (MediaFlow Proxy does).'

async function proxyReason(response: Response): Promise<string> {
  try {
    // The proxy answers its own refusals in plain text: which host, and why.
    const text = (await response.text()).trim().replace(/\s+/g, ' ').slice(0, 220)
    return text && !text.startsWith('<') ? ` It said: “${text}”` : ''
  } catch {
    return ''
  }
}

/** Requests `url` as `plan` says, and returns the first response that is OK. A refusal from the host or
 *  the proxy ends the attempt with words for it; only a request that never got an answer moves on to
 *  the next one. */
export async function fetchPlanned(url: string, plan: { attempts: Attempt[]; problem?: string }, options: FetchOptions = {}): Promise<Fetched> {
  if (plan.problem) throw new LiveTVError(plan.problem)
  const doFetch = options.fetchImpl ?? fetch
  const host = hostOf(url)
  let directBlocked = false
  let lastNetwork = false
  for (const attempt of plan.attempts) {
    const timer = withTimeout(options.signal, options.timeoutMs)
    let response: Response
    try {
      response = await doFetch(attempt.url, { signal: timer.signal, headers: options.headers, credentials: 'omit', cache: 'no-store' })
    } catch (error) {
      timer.done()
      if (options.signal?.aborted) throw error
      if (timer.timedOut()) throw new LiveTVError(`${host} took too long to answer. Try again, or check the address.`)
      if ((error as Error)?.name === 'AbortError') throw error
      // No answer at all: a host that sends no CORS headers looks exactly like one that is down.
      if (!attempt.viaProxy) directBlocked = true
      lastNetwork = true
      continue
    }
    timer.done()
    if (response.ok) return { response, viaProxy: attempt.viaProxy, directBlocked }
    if (attempt.viaProxy) {
      throw new LiveTVError(`Your stream proxy couldn’t open ${host} (it answered ${response.status}).${await proxyReason(response)} ${proxyWorkerHint}`, response.status)
    }
    if (response.status === 401 || response.status === 403) throw new LiveTVError(`${host} refused the request (${response.status}). Check the username and password, and that the subscription is active.`, response.status)
    throw new LiveTVError(`${host} answered ${response.status}. Check the address.`, response.status)
  }
  const triedProxy = plan.attempts.some((a) => a.viaProxy)
  if (lastNetwork && !triedProxy) {
    throw new LiveTVError(
      `Flow couldn’t read ${host}. Most IPTV providers don’t let web pages read their playlists and guides (no CORS headers), or the address is wrong. Add a stream proxy in Settings → Playback, then try again.`,
    )
  }
  throw new LiveTVError(
    `Flow couldn’t reach ${host}, directly or through your stream proxy. Check the address, and that the proxy is running and lists this page in its allowed origins. ${proxyWorkerHint}`,
  )
}

export async function fetchJSON<T>(url: string, plan: { attempts: Attempt[]; problem?: string }, options?: FetchOptions): Promise<{ data: T; fetched: Fetched }> {
  const fetched = await fetchPlanned(url, plan, options)
  try {
    return { data: (await fetched.response.json()) as T, fetched }
  } catch {
    throw new LiveTVError(`${hostOf(url)} didn’t answer with the data Flow expected. Check that this is an Xtream Codes address, and the username and password.`)
  }
}
